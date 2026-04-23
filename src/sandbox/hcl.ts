/**
 * HCL (Terraform-like) serialiser / parser for sandbox topologies.
 *
 * Converts between TopologyDef + SandboxTrafficSettings and a
 * human-readable HCL format that mirrors Terraform resource syntax.
 */

import type { TopologyDef } from "../playtest/topology-builder";
import type { SandboxTrafficSettings, SandboxImportResult } from "./import-export";

// ---------------------------------------------------------------------------
// Serialiser
// ---------------------------------------------------------------------------

/** Serialise a topology (+ optional traffic) to an HCL string. */
export function toHCL(
  topology: TopologyDef,
  traffic?: SandboxTrafficSettings,
): string {
  const lines: string[] = [];

  // --- resources ---
  for (const c of topology.components) {
    lines.push(`resource "stackattack_${c.type}" "${c.id}" {`);
    if (c.label) {
      lines.push(`  label = "${c.label}"`);
    }
    if (c.zone) {
      lines.push(`  zone  = "${c.zone}"`);
    }
    lines.push("}");
    lines.push("");
  }

  // --- connections ---
  for (const conn of topology.connections) {
    const fromComp = topology.components.find((c) => c.id === conn.from);
    const toComp = topology.components.find((c) => c.id === conn.to);
    if (!fromComp || !toComp) continue;

    const name = `${conn.from}_to_${conn.to}`;
    lines.push(`connection "${name}" {`);
    lines.push(
      `  from = stackattack_${fromComp.type}.${conn.from}`,
    );
    lines.push(
      `  to   = stackattack_${toComp.type}.${conn.to}`,
    );
    lines.push("}");
    lines.push("");
  }

  // --- traffic ---
  if (traffic) {
    lines.push("traffic {");
    lines.push(`  intensity = ${traffic.intensity}`);
    lines.push("");
    lines.push("  composition {");
    lines.push(`    write  = ${Math.round(traffic.composition.writeRatio * 100)}`);
    lines.push(`    auth   = ${Math.round(traffic.composition.authRatio * 100)}`);
    lines.push(`    stream = ${Math.round(traffic.composition.streamRatio * 100)}`);
    lines.push(`    large  = ${Math.round(traffic.composition.largeRatio * 100)}`);
    lines.push(`    async  = ${Math.round(traffic.composition.asyncRatio * 100)}`);
    lines.push("  }");
    lines.push("");
    lines.push("  key_distribution {");
    lines.push(`    kind       = "${traffic.keyDistribution.kind}"`);
    if (traffic.keyDistribution.kind === "zipf") {
      lines.push(`    alpha      = ${traffic.keyDistribution.alpha}`);
    }
    lines.push(`    space_size = ${traffic.keyDistribution.spaceSize}`);
    lines.push("  }");
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

const enum Tk {
  String,    // "foo"
  Number,    // 42  1.3
  Ident,     // resource, connection, traffic, from, to, ...
  Eq,        // =
  Dot,       // .
  LBrace,    // {
  RBrace,    // }
  EOF,
}

interface Token {
  kind: Tk;
  value: string;
  pos: number;
}

function tokenise(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src.charAt(i);

    // skip whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // skip comment
    if (ch === "#") {
      while (i < len && src.charAt(i) !== "\n") i++;
      continue;
    }

    const pos = i;

    // single-char tokens
    if (ch === "=") { tokens.push({ kind: Tk.Eq, value: "=", pos }); i++; continue; }
    if (ch === ".") { tokens.push({ kind: Tk.Dot, value: ".", pos }); i++; continue; }
    if (ch === "{") { tokens.push({ kind: Tk.LBrace, value: "{", pos }); i++; continue; }
    if (ch === "}") { tokens.push({ kind: Tk.RBrace, value: "}", pos }); i++; continue; }

    // string
    if (ch === '"') {
      i++; // skip opening quote
      let s = "";
      while (i < len && src.charAt(i) !== '"') {
        if (src.charAt(i) === "\\" && i + 1 < len) { s += src.charAt(i + 1); i += 2; continue; }
        s += src.charAt(i); i++;
      }
      if (i >= len) return null; // unterminated string
      i++; // skip closing quote
      tokens.push({ kind: Tk.String, value: s, pos });
      continue;
    }

    // number (integer or float, possibly negative)
    if (/[0-9]/.test(ch) || (ch === "-" && i + 1 < len && /[0-9]/.test(src.charAt(i + 1)))) {
      let num = "";
      if (src.charAt(i) === "-") { num += "-"; i++; }
      while (i < len && /[0-9.]/.test(src.charAt(i))) { num += src.charAt(i); i++; }
      tokens.push({ kind: Tk.Number, value: num, pos });
      continue;
    }

    // identifier (letters, digits, underscores)
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < len && /[a-zA-Z0-9_]/.test(src.charAt(i))) { id += src.charAt(i); i++; }
      tokens.push({ kind: Tk.Ident, value: id, pos });
      continue;
    }

    // unexpected character
    return null;
  }

  tokens.push({ kind: Tk.EOF, value: "", pos: i });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private advance(): Token {
    return this.tokens[this.pos++]!;
  }

  private expect(kind: Tk): Token | null {
    const t = this.peek();
    if (t.kind !== kind) return null;
    return this.advance();
  }

  /** Parse a complete HCL document. */
  parse(): SandboxImportResult | null {
    const components: Array<{ type: string; id: string; zone?: string; label?: string }> = [];
    const connections: Array<{ from: string; to: string }> = [];
    let traffic: SandboxTrafficSettings | undefined;
    let entryTargetId: string | null = null;

    while (this.peek().kind !== Tk.EOF) {
      const t = this.peek();
      if (t.kind !== Tk.Ident) return null;

      switch (t.value) {
        case "resource": {
          const res = this.parseResource();
          if (!res) return null;
          if (entryTargetId === null) entryTargetId = res.id;
          components.push(res);
          break;
        }
        case "connection": {
          const conn = this.parseConnection();
          if (!conn) return null;
          connections.push(conn);
          break;
        }
        case "traffic": {
          const tr = this.parseTraffic();
          if (!tr) return null;
          traffic = tr;
          break;
        }
        default:
          return null;
      }
    }

    if (components.length === 0 || entryTargetId === null) return null;

    const topology: TopologyDef = {
      label: "",
      components,
      entryTargetId,
      connections,
      autoScaleIds: [],
    };

    return traffic !== undefined ? { topology, traffic } : { topology };
  }

  // --- resource block ---
  private parseResource(): { type: string; id: string; zone?: string; label?: string } | null {
    this.advance(); // consume "resource"

    const typeTok = this.expect(Tk.String);
    if (!typeTok) return null;
    if (!typeTok.value.startsWith("stackattack_")) return null;
    const type = typeTok.value.slice("stackattack_".length);

    const idTok = this.expect(Tk.String);
    if (!idTok) return null;

    if (!this.expect(Tk.LBrace)) return null;

    const attrs = this.parseAttrs();
    if (attrs === null) return null;

    const result: { type: string; id: string; zone?: string; label?: string } = {
      type,
      id: idTok.value,
    };
    if (attrs["label"] !== undefined) result.label = String(attrs["label"]);
    if (attrs["zone"] !== undefined) result.zone = String(attrs["zone"]);
    return result;
  }

  // --- connection block ---
  private parseConnection(): { from: string; to: string } | null {
    this.advance(); // consume "connection"

    // name string (ignored, derived from from/to)
    if (!this.expect(Tk.String)) return null;
    if (!this.expect(Tk.LBrace)) return null;

    let fromId: string | null = null;
    let toId: string | null = null;

    while (this.peek().kind !== Tk.RBrace && this.peek().kind !== Tk.EOF) {
      const key = this.expect(Tk.Ident);
      if (!key) return null;
      if (!this.expect(Tk.Eq)) return null;

      // value is an unquoted reference: stackattack_type.id
      const ref = this.parseRef();
      if (!ref) return null;

      if (key.value === "from") fromId = ref;
      else if (key.value === "to") toId = ref;
    }

    if (!this.expect(Tk.RBrace)) return null;
    if (fromId === null || toId === null) return null;
    return { from: fromId, to: toId };
  }

  /** Parse `stackattack_<type>.<id>` and return just the id. */
  private parseRef(): string | null {
    // The reference is tokenised as: Ident("stackattack_type") Dot Ident("id")
    const typeTok = this.expect(Tk.Ident);
    if (!typeTok) return null;
    if (!this.expect(Tk.Dot)) return null;
    const idTok = this.expect(Tk.Ident);
    if (!idTok) return null;
    return idTok.value;
  }

  // --- traffic block ---
  private parseTraffic(): SandboxTrafficSettings | null {
    this.advance(); // consume "traffic"
    if (!this.expect(Tk.LBrace)) return null;

    let intensity = 50;
    let composition = {
      writeRatio: 0,
      authRatio: 0,
      streamRatio: 0,
      largeRatio: 0,
      asyncRatio: 0,
    };
    let keyDistribution: SandboxTrafficSettings["keyDistribution"] = {
      kind: "uniform" as const,
      spaceSize: 100,
    };

    while (this.peek().kind !== Tk.RBrace && this.peek().kind !== Tk.EOF) {
      const key = this.peek();
      if (key.kind !== Tk.Ident) return null;

      if (key.value === "composition") {
        this.advance();
        if (!this.expect(Tk.LBrace)) return null;
        const attrs = this.parseAttrs();
        if (attrs === null) return null;
        composition = {
          writeRatio: toRatio(attrs["write"]),
          authRatio: toRatio(attrs["auth"]),
          streamRatio: toRatio(attrs["stream"]),
          largeRatio: toRatio(attrs["large"]),
          asyncRatio: toRatio(attrs["async"]),
        };
      } else if (key.value === "key_distribution") {
        this.advance();
        if (!this.expect(Tk.LBrace)) return null;
        const attrs = this.parseAttrs();
        if (attrs === null) return null;
        const kind = String(attrs["kind"] ?? "uniform");
        if (kind === "zipf") {
          keyDistribution = {
            kind: "zipf",
            alpha: Number(attrs["alpha"] ?? 1),
            spaceSize: Number(attrs["space_size"] ?? 100),
          };
        } else {
          keyDistribution = {
            kind: "uniform",
            spaceSize: Number(attrs["space_size"] ?? 100),
          };
        }
      } else {
        // simple key = value
        this.advance();
        if (!this.expect(Tk.Eq)) return null;
        const val = this.parseValue();
        if (val === null) return null;
        if (key.value === "intensity") intensity = Number(val);
      }
    }

    if (!this.expect(Tk.RBrace)) return null;

    return { intensity, composition, keyDistribution };
  }

  // --- helpers ---

  /** Parse key=value pairs until `}`, consuming the closing brace. */
  private parseAttrs(): Record<string, string | number> | null {
    const attrs: Record<string, string | number> = {};

    while (this.peek().kind !== Tk.RBrace && this.peek().kind !== Tk.EOF) {
      const key = this.expect(Tk.Ident);
      if (!key) return null;
      if (!this.expect(Tk.Eq)) return null;
      const val = this.parseValue();
      if (val === null) return null;
      attrs[key.value] = val;
    }

    if (!this.expect(Tk.RBrace)) return null;
    return attrs;
  }

  /** Parse a single value: quoted string or number. */
  private parseValue(): string | number | null {
    const t = this.peek();
    if (t.kind === Tk.String) {
      this.advance();
      return t.value;
    }
    if (t.kind === Tk.Number) {
      this.advance();
      return parseFloat(t.value);
    }
    return null;
  }
}

function toRatio(v: string | number | undefined): number {
  if (v === undefined) return 0;
  return Number(v) / 100;
}

/** Parse an HCL string into a SandboxImportResult. Returns null on failure. */
export function fromHCL(hcl: string): SandboxImportResult | null {
  const tokens = tokenise(hcl);
  if (!tokens) return null;
  return new Parser(tokens).parse();
}

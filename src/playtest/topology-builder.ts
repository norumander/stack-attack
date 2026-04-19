/**
 * Ergonomic DSL for constructing a TopologyDef used by the playtest harness.
 *
 * Usage:
 *   const topo = topology("intended")
 *     .add("server", "s1")
 *     .add("database", "db1")
 *     .entry("s1")
 *     .connect("s1", "db1")
 *     .build();
 */

export interface TopologyDef {
  readonly label: string;
  readonly components: ReadonlyArray<{ type: string; id: string }>;
  readonly entryTargetId: string;
  readonly connections: ReadonlyArray<{ from: string; to: string }>;
}

export class TopologyBuilder {
  private readonly _label: string;
  private readonly _components: Array<{ type: string; id: string }> = [];
  private readonly _connections: Array<{ from: string; to: string }> = [];
  private _entry: string | null = null;

  constructor(label: string) {
    this._label = label;
  }

  add(type: string, id: string): this {
    this._components.push({ type, id });
    return this;
  }

  entry(targetId: string): this {
    this._entry = targetId;
    return this;
  }

  connect(from: string, to: string): this {
    this._connections.push({ from, to });
    return this;
  }

  build(): TopologyDef {
    if (this._entry === null) {
      throw new Error(`topology("${this._label}").build(): entry() was never called`);
    }
    return {
      label: this._label,
      components: [...this._components],
      entryTargetId: this._entry,
      connections: [...this._connections],
    };
  }
}

export function topology(label: string): TopologyBuilder {
  return new TopologyBuilder(label);
}

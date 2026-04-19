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
 *
 * Optional extensions:
 *   .inZone("s1", "zone_na")  // tag a placed component with a zone (W7)
 *   .autoScale("s1")           // mark a component for autoscale (W8)
 */

import type { Zone } from "@sim/types";

export interface TopologyDef {
  readonly label: string;
  readonly components: ReadonlyArray<{ type: string; id: string; zone?: Zone }>;
  readonly entryTargetId: string;
  readonly connections: ReadonlyArray<{ from: string; to: string }>;
  readonly autoScaleIds: ReadonlyArray<string>;
}

export class TopologyBuilder {
  private readonly _label: string;
  private readonly _components: Array<{ type: string; id: string; zone?: Zone }> = [];
  private readonly _connections: Array<{ from: string; to: string }> = [];
  private readonly _autoScaleIds: Set<string> = new Set();
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

  /** Tag a previously-added component with a zone. No-op if id unknown. */
  inZone(id: string, zone: Zone): this {
    for (const c of this._components) {
      if (c.id === id) {
        (c as { zone?: Zone }).zone = zone;
        return this;
      }
    }
    return this;
  }

  /** Mark a previously-added component for autoscale (applied post-build via enableAutoScale). */
  autoScale(id: string): this {
    this._autoScaleIds.add(id);
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
      autoScaleIds: [...this._autoScaleIds],
    };
  }
}

export function topology(label: string): TopologyBuilder {
  return new TopologyBuilder(label);
}

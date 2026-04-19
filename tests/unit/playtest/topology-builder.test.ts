import { describe, it, expect } from "vitest";
import { topology } from "../../../src/playtest/topology-builder";

describe("topology builder", () => {
  it("produces a TopologyDef with components, entry, and connections", () => {
    const def = topology("intended")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    expect(def.label).toBe("intended");
    expect(def.components).toEqual([
      { type: "server", id: "s1" },
      { type: "database", id: "db1" },
    ]);
    expect(def.entryTargetId).toBe("s1");
    expect(def.connections).toEqual([{ from: "s1", to: "db1" }]);
  });

  it("is chainable and returns the builder from each method", () => {
    const b = topology("chain");
    expect(b.add("server", "s1")).toBe(b);
    expect(b.entry("s1")).toBe(b);
    expect(b.connect("s1", "s1")).toBe(b);
  });

  it("throws if entry() was never called", () => {
    expect(() => topology("noentry").add("server", "s1").build()).toThrow(/entry/);
  });

  it("returns snapshots — mutating the builder after build() does not affect prior output", () => {
    const b = topology("frozen").add("server", "s1").entry("s1");
    const first = b.build();
    b.add("database", "db1").connect("s1", "db1");
    expect(first.components).toHaveLength(1);
    expect(first.connections).toHaveLength(0);
  });
});

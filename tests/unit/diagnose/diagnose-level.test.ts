import { describe, expect, it } from "vitest";
import { DIAGNOSE_LEVELS, type DiagnoseLevel } from "../../../src/diagnose/diagnose-level";
import { PLACEHOLDER_DIAGNOSE_LEVEL } from "../../../src/diagnose/placeholder-level";

describe("DiagnoseLevel catalogue", () => {
  it("DIAGNOSE_LEVELS is populated with the Instagram arc (5 levels)", () => {
    expect(DIAGNOSE_LEVELS.length).toBe(5);
    expect(DIAGNOSE_LEVELS.map((l) => l.id)).toEqual([
      "instagram-1",
      "instagram-2",
      "instagram-3",
      "instagram-4",
      "instagram-5",
    ]);
  });

  it("placeholder level conforms to DiagnoseLevel and is NOT in the catalogue", () => {
    const level: DiagnoseLevel = PLACEHOLDER_DIAGNOSE_LEVEL;
    expect(level.id).toBe("__diagnose_placeholder__");
    expect(level.startingTopology.components.length).toBeGreaterThan(0);
    expect(level.remediationBudget).toBeGreaterThan(0);
    expect(level.sla.availability).toBeGreaterThan(0);
    expect(DIAGNOSE_LEVELS).not.toContain(level);
  });

  it("placeholder starting topology has entry target and at least one connection", () => {
    const topo = PLACEHOLDER_DIAGNOSE_LEVEL.startingTopology;
    expect(topo.entryTargetId).toBeTruthy();
    expect(topo.connections.length).toBeGreaterThan(0);
    // Every connection endpoint resolves to a known component.
    const ids = new Set(topo.components.map((c) => c.id));
    for (const edge of topo.connections) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });
});

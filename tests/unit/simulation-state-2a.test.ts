import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { StagedOutcome } from "@core/engine/staged-outcome";

describe("SimulationState Stage 2a additions", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("initializes new fields empty", () => {
    const s = new SimulationState(topo);
    expect(s.visitOrder).toEqual([]);
    expect(s.stagedOutcomes).toEqual([]);
    expect(s.blockedParents.size).toBe(0);
    expect(s.childToParent.size).toBe(0);
    expect(s.roundRobinCursor.size).toBe(0);
    expect(s.metricsHistory).toEqual([]);
  });

  it("stagedOutcomes accepts StagedOutcome entries", () => {
    const s = new SimulationState(topo);
    const entry: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: { id: "r1" as RequestId } as any,
      result: { outcome: { kind: "DROP", reason: "test" }, sideEffects: [], events: [] },
    };
    s.stagedOutcomes.push(entry);
    expect(s.stagedOutcomes).toHaveLength(1);
  });
});

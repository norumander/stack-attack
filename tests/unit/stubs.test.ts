import { describe, it, expect } from "vitest";
import { updateCondition } from "@core/engine/update-condition";
import { injectChaos } from "@core/engine/inject-chaos";
import { deductUpkeep } from "@core/engine/deduct-upkeep";
import { SimulationState } from "@core/state/simulation-state";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { ComponentId } from "@core/types/ids";

function snapshotSizes(state: SimulationState) {
  return {
    components: state.components.size,
    connections: state.connections.size,
    pending: state.pending.size,
    activeStreams: state.activeStreams.size,
    requestLog: state.requestLog.size,
    activeChaos: state.activeChaos.size,
    perComponentThisTick: state.perComponentThisTick.size,
    connectionLoadThisTick: state.connectionLoadThisTick.size,
    visitOrder: state.visitOrder.length,
    stagedOutcomes: state.stagedOutcomes.length,
    blockedParents: state.blockedParents.size,
    childToParent: state.childToParent.size,
    roundRobinCursor: state.roundRobinCursor.size,
    metricsHistory: state.metricsHistory.length,
    currentTick: state.currentTick,
    phase: state.phase,
  };
}

function makeMC() {
  return new NoOpModeController({
    targetEntryPointId: "irrelevant" as ComponentId,
    intensity: 0,
    requestType: "api_read",
  });
}

describe("Stage 2a stubs (steps 6, 6b, 7)", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("updateCondition is a no-op", () => {
    const state = new SimulationState(topo);
    const before = snapshotSizes(state);
    updateCondition(state, makeMC());
    expect(snapshotSizes(state)).toEqual(before);
  });

  it("injectChaos is a no-op", () => {
    const state = new SimulationState(topo);
    const before = snapshotSizes(state);
    injectChaos(state, makeMC());
    expect(snapshotSizes(state)).toEqual(before);
  });

  it("deductUpkeep is a no-op", () => {
    const state = new SimulationState(topo);
    const before = snapshotSizes(state);
    deductUpkeep(state, makeMC());
    expect(snapshotSizes(state)).toEqual(before);
  });

  it("all three are callable in sequence without throwing", () => {
    const state = new SimulationState(topo);
    const mc = makeMC();
    expect(() => {
      updateCondition(state, mc);
      injectChaos(state, mc);
      deductUpkeep(state, mc);
    }).not.toThrow();
  });
});

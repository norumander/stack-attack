import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { createRng } from "@core/engine/rng";
import { makeRandomTopology } from "@harness/random-topology";
import type { RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { SimulationState } from "@core/state/simulation-state";
import type { TickMetrics } from "@core/types/metrics";

const SEEDS = [
  "determinism-1",
  "determinism-2",
  "determinism-3",
  "determinism-4",
  "determinism-5",
];

function serializeHistory(history: readonly TickMetrics[]): unknown[] {
  return history.map((snap) => ({
    tick: snap.tick,
    requestsProcessed: snap.requestsProcessed,
    requestsResolved: snap.requestsResolved,
    requestsDropped: snap.requestsDropped,
    requestsOverloaded: snap.requestsOverloaded,
    requestsBackpressured: snap.requestsBackpressured,
    requestsTimedOut: snap.requestsTimedOut,
    revenueEarned: snap.revenueEarned,
    upkeepPaid: snap.upkeepPaid,
    avgLatency: snap.avgLatency,
    perComponent: [...snap.perComponent.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([id, v]) => [id, { ...v }]),
  }));
}

function runOnce(seed: string): SimulationState["metricsHistory"] {
  const rng1 = createRng(seed);
  const topo = makeRandomTopology(rng1);
  const state = topo.state;
  const mc = new NoOpModeController({
    targetEntryPointId: topo.entryComponentId,
    intensity: 0,
    requestType: "api_read",
  });
  const engine = new Engine(state);

  // Deterministic traffic schedule: inject 1 request each of the first 5 ticks.
  for (let i = 0; i < 5; i++) {
    const req: Request = {
      id: `r-${seed}-${i}` as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: topo.entryComponentId,
      createdAt: state.currentTick,
      ttl: 1000,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
    state.requestLog.set(req.id, []);
    state.enqueuePending(topo.entryComponentId, req);
    engine.tick(mc);
  }
  for (let t = 0; t < 15; t++) engine.tick(mc);

  return state.metricsHistory;
}

describe("property — deterministic tick-by-tick metrics across identical runs", () => {
  it("two engines with the same seed, topology, and traffic produce identical metricsHistory (5 seeds)", () => {
    for (const seed of SEEDS) {
      const runA = runOnce(seed);
      const runB = runOnce(seed);
      expect(runA.length).toBe(runB.length);
      // Compare via JSON serialization with Map expansion for stable equality check.
      expect(serializeHistory(runA)).toEqual(serializeHistory(runB));
    }
  });
});

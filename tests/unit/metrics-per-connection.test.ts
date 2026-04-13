import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state.js";
import { recordMetrics } from "@core/engine/metrics-builder.js";
import type { ConnectionId } from "@core/types/ids.js";

describe("TickMetrics.perConnection", () => {
  it("snapshots connectionLoadThisTick into metrics", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    state.connectionLoadThisTick.set("c1" as ConnectionId, 42);
    state.connectionLoadThisTick.set("c2" as ConnectionId, 7);

    recordMetrics(state);

    const metrics = state.metricsHistory[state.metricsHistory.length - 1]!;
    expect(metrics.perConnection).toBeDefined();
    expect(metrics.perConnection!.get("c1" as ConnectionId)?.loadThisTick).toBe(42);
    expect(metrics.perConnection!.get("c2" as ConnectionId)?.loadThisTick).toBe(7);
  });

  it("produces an empty perConnection map when no loads are recorded", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    recordMetrics(state);
    const metrics = state.metricsHistory[state.metricsHistory.length - 1]!;
    expect(metrics.perConnection).toBeDefined();
    expect(metrics.perConnection!.size).toBe(0);
  });
});

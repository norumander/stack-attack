import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_1 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import { buildServer, runWave } from "./helpers.js";

describe("Wave 1 — Launch Day", () => {
  it("trivial Server topology wins cleanly", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const server = buildServer(compRegistry);
    state.placeComponent(server.component);

    // Wave 1 entry point is the Server itself (no upstream client/LB in this slice).
    // TDTrafficSource injects requests at the entry point, matching how
    // SandboxModeController tests inject traffic.

    const result = runWave(state, WAVE_1, server.component.id);

    expect(result.outcome.verdict).toBe("win");
    expect(result.droppedCount).toBe(0);
    expect(result.timedOutCount).toBe(0);
    expect(result.totalRequests).toBe(WAVE_1.intensity * WAVE_1.duration);

    const serverProcessed =
      result.processedCountByComponent.get(server.component.id) ?? 0;
    expect(serverProcessed).toBeGreaterThan(0);
  });
});

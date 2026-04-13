import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_1 } from "@modes/td/td-waves";
import { buildServer, runWave } from "./helpers.js";
import type { ComponentId } from "@core/types/ids";

describe("Wave 1 — Launch Day", () => {
  it("trivial Server topology wins cleanly", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const server = buildServer("c-server");
    state.placeComponent(server.component);

    // Wave 1 entry point is the Server itself (no upstream client/LB in this slice).
    // TDTrafficSource injects requests with origin=c-server, which matches how
    // SandboxModeController tests inject traffic at the entry point.

    const result = runWave(state, WAVE_1, "c-server" as ComponentId);

    expect(result.outcome.verdict).toBe("win");
    expect(result.droppedCount).toBe(0);
    expect(result.timedOutCount).toBe(0);
    expect(result.totalRequests).toBe(WAVE_1.intensity * WAVE_1.duration);

    // Verify reads were actually processed at the Server.
    const serverProcessed =
      result.processedCountByComponent.get("c-server" as ComponentId) ?? 0;
    expect(serverProcessed).toBeGreaterThan(0);
  });
});

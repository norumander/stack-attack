import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_1 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";

describe("Wave 1 — Launch Day", () => {
  it("trivial Server+Database topology wins cleanly", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const server = buildServer(compRegistry);
    const db = buildDatabase(compRegistry);
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    // Post Data Cache redesign: Server forwards api_read to its downstream,
    // so a Database is required even for 100%-read Wave 1 — the Server no
    // longer self-responds to reads.
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-server-db",
    );

    // Wave 1 entry point is the Server itself (no upstream client/LB in this slice).
    // TDTrafficSource injects requests at the entry point, matching how
    // SandboxModeController tests inject traffic.

    const result = runWave(state, WAVE_1, server.component.id);

    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);
    expect(result.droppedCount).toBe(0);
    expect(result.timedOutCount).toBe(0);
    expect(result.totalRequests).toBe(WAVE_1.intensity * WAVE_1.duration);

    // Server forwards api_read to Database; Database's StorageCapability
    // does not handle api_read — so reads are just counted as forwarded
    // at Server. (Wave 1 is 100% api_read; the point here is wave passes.)
    const serverForwarded =
      result.forwardedCountByComponent.get(server.component.id) ?? 0;
    expect(serverForwarded).toBeGreaterThan(0);
  });
});

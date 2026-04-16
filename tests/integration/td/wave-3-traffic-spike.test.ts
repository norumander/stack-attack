import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";

describe("Wave 3 — Traffic Spikes (lone Server → Database)", () => {
  it("Server → Database alone loses under Wave 3 load (DB saturates on reads)", () => {
    // Post-Data-Cache-redesign topology: Server forwards api_read to DB.
    // At Wave 3's 50/tick (35 reads/tick + 15 writes/tick), DB tier-1
    // capacity (25/tick) saturates → drops climb past the 5% threshold.
    // Teaching moment: "your Database is the bottleneck, add a Data Cache".
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const server = buildServer(compRegistry);
    const db = buildDatabase(compRegistry);
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-server-db",
    );

    const result = runWave(state, WAVE_3, server.component.id);

    expect(result.outcome.verdict).toBe("lose");
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeGreaterThanOrEqual(0.05);
  });
});

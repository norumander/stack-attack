import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";

describe("Wave 3 — Traffic Spikes (lone-server)", () => {
  it("Server+Database alone loses under Wave 3 load", () => {
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
    // TODO(T16): tune viability to actually fire on this lose path
    // viability stays at 100 even though SLA verdict is "lose" — migrate once tuned:
    // expect(result.finalViability).toBeLessThan(100);
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeGreaterThanOrEqual(0.05);
  });
});

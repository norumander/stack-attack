import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";
import type { ComponentId } from "@core/types/ids";

describe("Wave 3 — Traffic Spikes (lone-server)", () => {
  it("Server+Database alone loses under Wave 3 load", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const server = buildServer("c-server");
    const db = buildDatabase("c-db");
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-server-db",
    );

    const result = runWave(state, WAVE_3, "c-server" as ComponentId);

    expect(result.outcome.verdict).toBe("lose");
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeGreaterThanOrEqual(0.05);
  });
});

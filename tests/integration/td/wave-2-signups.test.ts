import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_2 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";

describe("Wave 2 — Users Start Signing Up", () => {
  it("Server+Database topology wins and writes reach the Database", () => {
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

    const result = runWave(state, WAVE_2, server.component.id);

    expect(result.outcome.verdict).toBe("win");

    const total = result.totalRequests;
    const dropRate = (result.droppedCount + result.timedOutCount) / total;
    expect(dropRate).toBeLessThan(0.05);

    // Writes flowed Server → Database via Forwarding + Storage PROCESSED events.
    const serverForwardCount =
      result.forwardedCountByComponent.get(server.component.id) ?? 0;
    expect(serverForwardCount).toBeGreaterThan(0);

    const dbProcessedCount =
      result.processedCountByComponent.get(db.component.id) ?? 0;
    expect(dbProcessedCount).toBeGreaterThan(0);

    // Sanity: write-routing volume ≈ generated write count.
    // Wave 2: 25 * 30 * 0.3 = 225 expected writes.
    expect(serverForwardCount).toBeGreaterThan(100);
    expect(dbProcessedCount).toBeGreaterThan(100);
  });
});

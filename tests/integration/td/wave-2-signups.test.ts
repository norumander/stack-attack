import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_2 } from "@modes/td/td-waves";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";
import type { ComponentId } from "@core/types/ids";

describe("Wave 2 — Users Start Signing Up", () => {
  it("Server+Database topology wins and writes reach the Database", () => {
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

    const result = runWave(state, WAVE_2, "c-server" as ComponentId);

    expect(result.outcome.verdict).toBe("win");

    const total = result.totalRequests;
    const dropRate = (result.droppedCount + result.timedOutCount) / total;
    expect(dropRate).toBeLessThan(0.05);

    // Writes flowed Server → Database.
    // - Server's ForwardingCapability emitted FORWARDED events.
    const serverForwardCount =
      result.forwardedCountByComponent.get("c-server" as ComponentId) ?? 0;
    expect(serverForwardCount).toBeGreaterThan(0);

    // - Database's StorageCapability processed the writes.
    const dbProcessedCount =
      result.processedCountByComponent.get("c-db" as ComponentId) ?? 0;
    expect(dbProcessedCount).toBeGreaterThan(0);

    // Sanity: write-routing volume should be roughly equal to the generated write count.
    // Wave 2: 25 * 30 * 0.3 = 225 expected writes.
    expect(serverForwardCount).toBeGreaterThan(100); // loose lower bound
    expect(dbProcessedCount).toBeGreaterThan(100);
  });
});

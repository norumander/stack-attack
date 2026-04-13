import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import {
  buildServer,
  buildDatabase,
  buildCache,
  buildLoadBalancer,
  wire,
  runWave,
} from "./helpers.js";
import type { ComponentId } from "@core/types/ids";

describe("Wave 3 — Learning arc", () => {
  it("Cache rescue: Entry → Cache → Server → Database wins", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const cache = buildCache("c-cache");
    const server = buildServer("c-server");
    const db = buildDatabase("c-db");
    state.placeComponent(cache.component);
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    wire(
      state,
      { component: cache.component, egressPortId: cache.egressPortId },
      { component: server.component, ingressPortId: server.ingressPortId },
      "cx-cache-server",
    );
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-server-db",
    );

    const result = runWave(state, WAVE_3, "c-cache" as ComponentId);

    expect(result.outcome.verdict).toBe("win");

    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeLessThan(0.05);

    // Cache must actually be doing work: hit count in meaningful range.
    const cachedHits = result.eventCountsByType.get("CACHED_HIT") ?? 0;
    expect(cachedHits).toBeGreaterThan(0);
    // Loose sanity: at least 10% of generated reads should hit the cache.
    const expectedReads = WAVE_3.intensity * WAVE_3.duration * 0.7;
    expect(cachedHits).toBeGreaterThan(expectedReads * 0.1);
  });

  it("LB rescue: Entry → LB → [Server1, Server2] → Database wins", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const lb = buildLoadBalancer("c-lb", 2);
    const server1 = buildServer("c-server-1");
    const server2 = buildServer("c-server-2");
    const db = buildDatabase("c-db");
    state.placeComponent(lb.component);
    state.placeComponent(server1.component);
    state.placeComponent(server2.component);
    state.placeComponent(db.component);

    wire(
      state,
      { component: lb.component, egressPortId: lb.egressPortIds[0]! },
      { component: server1.component, ingressPortId: server1.ingressPortId },
      "cx-lb-s1",
    );
    wire(
      state,
      { component: lb.component, egressPortId: lb.egressPortIds[1]! },
      { component: server2.component, ingressPortId: server2.ingressPortId },
      "cx-lb-s2",
    );
    wire(
      state,
      { component: server1.component, egressPortId: server1.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-s1-db",
    );
    wire(
      state,
      { component: server2.component, egressPortId: server2.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-s2-db",
    );

    const result = runWave(state, WAVE_3, "c-lb" as ComponentId);

    expect(result.outcome.verdict).toBe("win");
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeLessThan(0.05);

    // Both servers must have received traffic — via PROCESSED events per component.
    const s1Processed = result.processedCountByComponent.get("c-server-1" as ComponentId) ?? 0;
    const s2Processed = result.processedCountByComponent.get("c-server-2" as ComponentId) ?? 0;
    expect(s1Processed).toBeGreaterThan(0);
    expect(s2Processed).toBeGreaterThan(0);

    // Load distribution is meaningful — neither server is starved below 20%.
    const totalServerProcessed = s1Processed + s2Processed;
    expect(s1Processed / totalServerProcessed).toBeGreaterThan(0.2);
    expect(s2Processed / totalServerProcessed).toBeGreaterThan(0.2);
  });
});

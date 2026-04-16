import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import {
  buildServer,
  buildDatabase,
  buildDataCache,
  buildLoadBalancer,
  wire,
  runWave,
} from "./helpers.js";

describe("Wave 3 — Learning arc (post Data Cache redesign)", () => {
  it("Data Cache rescue: Entry → Server → Data Cache → Database wins", () => {
    // Server forwards api_read downstream. Data Cache (between Server and DB)
    // intercepts reads via INTERCEPT phase: hits RESPOND, misses PASS through
    // forwarding-pipe → DB. With keyPoolSize 10 ≤ tier-1 cache capacity 10,
    // hit rate approaches 100% after warmup → DB pressure relieved → wave passes.
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const server = buildServer(compRegistry);
    const dataCache = buildDataCache(compRegistry);
    const db = buildDatabase(compRegistry);
    state.placeComponent(server.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(db.component);

    // Server → Data Cache → Database
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "cx-server-dc",
    );
    wire(
      state,
      { component: dataCache.component, egressPortId: dataCache.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-dc-db",
    );

    const result = runWave(state, WAVE_3, server.component.id);

    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);

    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeLessThan(0.05);

    // Data Cache must actually be doing work: hit count in meaningful range.
    const cachedHits = result.eventCountsByType.get("CACHED_HIT") ?? 0;
    expect(cachedHits).toBeGreaterThan(0);
    // Loose sanity: at least 10% of generated reads should hit the Data Cache.
    const expectedReads = WAVE_3.intensity * WAVE_3.duration * 0.7;
    expect(cachedHits).toBeGreaterThan(expectedReads * 0.1);
  });

  it("LB + Data Cache rescue: Entry → LB → [Server1, Server2] → Data Cache → Database wins", () => {
    // Two Servers fan out via LB, then fan in to a single shared Data Cache,
    // which absorbs repeated reads before they hit DB. LB still demonstrates
    // load distribution (both Servers > 20% of total processed). Data Cache
    // demonstrates DB protection. Pure LB-without-Data-Cache is no longer a
    // win path because Servers forward all reads to DB which saturates at
    // tier-1 cap 25/tick while Wave 3 generates 35 reads/tick — captured as
    // "Future considerations" in the spec for a separate LB tuning task.
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const lb = buildLoadBalancer("c-lb", 2);
    const server1 = buildServer(compRegistry);
    const server2 = buildServer(compRegistry);
    const dataCache = buildDataCache(compRegistry);
    const db = buildDatabase(compRegistry);
    state.placeComponent(lb.component);
    state.placeComponent(server1.component);
    state.placeComponent(server2.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(db.component);

    // LB → Server1, LB → Server2
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

    // Server1 → Data Cache, Server2 → Data Cache (fan-in)
    wire(
      state,
      { component: server1.component, egressPortId: server1.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "cx-s1-dc",
    );
    wire(
      state,
      { component: server2.component, egressPortId: server2.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "cx-s2-dc",
    );

    // Data Cache → DB
    wire(
      state,
      { component: dataCache.component, egressPortId: dataCache.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-dc-db",
    );

    const result = runWave(state, WAVE_3, lb.component.id);

    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeLessThan(0.05);

    // Both servers must have received traffic — via FORWARDED events per component
    // (they forward instead of process now that api_read moved to forwarding cap).
    const s1Forwarded = result.forwardedCountByComponent.get(server1.component.id) ?? 0;
    const s2Forwarded = result.forwardedCountByComponent.get(server2.component.id) ?? 0;
    expect(s1Forwarded).toBeGreaterThan(0);
    expect(s2Forwarded).toBeGreaterThan(0);

    // Load distribution is meaningful — neither server is starved below 20%.
    const totalServerForwarded = s1Forwarded + s2Forwarded;
    expect(s1Forwarded / totalServerForwarded).toBeGreaterThan(0.2);
    expect(s2Forwarded / totalServerForwarded).toBeGreaterThan(0.2);
  });
});

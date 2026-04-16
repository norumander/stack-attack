import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_9 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";
import type { CapabilityId } from "@core/types/ids";
import {
  runWave, buildServer, buildDatabase, buildDataCache, buildCDN,
  buildLoadBalancer, buildStreamingServer, buildDNSGTM,
  buildWorker, wire,
} from "./helpers";

describe("Wave 9 — multi-zone DNS/GTM rescue wins with latency SLA", () => {
  it("DNS/GTM + per-zone infrastructure rescues Wave 9 from cross-zone latency", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({
      zones: ["na-east", "eu-west", "ap-south"],
      pairLatency: new Map([
        [zonePairKey("na-east", "ap-south"), 5],
        [zonePairKey("na-east", "eu-west"), 3],
        [zonePairKey("eu-west", "ap-south"), 4],
      ]),
    });

    // Rescue topology: DNS/GTM IS the entry point (no Client in front).
    // Previous waves used Client → downstream, but Client's forwarding-pipe
    // maxes at 500/tick (tier 1, maxTier 1). Wave 9's 800/tick would saturate it.
    // DNS/GTM serves as both traffic entry point and geo-router.
    //
    //   DNS/GTM → [zone: CDN → Cache → StreamServer → LB ��� Server×N → DB]
    //
    // Tuning decisions:
    // - DNS upgraded to tier 2 forwarding-pipe (1000/tick) for 800/tick intensity.
    // - Lean per-zone pipeline (CDN → Cache → StreamServer → LB → Servers → DB)
    //   keeps hop count low for tight maxAvgLatency: 4 SLA.
    // - StreamServer handles 30% stream traffic inline (RESPOND at hop 4 from DNS).
    // - CDN+Cache absorb static_asset hits early (hop 1-2 from DNS).
    // - Zone sizing: NA 5 (40%), EU 5 (35%), AP 4 (25%).

    // --- DNS/GTM as entry point ---
    const dns = buildDNSGTM(compRegistry);
    // Upgrade forwarding-pipe to tier 2 (1000/tick) to handle 800/tick intensity.
    // playerTier is used for throughput calculation (not capped by getTierCap).
    dns.component.upgrade("forwarding-pipe" as CapabilityId, 2);

    // --- Helper to build a zone's full stack ---
    // Post Data Cache redesign: per-zone Data Cache between Servers and DB.
    function buildZoneStack(zone: string, prefix: string, serverCount: number) {
      const cdn = buildCDN(compRegistry, zone);
      const stream = buildStreamingServer(compRegistry, zone);
      const worker = buildWorker(compRegistry, zone);
      const lb = buildLoadBalancer(`${prefix}-lb`, serverCount);
      const servers: ReturnType<typeof buildServer>[] = [];
      for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry, zone));
      const dataCache = buildDataCache(compRegistry, zone);
      const db = buildDatabase(compRegistry, zone);

      // Upgrade per-zone Data Cache and DB to handle Wave 9 intensity.
      dataCache.component.upgrade("caching" as CapabilityId, 3);
      dataCache.component.upgrade("caching" as CapabilityId, 3);
      db.component.upgrade("storage" as CapabilityId, 3);
      db.component.upgrade("storage" as CapabilityId, 3);

      // Place all
      state.placeComponent(cdn.component);
      state.placeComponent(stream.component);
      state.placeComponent(worker.component);
      state.placeComponent(lb.component);
      for (const s of servers) state.placeComponent(s.component);
      state.placeComponent(dataCache.component);
      state.placeComponent(db.component);

      // Wire: CDN -> StreamServer -> Worker -> LB -> Servers -> Data Cache -> DB
      // Worker handles batch (BatchProcessing RESPOND) and forwards the rest.
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: stream.component, ingressPortId: stream.ingressPortId }, `c-${prefix}-cdn-stream`, { bandwidth: 15000 });
      wire(state, { component: stream.component, egressPortId: stream.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, `c-${prefix}-stream-worker`, { bandwidth: 800 });
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, `c-${prefix}-worker-lb`, { bandwidth: 800 });

      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-${prefix}-lb-s${i}`, { bandwidth: 800 });
      }
      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, `c-${prefix}-s${i}-dc`, { bandwidth: 800 });
      }
      wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-${prefix}-dc-db`, { bandwidth: 800 });

      return { cdn, servers };
    }

    // --- Place DNS ---
    state.placeComponent(dns.component);

    // --- Build zones ---
    const na = buildZoneStack("na-east", "na", 6);
    const eu = buildZoneStack("eu-west", "eu", 5);
    const ap = buildZoneStack("ap-south", "ap", 5);

    // DNS/GTM → zone CDNs (all share dns.egressPortId — single egress port)
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na-cdn", { bandwidth: 800 });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu-cdn", { bandwidth: 800 });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap-cdn", { bandwidth: 800 });

    const result = runWave(state, WAVE_9, dns.component.id);

    // --- Diagnostic dump on failure ---
    if (result.terminalState !== "wave_passed") {
      console.log("=== Wave 9 Multi-Zone DNS Rescue Diagnostic ===");
      console.log("SLA results:", JSON.stringify(result.outcome.slaResults, null, 2));
      console.log("Total:", result.totalRequests, "Dropped:", result.droppedCount, "TimedOut:", result.timedOutCount);
      console.log("DNS forwarded:", result.forwardedCountByComponent.get(dns.component.id) ?? 0);
      console.log("Events:", Object.fromEntries(result.eventCountsByType));
    }

    // 1. Verdict is wave_passed
    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);

    // 2. Latency SLA passes (maxAvgLatency: 4)
    expect(result.outcome.slaResults?.latency.passed).toBe(true);

    // 3. Availability SLA passes (90%)
    expect(result.outcome.slaResults?.availability.passed).toBe(true);

    // 4. DNS/GTM actually forwarded requests
    const dnsForwarded = result.forwardedCountByComponent.get(dns.component.id) ?? 0;
    expect(dnsForwarded).toBeGreaterThan(0);
  });
});

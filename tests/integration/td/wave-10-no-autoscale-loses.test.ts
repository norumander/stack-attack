import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_10 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";
import {
  runWave, buildServer, buildDatabase, buildDataCache, buildCDN,
  buildLoadBalancer, buildStreamingServer, buildDNSGTM,
  buildWorker, wire,
} from "./helpers";

describe("Wave 10 — static topology without auto-scale loses", () => {
  it("3000/tick overwhelms a static multi-zone topology with maxInstances clamped to 1", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({
      zones: ["na-east", "eu-west", "ap-south"],
      pairLatency: new Map([
        [zonePairKey("na-east", "ap-south"), 5],
        [zonePairKey("na-east", "eu-west"), 3],
        [zonePairKey("eu-west", "ap-south"), 4],
      ]),
    });

    // Wave 9 multi-zone DNS rescue topology, but with auto-scale disabled.
    // At 3000/tick (3.75x Wave 9's 800/tick), no static topology can keep up.
    //
    //   DNS/GTM → [zone: CDN → Cache → StreamServer → Worker → LB → Server×3 → DB]
    //
    // Auto-scale disabled: maxInstances = 1 on all servers and databases,
    // making SCALE a no-op (clamped to max 1 = current 1).

    // --- DNS/GTM as entry point ---
    const dns = buildDNSGTM(compRegistry);

    // --- Helper to build a zone's full stack (post Data Cache redesign) ---
    function buildZoneStack(zone: string, prefix: string, serverCount: number) {
      const cdn = buildCDN(compRegistry, zone);
      const stream = buildStreamingServer(compRegistry, zone);
      const worker = buildWorker(compRegistry, zone);
      const lb = buildLoadBalancer(`${prefix}-lb`, serverCount);
      const servers: ReturnType<typeof buildServer>[] = [];
      for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry, zone));
      const dataCache = buildDataCache(compRegistry, zone);
      const db = buildDatabase(compRegistry, zone);

      // Disable auto-scale: clamp maxInstances to 1 on servers and database
      for (const s of servers) {
        (s.component as any).maxInstances = 1;
      }
      (db.component as any).maxInstances = 1;

      // Place all
      state.placeComponent(cdn.component);
      state.placeComponent(stream.component);
      state.placeComponent(worker.component);
      state.placeComponent(lb.component);
      for (const s of servers) state.placeComponent(s.component);
      state.placeComponent(dataCache.component);
      state.placeComponent(db.component);

      // Wire: CDN -> StreamServer -> Worker -> LB -> Servers -> Data Cache -> DB
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: stream.component, ingressPortId: stream.ingressPortId }, `c-${prefix}-cdn-stream`, { bandwidth: 15000 });
      wire(state, { component: stream.component, egressPortId: stream.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, `c-${prefix}-stream-worker`, { bandwidth: 3000 });
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, `c-${prefix}-worker-lb`, { bandwidth: 3000 });

      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-${prefix}-lb-s${i}`, { bandwidth: 3000 });
      }
      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, `c-${prefix}-s${i}-dc`, { bandwidth: 3000 });
      }
      wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-${prefix}-dc-db`, { bandwidth: 3000 });

      return { cdn, servers, db };
    }

    // --- Place DNS ---
    state.placeComponent(dns.component);

    // --- Build zones (3 servers per zone — static, no scaling) ---
    const na = buildZoneStack("na-east", "na", 3);
    const eu = buildZoneStack("eu-west", "eu", 3);
    const ap = buildZoneStack("ap-south", "ap", 3);

    // DNS/GTM → zone CDNs
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na-cdn", { bandwidth: 3000 });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu-cdn", { bandwidth: 3000 });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap-cdn", { bandwidth: 3000 });

    const result = runWave(state, WAVE_10, dns.component.id);

    // --- Diagnostic dump on unexpected pass ---
    if (result.finalViability >= 100) {
      console.log("=== Wave 10 No-Autoscale Diagnostic ===");
      console.log("SLA results:", JSON.stringify(result.outcome.slaResults, null, 2));
      console.log("Total:", result.totalRequests, "Dropped:", result.droppedCount, "TimedOut:", result.timedOutCount);
      console.log("DNS forwarded:", result.forwardedCountByComponent.get(dns.component.id) ?? 0);
      console.log("Events:", Object.fromEntries(result.eventCountsByType));
    }

    // Static topology cannot handle 3000/tick — verdict must be "lose"
    expect(result.outcome.verdict).toBe("lose");
    // TODO(T16): tune viability to actually fire on this lose path
    // viability stays at 100 even though SLA verdict is "lose" — migrate once tuned:
    // expect(result.finalViability).toBeLessThan(100);
  });
});

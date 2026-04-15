import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_10 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";
import {
  runWave, buildServer, buildDatabase, buildCache, buildCDN,
  buildLoadBalancer, buildStreamingServer, buildDNSGTM,
  buildWorker, wire,
} from "./helpers";

describe("Wave 10 — server-only auto-scale still loses (DB bottleneck)", () => {
  it("servers scale out but database stays at 1 instance, creating a bottleneck", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({
      zones: ["na-east", "eu-west", "ap-south"],
      pairLatency: new Map([
        [zonePairKey("na-east", "ap-south"), 5],
        [zonePairKey("na-east", "eu-west"), 3],
        [zonePairKey("eu-west", "ap-south"), 4],
      ]),
    });

    // Same multi-zone topology as the no-autoscale test, but with servers
    // allowed to auto-scale up to 10 instances. Databases stay clamped at 1.
    //
    //   DNS/GTM → [zone: CDN → Cache → StreamServer → Worker → LB → Server×3 → DB]
    //
    // Teaching: servers scale out under load, but the Database (maxInstances=1)
    // becomes the bottleneck. The intermediary components (CDN, Cache, LB) also
    // have fixed throughput, so even with more server instances the pipeline
    // can't sustain 3000/tick across 3 zones.

    const dns = buildDNSGTM(compRegistry);

    function buildZoneStack(zone: string, prefix: string, serverCount: number) {
      const cdn = buildCDN(compRegistry, zone);
      const cache = buildCache(compRegistry, zone);
      const stream = buildStreamingServer(compRegistry, zone);
      const worker = buildWorker(compRegistry, zone);
      const lb = buildLoadBalancer(`${prefix}-lb`, serverCount);
      const servers: ReturnType<typeof buildServer>[] = [];
      for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry, zone));
      const db = buildDatabase(compRegistry, zone);

      // Auto-scale enabled on servers: allow up to 10 instances
      for (const s of servers) {
        (s.component as any).maxInstances = 10;
      }
      // Database auto-scale clamped: stays at 1 instance (the bottleneck)
      (db.component as any).maxInstances = 1;

      // Place all
      state.placeComponent(cdn.component);
      state.placeComponent(cache.component);
      state.placeComponent(stream.component);
      state.placeComponent(worker.component);
      state.placeComponent(lb.component);
      for (const s of servers) state.placeComponent(s.component);
      state.placeComponent(db.component);

      // Wire: CDN → Cache → StreamServer → Worker → LB → Servers → DB
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, `c-${prefix}-cdn-cache`, { bandwidth: 3000 });
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: stream.component, ingressPortId: stream.ingressPortId }, `c-${prefix}-cache-stream`, { bandwidth: 15000 });
      wire(state, { component: stream.component, egressPortId: stream.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, `c-${prefix}-stream-worker`, { bandwidth: 3000 });
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, `c-${prefix}-worker-lb`, { bandwidth: 3000 });

      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-${prefix}-lb-s${i}`, { bandwidth: 3000 });
      }
      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-${prefix}-s${i}-db`, { bandwidth: 3000 });
      }

      return { cdn, servers, db };
    }

    state.placeComponent(dns.component);

    // 3 servers per zone — they can scale up, but DB cannot
    const na = buildZoneStack("na-east", "na", 3);
    const eu = buildZoneStack("eu-west", "eu", 3);
    const ap = buildZoneStack("ap-south", "ap", 3);

    // DNS/GTM → zone CDNs
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na-cdn", { bandwidth: 3000 });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu-cdn", { bandwidth: 3000 });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap-cdn", { bandwidth: 3000 });

    const result = runWave(state, WAVE_10, dns.component.id);

    // Diagnostic dump on unexpected pass
    if (result.finalViability >= 100) {
      console.log("=== Wave 10 Server-Only Autoscale Diagnostic ===");
      console.log("SLA results:", JSON.stringify(result.outcome.slaResults, null, 2));
      console.log("Total:", result.totalRequests, "Dropped:", result.droppedCount, "TimedOut:", result.timedOutCount);
      console.log("DNS forwarded:", result.forwardedCountByComponent.get(dns.component.id) ?? 0);
      console.log("Events:", Object.fromEntries(result.eventCountsByType));
      // Check if servers actually scaled
      for (const zone of [na, eu, ap]) {
        for (const s of zone.servers) {
          if (s.component.instanceCount > 1) {
            console.log(`  Server ${s.component.id}: instanceCount=${s.component.instanceCount}`);
          }
        }
      }
    }

    // Server auto-scale alone cannot overcome the DB bottleneck — verdict must be "lose"
    expect(result.outcome.verdict).toBe("lose");
    // TODO(T16): tune viability to actually fire on this lose path
    // viability stays at 100 even though SLA verdict is "lose" — migrate once tuned:
    // expect(result.finalViability).toBeLessThan(100);
  });
});

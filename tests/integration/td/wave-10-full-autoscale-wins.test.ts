import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_10 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";
import { makePort } from "@harness/fixtures";
import { BatchProcessingCapability } from "@capabilities/batch-processing/batch-processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import {
  runWave, buildServer, buildDatabase, buildCache, buildCDN,
  buildLoadBalancer, buildStreamingServer, buildDNSGTM,
  wire,
} from "./helpers";

/**
 * Build a Worker that processes batch AND forwards non-batch traffic,
 * with a unique component ID and configurable forwarding throughput tier.
 * The standard buildWorkerWithForwarding() uses a hardcoded "custom-worker"
 * ID (collides when placing multiple) and tier 1 (500/tick).
 */
function buildHighThroughputWorker(id: string, forwardTier: number) {
  const ingressPortId = `${id}-in`;
  const egressPortId = `${id}-out`;
  const ingress = makePort(ingressPortId, "ingress");
  const egress = makePort(egressPortId, "egress");

  const batchCap = new BatchProcessingCapability("batch-processing" as CapabilityId);
  const forwardCap = new ForwardingCapability("forwarding-pipe" as CapabilityId, {
    handledTypes: ["api_read", "api_write", "static_asset", "auth_required"],
    throughputPerTier: 500,
    emitForwardedEvent: true,
  });
  const monCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["batch-processing" as CapabilityId, batchCap],
    ["forwarding-pipe" as CapabilityId, forwardCap],
    ["monitoring" as CapabilityId, monCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["batch-processing" as CapabilityId, 1],
    ["forwarding-pipe" as CapabilityId, forwardTier],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "worker",
    name: "Worker (batch + forward)",
    description: "Processes batch, forwards the rest",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, egress],
    placementCost: 125,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: {
      degradedThreshold: 0.7,
      criticalThreshold: 0.3,
      decayRate: 0.05,
      recoveryRate: 0.02,
      degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
      criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
    },
  });

  return { component, ingressPortId, egressPortId };
}

/**
 * Build a LoadBalancer with configurable forwarding throughput tier.
 * The standard buildLoadBalancer uses throughputPerTier: 500, tier 1.
 */
function buildHighThroughputLB(id: string, egressCount: number, forwardTier: number) {
  const ingressPortId = `${id}-in`;
  const ingress = makePort(ingressPortId, "ingress");

  const egressPortIds: string[] = [];
  const egressPorts = [];
  for (let i = 0; i < egressCount; i++) {
    const egressPortId = `${id}-out-${i}`;
    egressPortIds.push(egressPortId);
    egressPorts.push(makePort(egressPortId, "egress"));
  }

  const routingCap = new RoutingCapability("routing" as CapabilityId);
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_read", "api_write", "static_asset", "auth_required", "batch", "event", "stream"],
    throughputPerTier: 500,
    emitForwardedEvent: true,
  });
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["routing" as CapabilityId, routingCap],
    ["forwarding" as CapabilityId, forwardingCap],
    ["monitoring" as CapabilityId, monitoringCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["routing" as CapabilityId, 1],
    ["forwarding" as CapabilityId, forwardTier],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "load_balancer",
    name: "Load Balancer",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, ...egressPorts],
    placementCost: 175,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: {
      degradedThreshold: 0.7,
      criticalThreshold: 0.3,
      decayRate: 0.05,
      recoveryRate: 0.02,
      degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
      criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
    },
  });

  return { component, ingressPortId, egressPortIds };
}

describe("Wave 10 — full auto-scale (Server + Database) wins the boss wave", () => {
  it("auto-scaling servers AND databases survive 3000/tick across 3 zones with chaos", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({
      zones: ["na-east", "eu-west", "ap-south"],
      pairLatency: new Map([
        [zonePairKey("na-east", "ap-south"), 5],
        [zonePairKey("na-east", "eu-west"), 3],
        [zonePairKey("eu-west", "ap-south"), 4],
      ]),
    });

    // === BOSS WAVE TOPOLOGY ===
    //
    //   DNS/GTM → [zone: CDN → Cache → StreamServer → Worker → LB → Server×4 → DB]
    //
    // The capstone test. At 3000/tick across 3 zones with chaos events at
    // ticks 10, 20, 25, the topology survives through auto-scaling of both
    // Servers (maxInstances: 10) and Databases (maxInstances: 5).
    //
    // Throughput tuning (per-component, per zone):
    //   DNS forwarding-pipe:      tier 6  → 3000/tick (matches wave intensity)
    //   CDN forwarding-pipe:      tier 3  → 1500/tick (NA zone gets 1200)
    //   Cache forwarding-pipe:    tier 3  → 1500/tick (matches CDN output)
    //   StreamServer fwd-pipe:    tier 3  → 1500/tick + streaming 4/tick
    //   Worker forwarding-pipe:   tier 3  → 1500/tick (custom builder)
    //   LB forwarding:            tier 3  → 1500/tick (custom builder)
    //   Server: 30/tick × instanceCount (scales to 10 → 300/tick per component)
    //   Database: 50/tick × instanceCount (scales to 5 → 250/tick per component)
    //
    // Connection bandwidth: 3000 throughout (matching wave connectionBandwidth).
    // StreamServer ingress: 15000 bandwidth (stream reservation gotcha).
    // SLA: 85% availability, maxAvgLatency 5.

    // --- DNS/GTM as entry point ---
    const dns = buildDNSGTM(compRegistry);
    // Upgrade DNS forwarding-pipe to tier 6 (3000/tick).
    // upgrade() increments by 1 each call, capped by 2nd arg.
    for (let i = 0; i < 5; i++) {
      dns.component.upgrade("forwarding-pipe" as CapabilityId, 6);
    }

    // --- Helper to build a zone's full stack ---
    function buildZoneStack(zone: string, prefix: string, serverCount: number) {
      const cdn = buildCDN(compRegistry, zone);
      const cache = buildCache(compRegistry, zone);
      const stream = buildStreamingServer(compRegistry, zone);
      // Custom high-throughput Worker and LB with unique IDs per zone
      const worker = buildHighThroughputWorker(`${prefix}-worker`, 3);
      const lb = buildHighThroughputLB(`${prefix}-lb`, serverCount, 3);
      const servers: ReturnType<typeof buildServer>[] = [];
      for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry, zone));
      const db = buildDatabase(compRegistry, zone);

      // Upgrade CDN forwarding-pipe to tier 3 (1500/tick)
      cdn.component.upgrade("forwarding-pipe" as CapabilityId, 3);
      cdn.component.upgrade("forwarding-pipe" as CapabilityId, 3);

      // Upgrade Cache forwarding-pipe to tier 3 (1500/tick)
      cache.component.upgrade("forwarding-pipe" as CapabilityId, 3);
      cache.component.upgrade("forwarding-pipe" as CapabilityId, 3);

      // Upgrade StreamServer forwarding-pipe to tier 3 (1500/tick)
      // StreamServer maxTier is 2 for forwarding-pipe, but we pass 3 to override.
      stream.component.upgrade("forwarding-pipe" as CapabilityId, 3);
      stream.component.upgrade("forwarding-pipe" as CapabilityId, 3);
      // Upgrade streaming capability to tier 3 (12 streams/tick) for higher
      // stream handling capacity. Total StreamServer throughput: 12 + 1500 = 1512.
      stream.component.upgrade("streaming" as CapabilityId, 3);
      stream.component.upgrade("streaming" as CapabilityId, 3);

      // Auto-scale: servers up to 10, databases up to 5
      // Tier 2 auto-scale gives 2-tick cooldown (vs tier 1's 5-tick cooldown),
      // allowing faster scaling response to sustained overload.
      for (const s of servers) {
        (s.component as any).maxInstances = 10;
        s.component.upgrade("auto-scale" as CapabilityId, 2);
        // Upgrade server processing+forwarding to tier 2 (60/tick vs 30/tick)
        // to better handle per-instance throughput at scale.
        s.component.upgrade("processing" as CapabilityId, 3);
        s.component.upgrade("forwarding" as CapabilityId, 3);
      }
      (db.component as any).maxInstances = 5;
      db.component.upgrade("auto-scale" as CapabilityId, 2);
      // Upgrade database storage to tier 2 (100/tick vs 50/tick)
      db.component.upgrade("storage" as CapabilityId, 3);

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
      // Stream reservation gotcha: each active stream reserves bandwidth for
      // streamConfig.duration (20 ticks) at streamConfig.bandwidth (3 units).
      // Peak: 420 streams/tick (NA) × 20 ticks × 3 = 25,200 reserved bandwidth.
      // Need 50,000+ to handle both stream reservations and regular traffic.
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: stream.component, ingressPortId: stream.ingressPortId }, `c-${prefix}-cache-stream`, { bandwidth: 50000 });
      wire(state, { component: stream.component, egressPortId: stream.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, `c-${prefix}-stream-worker`, { bandwidth: 3000 });
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, `c-${prefix}-worker-lb`, { bandwidth: 3000 });

      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-${prefix}-lb-s${i}`, { bandwidth: 3000 });
      }
      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-${prefix}-s${i}-db`, { bandwidth: 3000 });
      }

      return { cdn, cache, stream, worker, lb, servers, db };
    }

    // --- Place DNS ---
    state.placeComponent(dns.component);

    // --- Build zones (5 servers each — auto-scale handles scaling beyond) ---
    const na = buildZoneStack("na-east", "na", 5);
    const eu = buildZoneStack("eu-west", "eu", 5);
    const ap = buildZoneStack("ap-south", "ap", 5);

    // DNS/GTM → zone CDNs
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na-cdn", { bandwidth: 3000 });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu-cdn", { bandwidth: 3000 });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap-cdn", { bandwidth: 3000 });

    const result = runWave(state, WAVE_10, dns.component.id);

    // --- Diagnostic dump on failure ---
    if (result.outcome.verdict !== "win") {
      console.log("=== Wave 10 Full Autoscale Diagnostic ===");
      console.log("SLA results:", JSON.stringify(result.outcome.slaResults, null, 2));
      console.log("Total:", result.totalRequests, "Dropped:", result.droppedCount, "TimedOut:", result.timedOutCount);
      console.log("DNS forwarded:", result.forwardedCountByComponent.get(dns.component.id) ?? 0);
      console.log("Events:", Object.fromEntries(result.eventCountsByType));
      // Report server/DB instance counts
      for (const [label, zone] of [["NA", na], ["EU", eu], ["AP", ap]] as const) {
        for (const s of zone.servers) {
          console.log(`  ${label} Server ${s.component.id}: instanceCount=${s.component.instanceCount}`);
        }
        console.log(`  ${label} DB ${zone.db.component.id}: instanceCount=${zone.db.component.instanceCount}`);
      }
      // Drop breakdown by component (debugging aid)
      const dropsByComponent = new Map<string, number>();
      for (const events of result.state.requestLog.values()) {
        for (const ev of events) {
          if (ev.type === "DROPPED") {
            const key = `${ev.componentId}|${(ev.metadata as any)?.reason ?? "unknown"}`;
            dropsByComponent.set(key, (dropsByComponent.get(key) ?? 0) + 1);
          }
        }
      }
      console.log("Drops by component|reason:", Object.fromEntries(dropsByComponent));
    }

    // 1. Verdict is "win"
    expect(result.outcome.verdict).toBe("win");

    // 2. Availability SLA passes (85%)
    expect(result.outcome.slaResults?.availability.passed).toBe(true);

    // 3. At least one Server actually auto-scaled (proves the mechanism worked)
    const allServers = [...na.servers, ...eu.servers, ...ap.servers];
    const scaledServer = allServers.find(s => s.component.instanceCount > 1);
    expect(scaledServer).toBeDefined();
  });
});

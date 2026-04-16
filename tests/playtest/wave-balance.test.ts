/**
 * Playtest harness: tests multiple topology configurations per wave and reports metrics.
 * This is a research/analysis tool, not production code.
 *
 * Run: pnpm test tests/playtest/wave-balance.test.ts --reporter=verbose 2>&1
 */
import { describe, it } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import { BatchProcessingCapability } from "@capabilities/batch-processing/batch-processing-capability";
import { makePort } from "@harness/fixtures";
import { bootTDRegistry } from "@harness/td-fixtures";
import { zonePairKey } from "@core/types/zone";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { ComponentRegistry } from "@core/registry/component-registry";
import {
  WAVE_1, WAVE_2, WAVE_3, WAVE_4, WAVE_5,
  WAVE_6, WAVE_7, WAVE_8, WAVE_9, WAVE_10,
} from "@modes/td/td-waves";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import {
  runWave, buildServer, buildDatabase, buildCache, buildCDN,
  buildAPIGateway, buildLoadBalancer, buildQueue, buildWorker,
  buildCircuitBreaker, buildStreamingServer, buildBlobStorage,
  buildDNSGTM, wire,
} from "../integration/td/helpers";
import type { WaveRunResult } from "../integration/td/helpers";

// ---------------------------------------------------------------------------
// Utility: high-throughput custom builders (from wave-10 test pattern)
// ---------------------------------------------------------------------------
function buildHighThroughputWorker(id: string, forwardTier: number, zone: string | null = null) {
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
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, egress],
    placementCost: 125,
    position: { x: 0, y: 0 },
    zone,
    placementTick: 0,
    conditionProfile: {
      degradedThreshold: 0.7, criticalThreshold: 0.3,
      decayRate: 0.05, recoveryRate: 0.02,
      degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
      criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
    },
  });

  return { component, ingressPortId, egressPortId };
}

function buildHighThroughputLB(id: string, egressCount: number, forwardTier: number, zone: string | null = null) {
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
    zone,
    placementTick: 0,
    conditionProfile: {
      degradedThreshold: 0.7, criticalThreshold: 0.3,
      decayRate: 0.05, recoveryRate: 0.02,
      degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
      criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
    },
  });

  return { component, ingressPortId, egressPortIds };
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------
interface TopologyResult {
  label: string;
  verdict: string;
  availability: number;
  avgLatency: number;
  budget: number;
  drops: number;
  timeouts: number;
}

function extractMetrics(label: string, result: WaveRunResult): TopologyResult {
  const sla = result.outcome.slaResults;
  return {
    label,
    verdict: result.outcome.verdict,
    availability: sla ? sla.availability.actual : 0,
    avgLatency: sla ? sla.latency.actual : 999,
    budget: result.finalBudget,
    drops: result.droppedCount,
    timeouts: result.timedOutCount,
  };
}

function rankAndReport(waveName: string, results: TopologyResult[]) {
  // Sort: 1st verdict (win > lose > neutral), 2nd availability desc, 3rd latency asc
  const verdictOrder: Record<string, number> = { win: 0, neutral: 1, lose: 2 };
  const sorted = [...results].sort((a, b) => {
    const vd = (verdictOrder[a.verdict] ?? 9) - (verdictOrder[b.verdict] ?? 9);
    if (vd !== 0) return vd;
    const ad = b.availability - a.availability;
    if (Math.abs(ad) > 0.0001) return ad;
    return a.avgLatency - b.avgLatency;
  });

  const pad = (s: string, n: number) => s.padEnd(n);
  const padr = (s: string, n: number) => s.padStart(n);

  console.log(`\n=== ${waveName} ===`);
  console.log(
    `| ${pad("Rank", 4)} | ${pad("Topology", 60)} | ${pad("Verdict", 7)} | ${padr("Avail%", 7)} | ${padr("AvgLat", 6)} | ${padr("Budget", 8)} | ${padr("Drops", 6)} | ${padr("Timeouts", 8)} |`
  );
  console.log(
    `| ${"-".repeat(4)} | ${"-".repeat(60)} | ${"-".repeat(7)} | ${"-".repeat(7)} | ${"-".repeat(6)} | ${"-".repeat(8)} | ${"-".repeat(6)} | ${"-".repeat(8)} |`
  );
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    console.log(
      `| ${pad(String(i + 1), 4)} | ${pad(r.label, 60)} | ${pad(r.verdict, 7)} | ${padr((r.availability * 100).toFixed(1) + "%", 7)} | ${padr(r.avgLatency.toFixed(1), 6)} | ${padr("$" + Math.round(r.budget), 8)} | ${padr(String(r.drops), 6)} | ${padr(String(r.timeouts), 8)} |`
    );
  }
  console.log(`Best-guess topology rank: #1 (${sorted[0]!.label})`);
}

// ---------------------------------------------------------------------------
// Helper: default single-zone state
// ---------------------------------------------------------------------------
function singleZoneState() {
  return new SimulationState({ zones: ["default"], pairLatency: new Map() });
}

function multiZoneState() {
  return new SimulationState({
    zones: ["na-east", "eu-west", "ap-south"],
    pairLatency: new Map([
      [zonePairKey("na-east", "ap-south"), 5],
      [zonePairKey("na-east", "eu-west"), 3],
      [zonePairKey("eu-west", "ap-south"), 4],
    ]),
  });
}

// Helper: safe runWave that catches errors
function safeRunWave(state: SimulationState, wave: TDWaveDefinition, entryId: ComponentId): WaveRunResult | null {
  try {
    return runWave(state, wave, entryId);
  } catch (e) {
    console.log(`  [ERROR] ${(e as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// WAVE 1
// ---------------------------------------------------------------------------
describe("Playtest: Wave 1", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];

    // A: Server only
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const server = buildServer(reg);
      state.placeComponent(server.component);
      const r = safeRunWave(state, WAVE_1, server.component.id);
      if (r) results.push(extractMetrics("A: Server", r));
    }

    // B: Client -> LB -> Server x2
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const lb = buildLoadBalancer("lb", 2);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      state.placeComponent(client);
      state.placeComponent(lb.component);
      state.placeComponent(s1.component);
      state.placeComponent(s2.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-client-lb");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-lb-s1");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: s2.component, ingressPortId: s2.ingressPortId }, "c-lb-s2");
      const r = safeRunWave(state, WAVE_1, client.id);
      if (r) results.push(extractMetrics("B: Client -> LB -> Server x2", r));
    }

    // C: Client -> Cache -> Server
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cache = buildCache(reg);
      const server = buildServer(reg);
      state.placeComponent(client);
      state.placeComponent(cache.component);
      state.placeComponent(server.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-client-cache");
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: server.component, ingressPortId: server.ingressPortId }, "c-cache-server");
      const r = safeRunWave(state, WAVE_1, client.id);
      if (r) results.push(extractMetrics("C: Client -> Cache -> Server", r));
    }

    rankAndReport("WAVE 1: Launch Day (10/tick, api_read only)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 2
// ---------------------------------------------------------------------------
describe("Playtest: Wave 2", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];

    // A: Client -> Server -> Database
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const server = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(server.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: server.component, ingressPortId: server.ingressPortId }, "c-client-s");
      wire(state, { component: server.component, egressPortId: server.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s-db");
      const r = safeRunWave(state, WAVE_2, client.id);
      if (r) results.push(extractMetrics("A: Client -> Server -> DB", r));
    }

    // B: Client -> LB -> Server x2 -> DB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const lb = buildLoadBalancer("lb", 2);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(lb.component);
      state.placeComponent(s1.component);
      state.placeComponent(s2.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-client-lb");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-lb-s1");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: s2.component, ingressPortId: s2.ingressPortId }, "c-lb-s2");
      wire(state, { component: s1.component, egressPortId: s1.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s1-db");
      wire(state, { component: s2.component, egressPortId: s2.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s2-db");
      const r = safeRunWave(state, WAVE_2, client.id);
      if (r) results.push(extractMetrics("B: Client -> LB -> Server x2 -> DB", r));
    }

    // C: Client -> Cache -> Server -> DB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cache = buildCache(reg);
      const server = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(cache.component);
      state.placeComponent(server.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-client-cache");
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: server.component, ingressPortId: server.ingressPortId }, "c-cache-s");
      wire(state, { component: server.component, egressPortId: server.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s-db");
      const r = safeRunWave(state, WAVE_2, client.id);
      if (r) results.push(extractMetrics("C: Client -> Cache -> Server -> DB", r));
    }

    rankAndReport("WAVE 2: Users Start Signing Up (25/tick, read+write)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 3
// ---------------------------------------------------------------------------
describe("Playtest: Wave 3", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];

    // A: Client -> Server -> DB (undersized)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const server = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(server.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: server.component, ingressPortId: server.ingressPortId }, "c-client-s");
      wire(state, { component: server.component, egressPortId: server.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s-db");
      const r = safeRunWave(state, WAVE_3, client.id);
      if (r) results.push(extractMetrics("A: Client -> Server -> DB (undersized)", r));
    }

    // B: Client -> Cache -> LB -> Server x2 -> DB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cache = buildCache(reg);
      const lb = buildLoadBalancer("lb", 2);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(cache.component);
      state.placeComponent(lb.component);
      state.placeComponent(s1.component);
      state.placeComponent(s2.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-client-cache");
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cache-lb");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-lb-s1");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: s2.component, ingressPortId: s2.ingressPortId }, "c-lb-s2");
      wire(state, { component: s1.component, egressPortId: s1.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s1-db");
      wire(state, { component: s2.component, egressPortId: s2.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s2-db");
      const r = safeRunWave(state, WAVE_3, client.id);
      if (r) results.push(extractMetrics("B: Client -> Cache -> LB -> Server x2 -> DB", r));
    }

    // C: Client -> LB -> Server x3 -> DB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const lb = buildLoadBalancer("lb", 3);
      const servers = [buildServer(reg), buildServer(reg), buildServer(reg)];
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(lb.component);
      for (const s of servers) state.placeComponent(s.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-client-lb");
      for (let i = 0; i < 3; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`);
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-s${i}-db`);
      }
      const r = safeRunWave(state, WAVE_3, client.id);
      if (r) results.push(extractMetrics("C: Client -> LB -> Server x3 -> DB", r));
    }

    // D: Client -> Cache -> Server x2 -> DB (no LB)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cache = buildCache(reg);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(cache.component);
      state.placeComponent(s1.component);
      state.placeComponent(s2.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-client-cache");
      // Cache has single egress -> connect to s1, s1 forwards to s2? No -- wire cache to both servers won't work with single egress.
      // Actually: Cache -> Server1 -> DB, and Server1 gets all traffic (s2 unused w/o LB)
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-cache-s1");
      wire(state, { component: s1.component, egressPortId: s1.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s1-db");
      const r = safeRunWave(state, WAVE_3, client.id);
      if (r) results.push(extractMetrics("D: Client -> Cache -> Server -> DB (no LB)", r));
    }

    rankAndReport("WAVE 3: Traffic Spikes (50/tick, read+write)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 4
// ---------------------------------------------------------------------------
describe("Playtest: Wave 4", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];

    // A: Client -> CDN -> Cache -> LB -> Server x2 -> DB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const cache = buildCache(reg);
      const lb = buildLoadBalancer("lb", 2);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(cdn.component);
      state.placeComponent(cache.component);
      state.placeComponent(lb.component);
      state.placeComponent(s1.component);
      state.placeComponent(s2.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn");
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-cdn-cache");
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cache-lb");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-lb-s1");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: s2.component, ingressPortId: s2.ingressPortId }, "c-lb-s2");
      wire(state, { component: s1.component, egressPortId: s1.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s1-db");
      wire(state, { component: s2.component, egressPortId: s2.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s2-db");
      const r = safeRunWave(state, WAVE_4, client.id);
      if (r) results.push(extractMetrics("A: Client -> CDN -> Cache -> LB -> Server x2 -> DB", r));
    }

    // B: Client -> CDN -> LB -> Server x2 -> DB (no Cache)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const lb = buildLoadBalancer("lb", 2);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(cdn.component);
      state.placeComponent(lb.component);
      state.placeComponent(s1.component);
      state.placeComponent(s2.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn");
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cdn-lb");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-lb-s1");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: s2.component, ingressPortId: s2.ingressPortId }, "c-lb-s2");
      wire(state, { component: s1.component, egressPortId: s1.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s1-db");
      wire(state, { component: s2.component, egressPortId: s2.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s2-db");
      const r = safeRunWave(state, WAVE_4, client.id);
      if (r) results.push(extractMetrics("B: Client -> CDN -> LB -> Server x2 -> DB (no Cache)", r));
    }

    // C: Client -> Cache -> LB -> Server x2 -> DB (no CDN)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cache = buildCache(reg);
      const lb = buildLoadBalancer("lb", 2);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(cache.component);
      state.placeComponent(lb.component);
      state.placeComponent(s1.component);
      state.placeComponent(s2.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-client-cache");
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cache-lb");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-lb-s1");
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: s2.component, ingressPortId: s2.ingressPortId }, "c-lb-s2");
      wire(state, { component: s1.component, egressPortId: s1.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s1-db");
      wire(state, { component: s2.component, egressPortId: s2.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s2-db");
      const r = safeRunWave(state, WAVE_4, client.id);
      if (r) results.push(extractMetrics("C: Client -> Cache -> LB -> Server x2 -> DB (no CDN)", r));
    }

    // D: Client -> CDN -> Cache -> Server -> DB (no LB)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const cache = buildCache(reg);
      const server = buildServer(reg);
      const db = buildDatabase(reg);
      state.placeComponent(client);
      state.placeComponent(cdn.component);
      state.placeComponent(cache.component);
      state.placeComponent(server.component);
      state.placeComponent(db.component);
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn");
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-cdn-cache");
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: server.component, ingressPortId: server.ingressPortId }, "c-cache-s");
      wire(state, { component: server.component, egressPortId: server.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s-db");
      const r = safeRunWave(state, WAVE_4, client.id);
      if (r) results.push(extractMetrics("D: Client -> CDN -> Cache -> Server -> DB (no LB)", r));
    }

    rankAndReport("WAVE 4: Marketing Adds Images (80/tick, +static_asset)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 5
// ---------------------------------------------------------------------------
describe("Playtest: Wave 5", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];
    const bw = { bandwidth: 200 };

    // A: Client -> CDN -> Gateway -> Cache -> LB -> Server x2 -> DB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const lb = buildLoadBalancer("lb", 2);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      const db = buildDatabase(reg);
      [client, cdn.component, gw.component, cache.component, lb.component, s1.component, s2.component, db.component].forEach(c => state.placeComponent(c));
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cache-lb", bw);
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-lb-s1", bw);
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: s2.component, ingressPortId: s2.ingressPortId }, "c-lb-s2", bw);
      wire(state, { component: s1.component, egressPortId: s1.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s1-db", bw);
      wire(state, { component: s2.component, egressPortId: s2.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s2-db", bw);
      const r = safeRunWave(state, WAVE_5, client.id);
      if (r) results.push(extractMetrics("A: Client -> CDN -> GW -> Cache -> LB -> Srv x2 -> DB", r));
    }

    // B: Client -> CDN -> Cache -> LB -> Server x2 -> DB (no Gateway)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const cache = buildCache(reg);
      const lb = buildLoadBalancer("lb", 2);
      const s1 = buildServer(reg);
      const s2 = buildServer(reg);
      const db = buildDatabase(reg);
      [client, cdn.component, cache.component, lb.component, s1.component, s2.component, db.component].forEach(c => state.placeComponent(c));
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-cdn-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cache-lb", bw);
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: s1.component, ingressPortId: s1.ingressPortId }, "c-lb-s1", bw);
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: s2.component, ingressPortId: s2.ingressPortId }, "c-lb-s2", bw);
      wire(state, { component: s1.component, egressPortId: s1.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s1-db", bw);
      wire(state, { component: s2.component, egressPortId: s2.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s2-db", bw);
      const r = safeRunWave(state, WAVE_5, client.id);
      if (r) results.push(extractMetrics("B: Client -> CDN -> Cache -> LB -> Srv x2 -> DB (no GW)", r));
    }

    // C: Client -> CDN -> Gateway -> Cache -> LB -> Server x3 -> DB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const lb = buildLoadBalancer("lb", 3);
      const servers = [buildServer(reg), buildServer(reg), buildServer(reg)];
      const db = buildDatabase(reg);
      [client, cdn.component, gw.component, cache.component, lb.component, ...servers.map(s => s.component), db.component].forEach(c => state.placeComponent(c));
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cache-lb", bw);
      for (let i = 0; i < 3; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-s${i}-db`, bw);
      }
      const r = safeRunWave(state, WAVE_5, client.id);
      if (r) results.push(extractMetrics("C: Client -> CDN -> GW -> Cache -> LB -> Srv x3 -> DB", r));
    }

    // D: Client -> CDN -> Gateway -> Cache -> Server -> DB (no LB)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const server = buildServer(reg);
      const db = buildDatabase(reg);
      [client, cdn.component, gw.component, cache.component, server.component, db.component].forEach(c => state.placeComponent(c));
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: server.component, ingressPortId: server.ingressPortId }, "c-cache-s", bw);
      wire(state, { component: server.component, egressPortId: server.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, "c-s-db", bw);
      const r = safeRunWave(state, WAVE_5, client.id);
      if (r) results.push(extractMetrics("D: Client -> CDN -> GW -> Cache -> Server -> DB (no LB)", r));
    }

    rankAndReport("WAVE 5: The Authentication Wall (150/tick, +auth_required)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 6
// ---------------------------------------------------------------------------
describe("Playtest: Wave 6", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];
    const bw = { bandwidth: 500 };

    // A: Client -> CDN -> GW -> Cache -> Worker -> Queue -> LB -> Srv x3 -> DB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const worker = buildWorker(reg);
      const queue = buildQueue(reg);
      const lb = buildLoadBalancer("lb", 3);
      const servers = [buildServer(reg), buildServer(reg), buildServer(reg)];
      const db = buildDatabase(reg);
      [client, cdn.component, gw.component, cache.component, worker.component, queue.component, lb.component, ...servers.map(s => s.component), db.component].forEach(c => state.placeComponent(c));
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-cache-wk", bw);
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-wk-q", bw);
      wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-q-lb", bw);
      for (let i = 0; i < 3; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-s${i}-db`, bw);
      }
      const r = safeRunWave(state, WAVE_6, client.id);
      if (r) results.push(extractMetrics("A: CDN->GW->Cache->Worker->Queue->LB->Srv3->DB", r));
    }

    // B: Client -> CDN -> GW -> Cache -> Queue -> Worker -> LB -> Srv x3 -> DB (Queue upstream)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const queue = buildQueue(reg);
      const worker = buildWorker(reg);
      const lb = buildLoadBalancer("lb", 3);
      const servers = [buildServer(reg), buildServer(reg), buildServer(reg)];
      const db = buildDatabase(reg);
      [client, cdn.component, gw.component, cache.component, queue.component, worker.component, lb.component, ...servers.map(s => s.component), db.component].forEach(c => state.placeComponent(c));
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-cache-q", bw);
      wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-q-wk", bw);
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-wk-lb", bw);
      for (let i = 0; i < 3; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-s${i}-db`, bw);
      }
      const r = safeRunWave(state, WAVE_6, client.id);
      if (r) results.push(extractMetrics("B: CDN->GW->Cache->Queue->Worker->LB->Srv3->DB (Q upstream)", r));
    }

    // C: Client -> CDN -> GW -> Cache -> LB -> Srv x3 -> DB (no Worker/Queue)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const lb = buildLoadBalancer("lb", 3);
      const servers = [buildServer(reg), buildServer(reg), buildServer(reg)];
      const db = buildDatabase(reg);
      [client, cdn.component, gw.component, cache.component, lb.component, ...servers.map(s => s.component), db.component].forEach(c => state.placeComponent(c));
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cache-lb", bw);
      for (let i = 0; i < 3; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-s${i}-db`, bw);
      }
      const r = safeRunWave(state, WAVE_6, client.id);
      if (r) results.push(extractMetrics("C: CDN->GW->Cache->LB->Srv3->DB (no Worker/Queue)", r));
    }

    // D: Client -> CDN -> GW -> Cache -> Worker -> LB -> Srv x3 -> DB (Worker, no Queue)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const worker = buildWorker(reg);
      const lb = buildLoadBalancer("lb", 3);
      const servers = [buildServer(reg), buildServer(reg), buildServer(reg)];
      const db = buildDatabase(reg);
      [client, cdn.component, gw.component, cache.component, worker.component, lb.component, ...servers.map(s => s.component), db.component].forEach(c => state.placeComponent(c));
      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-cache-wk", bw);
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-wk-lb", bw);
      for (let i = 0; i < 3; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-s${i}-db`, bw);
      }
      const r = safeRunWave(state, WAVE_6, client.id);
      if (r) results.push(extractMetrics("D: CDN->GW->Cache->Worker->LB->Srv3->DB (no Queue)", r));
    }

    rankAndReport("WAVE 6: Async Workloads (250/tick, +batch 20%)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 7
// ---------------------------------------------------------------------------
describe("Playtest: Wave 7", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];
    const bw = { bandwidth: 600 };

    // Helper: build wave-7 base topology (CDN->GW->Cache->Worker->Queue->LB)
    function buildW7Base(reg: ComponentRegistry, state: SimulationState, serverCount: number, withCB: boolean, dualCB: boolean = false) {
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const worker = buildWorker(reg);
      const queue = buildQueue(reg);
      const lb = buildLoadBalancer("lb", serverCount);
      const cb = withCB ? buildCircuitBreaker(reg) : null;
      const cb2 = dualCB ? buildCircuitBreaker(reg) : null;
      const servers: ReturnType<typeof buildServer>[] = [];
      for (let i = 0; i < serverCount; i++) servers.push(buildServer(reg));
      const db = buildDatabase(reg);

      state.placeComponent(client);
      state.placeComponent(cdn.component);
      state.placeComponent(gw.component);
      state.placeComponent(cache.component);
      state.placeComponent(worker.component);
      state.placeComponent(queue.component);
      state.placeComponent(lb.component);
      if (cb) state.placeComponent(cb.component);
      if (cb2) state.placeComponent(cb2.component);
      for (const s of servers) state.placeComponent(s.component);
      state.placeComponent(db.component);

      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-cache-wk", bw);
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-wk-q", bw);
      wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-q-lb", bw);

      // Wire LB -> servers (with CB on path[0])
      if (cb) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: cb.component, ingressPortId: cb.ingressPortId }, "c-lb-cb", bw);
        wire(state, { component: cb.component, egressPortId: cb.egressPortId }, { component: servers[0]!.component, ingressPortId: servers[0]!.ingressPortId }, "c-cb-s0", bw);
        const startIdx = 1;
        if (dualCB && cb2 && serverCount >= 4) {
          // CB2 on path to server[2]
          wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: servers[1]!.component, ingressPortId: servers[1]!.ingressPortId }, "c-lb-s1", bw);
          wire(state, { component: lb.component, egressPortId: lb.egressPortIds[2]! }, { component: cb2.component, ingressPortId: cb2.ingressPortId }, "c-lb-cb2", bw);
          wire(state, { component: cb2.component, egressPortId: cb2.egressPortId }, { component: servers[2]!.component, ingressPortId: servers[2]!.ingressPortId }, "c-cb2-s2", bw);
          for (let i = 3; i < serverCount; i++) {
            wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
          }
        } else {
          for (let i = startIdx; i < serverCount; i++) {
            wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
          }
        }
      } else {
        for (let i = 0; i < serverCount; i++) {
          wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
        }
      }

      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-s${i}-db`, bw);
      }

      return { client, servers };
    }

    // A: CB on server[0] path, Server x5
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const { client } = buildW7Base(reg, state, 5, true);
      const r = safeRunWave(state, WAVE_7, client.id);
      if (r) results.push(extractMetrics("A: W6 best + CB on s[0], Server x5", r));
    }

    // B: Server x5, no CB
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const { client } = buildW7Base(reg, state, 5, false);
      const r = safeRunWave(state, WAVE_7, client.id);
      if (r) results.push(extractMetrics("B: W6 best + Server x5, no CB", r));
    }

    // C: CB, Server x3 (undersized)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const { client } = buildW7Base(reg, state, 3, true);
      const r = safeRunWave(state, WAVE_7, client.id);
      if (r) results.push(extractMetrics("C: W6 best + CB, Server x3 (undersized)", r));
    }

    // D: 2xCB (one per server pair), Server x5
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const { client } = buildW7Base(reg, state, 5, true, true);
      const r = safeRunWave(state, WAVE_7, client.id);
      if (r) results.push(extractMetrics("D: W6 best + 2xCB, Server x5", r));
    }

    rankAndReport("WAVE 7: The Outage (350/tick, +chaos)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 8
// ---------------------------------------------------------------------------
describe("Playtest: Wave 8", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];
    const bw = { bandwidth: 700 };

    function buildW8Topology(reg: ComponentRegistry, state: SimulationState, opts: {
      withStreamServer: boolean;
      withBlobStorage: boolean;
      serverCount: number;
    }) {
      const client = reg.create("client", { x: 0, y: 0 }, null);
      const cdn = buildCDN(reg);
      const gw = buildAPIGateway(reg);
      const cache = buildCache(reg);
      const streamSrv = opts.withStreamServer ? buildStreamingServer(reg) : null;
      const worker = buildWorker(reg);
      const queue = buildQueue(reg);
      const lb = buildLoadBalancer("lb", opts.serverCount);
      const cb = buildCircuitBreaker(reg);
      const blob = opts.withBlobStorage ? buildBlobStorage(reg) : null;
      const servers: ReturnType<typeof buildServer>[] = [];
      for (let i = 0; i < opts.serverCount; i++) servers.push(buildServer(reg));
      const db = buildDatabase(reg);

      [client, cdn.component, gw.component, cache.component].forEach(c => state.placeComponent(c));
      if (streamSrv) state.placeComponent(streamSrv.component);
      [worker.component, queue.component, lb.component, cb.component].forEach(c => state.placeComponent(c));
      if (blob) state.placeComponent(blob.component);
      for (const s of servers) state.placeComponent(s.component);
      state.placeComponent(db.component);

      const ce = client.ports.find(p => p.direction === "egress")!;
      wire(state, { component: client, egressPortId: ce.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", bw);
      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gw.component, ingressPortId: gw.ingressPortId }, "c-cdn-gw", bw);
      wire(state, { component: gw.component, egressPortId: gw.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", bw);

      if (streamSrv) {
        wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: streamSrv.component, ingressPortId: streamSrv.ingressPortId }, "c-cache-stream", { bandwidth: 15000 });
        wire(state, { component: streamSrv.component, egressPortId: streamSrv.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-stream-wk", bw);
      } else {
        wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-cache-wk", bw);
      }

      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-wk-q", bw);
      wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-q-lb", bw);

      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: cb.component, ingressPortId: cb.ingressPortId }, "c-lb-cb", bw);
      wire(state, { component: cb.component, egressPortId: cb.egressPortId }, { component: servers[0]!.component, ingressPortId: servers[0]!.ingressPortId }, "c-cb-s0", bw);
      for (let i = 1; i < opts.serverCount; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, bw);
      }
      for (let i = 0; i < opts.serverCount; i++) {
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-s${i}-db`, bw);
      }

      return { client };
    }

    // A: StreamServer + BlobStorage + Srv x5
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const { client } = buildW8Topology(reg, state, { withStreamServer: true, withBlobStorage: true, serverCount: 5 });
      const r = safeRunWave(state, WAVE_8, client.id);
      if (r) results.push(extractMetrics("A: W7 best + StreamServer + BlobStorage, Srv x5", r));
    }

    // B: StreamServer, no BlobStorage, Srv x5
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const { client } = buildW8Topology(reg, state, { withStreamServer: true, withBlobStorage: false, serverCount: 5 });
      const r = safeRunWave(state, WAVE_8, client.id);
      if (r) results.push(extractMetrics("B: W7 best + StreamServer, no BlobStorage, Srv x5", r));
    }

    // C: No stream isolation, Srv x5
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const { client } = buildW8Topology(reg, state, { withStreamServer: false, withBlobStorage: false, serverCount: 5 });
      const r = safeRunWave(state, WAVE_8, client.id);
      if (r) results.push(extractMetrics("C: W7 best, no streaming isolation, Srv x5", r));
    }

    // D: StreamServer + more servers (x7)
    {
      const reg = bootTDRegistry();
      const state = singleZoneState();
      const { client } = buildW8Topology(reg, state, { withStreamServer: true, withBlobStorage: false, serverCount: 7 });
      const r = safeRunWave(state, WAVE_8, client.id);
      if (r) results.push(extractMetrics("D: W7 best + StreamServer, Srv x7", r));
    }

    rankAndReport("WAVE 8: Video Launch (500/tick, +stream 30%)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 9
// ---------------------------------------------------------------------------
describe("Playtest: Wave 9", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];
    const bw9 = 800;

    function buildZoneStack9(
      reg: ComponentRegistry, state: SimulationState,
      zone: string, prefix: string, serverCount: number,
      withStream: boolean, withWorker: boolean,
    ) {
      const cdn = buildCDN(reg, zone);
      const cache = buildCache(reg, zone);
      const stream = withStream ? buildStreamingServer(reg, zone) : null;
      const worker = withWorker ? buildWorker(reg, zone) : null;
      const lb = buildLoadBalancer(`${prefix}-lb`, serverCount);
      const servers: ReturnType<typeof buildServer>[] = [];
      for (let i = 0; i < serverCount; i++) servers.push(buildServer(reg, zone));
      const db = buildDatabase(reg, zone);

      state.placeComponent(cdn.component);
      state.placeComponent(cache.component);
      if (stream) state.placeComponent(stream.component);
      if (worker) state.placeComponent(worker.component);
      state.placeComponent(lb.component);
      for (const s of servers) state.placeComponent(s.component);
      state.placeComponent(db.component);

      // Wire chain
      let lastComp: { component: Component; egressPortId: string } = { component: cdn.component, egressPortId: cdn.egressPortId };

      wire(state, lastComp, { component: cache.component, ingressPortId: cache.ingressPortId }, `c-${prefix}-cdn-cache`, { bandwidth: bw9 });
      lastComp = { component: cache.component, egressPortId: cache.egressPortId };

      if (stream) {
        wire(state, lastComp, { component: stream.component, ingressPortId: stream.ingressPortId }, `c-${prefix}-cache-stream`, { bandwidth: 15000 });
        lastComp = { component: stream.component, egressPortId: stream.egressPortId };
      }

      if (worker) {
        wire(state, lastComp, { component: worker.component, ingressPortId: worker.ingressPortId }, `c-${prefix}-prev-worker`, { bandwidth: bw9 });
        lastComp = { component: worker.component, egressPortId: worker.egressPortId };
      }

      wire(state, lastComp, { component: lb.component, ingressPortId: lb.ingressPortId }, `c-${prefix}-prev-lb`, { bandwidth: bw9 });

      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-${prefix}-lb-s${i}`, { bandwidth: bw9 });
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-${prefix}-s${i}-db`, { bandwidth: bw9 });
      }

      return { cdn };
    }

    // A: DNS/GTM -> 3 zones with CDN->Cache->Stream->Worker->LB->Srv2->DB
    {
      const reg = bootTDRegistry();
      const state = multiZoneState();
      const dns = buildDNSGTM(reg);
      dns.component.upgrade("forwarding-pipe" as CapabilityId, 2);
      state.placeComponent(dns.component);

      const na = buildZoneStack9(reg, state, "na-east", "na", 6, true, true);
      const eu = buildZoneStack9(reg, state, "eu-west", "eu", 5, true, true);
      const ap = buildZoneStack9(reg, state, "ap-south", "ap", 5, true, true);

      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na", { bandwidth: bw9 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu", { bandwidth: bw9 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap", { bandwidth: bw9 });

      const r = safeRunWave(state, WAVE_9, dns.component.id);
      if (r) results.push(extractMetrics("A: DNS -> 3z (CDN->Cache->Stream->Wk->LB->Srv6/5/5->DB)", r));
    }

    // B: DNS/GTM -> 3 zones lighter (CDN->Cache->LB->Srv3->DB)
    {
      const reg = bootTDRegistry();
      const state = multiZoneState();
      const dns = buildDNSGTM(reg);
      dns.component.upgrade("forwarding-pipe" as CapabilityId, 2);
      state.placeComponent(dns.component);

      const na = buildZoneStack9(reg, state, "na-east", "na", 3, false, false);
      const eu = buildZoneStack9(reg, state, "eu-west", "eu", 3, false, false);
      const ap = buildZoneStack9(reg, state, "ap-south", "ap", 3, false, false);

      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na", { bandwidth: bw9 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu", { bandwidth: bw9 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap", { bandwidth: bw9 });

      const r = safeRunWave(state, WAVE_9, dns.component.id);
      if (r) results.push(extractMetrics("B: DNS -> 3z (CDN->Cache->LB->Srv3->DB, lighter)", r));
    }

    // C: Single zone with all infrastructure (should lose on latency)
    {
      const reg = bootTDRegistry();
      const state = multiZoneState(); // still multi-zone state for pairLatency
      const dns = buildDNSGTM(reg);
      dns.component.upgrade("forwarding-pipe" as CapabilityId, 2);
      state.placeComponent(dns.component);

      // All infra in na-east only
      const na = buildZoneStack9(reg, state, "na-east", "na", 10, true, true);

      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na", { bandwidth: bw9 });

      const r = safeRunWave(state, WAVE_9, dns.component.id);
      if (r) results.push(extractMetrics("C: Single zone (na-east only, Srv10)", r));
    }

    // D: DNS/GTM -> 3 zones heavier (CDN->Cache->Stream->Wk->LB->Srv3->DB)
    {
      const reg = bootTDRegistry();
      const state = multiZoneState();
      const dns = buildDNSGTM(reg);
      dns.component.upgrade("forwarding-pipe" as CapabilityId, 2);
      state.placeComponent(dns.component);

      const na = buildZoneStack9(reg, state, "na-east", "na", 8, true, true);
      const eu = buildZoneStack9(reg, state, "eu-west", "eu", 7, true, true);
      const ap = buildZoneStack9(reg, state, "ap-south", "ap", 6, true, true);

      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na", { bandwidth: bw9 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu", { bandwidth: bw9 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap", { bandwidth: bw9 });

      const r = safeRunWave(state, WAVE_9, dns.component.id);
      if (r) results.push(extractMetrics("D: DNS -> 3z (CDN->Cache->Stream->Wk->LB->Srv8/7/6->DB)", r));
    }

    rankAndReport("WAVE 9: Going Global (800/tick, 3 zones, stream 30%)", results);
  });
});

// ---------------------------------------------------------------------------
// WAVE 10
// ---------------------------------------------------------------------------
describe("Playtest: Wave 10", () => {
  it("tests all topologies", () => {
    const results: TopologyResult[] = [];
    const bw10 = 3000;

    function buildZoneStack10(
      reg: ComponentRegistry, state: SimulationState,
      zone: string, prefix: string, serverCount: number,
      opts: { autoscaleServers?: number; autoscaleDB?: number; highTier?: boolean },
    ) {
      const cdn = buildCDN(reg, zone);
      const cache = buildCache(reg, zone);
      const stream = buildStreamingServer(reg, zone);
      const worker = buildHighThroughputWorker(`${prefix}-worker`, opts.highTier ? 3 : 1, zone);
      const lb = buildHighThroughputLB(`${prefix}-lb`, serverCount, opts.highTier ? 3 : 1, zone);
      const servers: ReturnType<typeof buildServer>[] = [];
      for (let i = 0; i < serverCount; i++) servers.push(buildServer(reg, zone));
      const db = buildDatabase(reg, zone);

      if (opts.highTier) {
        cdn.component.upgrade("forwarding-pipe" as CapabilityId, 3);
        cdn.component.upgrade("forwarding-pipe" as CapabilityId, 3);
        cache.component.upgrade("forwarding-pipe" as CapabilityId, 3);
        cache.component.upgrade("forwarding-pipe" as CapabilityId, 3);
        stream.component.upgrade("forwarding-pipe" as CapabilityId, 3);
        stream.component.upgrade("forwarding-pipe" as CapabilityId, 3);
        stream.component.upgrade("streaming" as CapabilityId, 3);
        stream.component.upgrade("streaming" as CapabilityId, 3);
      }

      if (opts.autoscaleServers) {
        for (const s of servers) {
          (s.component as any).maxInstances = opts.autoscaleServers;
          s.component.upgrade("auto-scale" as CapabilityId, 2);
          if (opts.highTier) {
            s.component.upgrade("processing" as CapabilityId, 3);
            s.component.upgrade("forwarding" as CapabilityId, 3);
          }
        }
      }
      if (opts.autoscaleDB) {
        (db.component as any).maxInstances = opts.autoscaleDB;
        db.component.upgrade("auto-scale" as CapabilityId, 2);
        if (opts.highTier) {
          db.component.upgrade("storage" as CapabilityId, 3);
        }
      }

      state.placeComponent(cdn.component);
      state.placeComponent(cache.component);
      state.placeComponent(stream.component);
      state.placeComponent(worker.component);
      state.placeComponent(lb.component);
      for (const s of servers) state.placeComponent(s.component);
      state.placeComponent(db.component);

      wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, `c-${prefix}-cdn-cache`, { bandwidth: bw10 });
      wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: stream.component, ingressPortId: stream.ingressPortId }, `c-${prefix}-cache-stream`, { bandwidth: 50000 });
      wire(state, { component: stream.component, egressPortId: stream.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, `c-${prefix}-stream-wk`, { bandwidth: bw10 });
      wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, `c-${prefix}-wk-lb`, { bandwidth: bw10 });

      for (let i = 0; i < serverCount; i++) {
        wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-${prefix}-lb-s${i}`, { bandwidth: bw10 });
        wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: db.component, ingressPortId: db.ingressPortId }, `c-${prefix}-s${i}-db`, { bandwidth: bw10 });
      }

      return { cdn };
    }

    // A: Server+DB autoscale (maxInstances 10/5), high tier
    {
      const reg = bootTDRegistry();
      const state = multiZoneState();
      const dns = buildDNSGTM(reg);
      for (let i = 0; i < 5; i++) dns.component.upgrade("forwarding-pipe" as CapabilityId, 6);
      state.placeComponent(dns.component);

      const na = buildZoneStack10(reg, state, "na-east", "na", 5, { autoscaleServers: 10, autoscaleDB: 5, highTier: true });
      const eu = buildZoneStack10(reg, state, "eu-west", "eu", 5, { autoscaleServers: 10, autoscaleDB: 5, highTier: true });
      const ap = buildZoneStack10(reg, state, "ap-south", "ap", 5, { autoscaleServers: 10, autoscaleDB: 5, highTier: true });

      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na", { bandwidth: bw10 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu", { bandwidth: bw10 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap", { bandwidth: bw10 });

      const r = safeRunWave(state, WAVE_10, dns.component.id);
      if (r) results.push(extractMetrics("A: 3z, Srv+DB autoscale(10/5), high tier", r));
    }

    // B: Server autoscale only (maxInstances 10), high tier
    {
      const reg = bootTDRegistry();
      const state = multiZoneState();
      const dns = buildDNSGTM(reg);
      for (let i = 0; i < 5; i++) dns.component.upgrade("forwarding-pipe" as CapabilityId, 6);
      state.placeComponent(dns.component);

      const na = buildZoneStack10(reg, state, "na-east", "na", 5, { autoscaleServers: 10, highTier: true });
      const eu = buildZoneStack10(reg, state, "eu-west", "eu", 5, { autoscaleServers: 10, highTier: true });
      const ap = buildZoneStack10(reg, state, "ap-south", "ap", 5, { autoscaleServers: 10, highTier: true });

      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na", { bandwidth: bw10 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu", { bandwidth: bw10 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap", { bandwidth: bw10 });

      const r = safeRunWave(state, WAVE_10, dns.component.id);
      if (r) results.push(extractMetrics("B: 3z, Srv autoscale only(10), high tier", r));
    }

    // C: Static (no autoscale, maxInstances 1), high tier
    {
      const reg = bootTDRegistry();
      const state = multiZoneState();
      const dns = buildDNSGTM(reg);
      for (let i = 0; i < 5; i++) dns.component.upgrade("forwarding-pipe" as CapabilityId, 6);
      state.placeComponent(dns.component);

      const na = buildZoneStack10(reg, state, "na-east", "na", 5, { highTier: true });
      const eu = buildZoneStack10(reg, state, "eu-west", "eu", 5, { highTier: true });
      const ap = buildZoneStack10(reg, state, "ap-south", "ap", 5, { highTier: true });

      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na", { bandwidth: bw10 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu", { bandwidth: bw10 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap", { bandwidth: bw10 });

      const r = safeRunWave(state, WAVE_10, dns.component.id);
      if (r) results.push(extractMetrics("C: 3z, static (no autoscale), high tier", r));
    }

    // D: Server+DB autoscale, even higher tier intermediaries
    {
      const reg = bootTDRegistry();
      const state = multiZoneState();
      const dns = buildDNSGTM(reg);
      for (let i = 0; i < 5; i++) dns.component.upgrade("forwarding-pipe" as CapabilityId, 6);
      state.placeComponent(dns.component);

      const na = buildZoneStack10(reg, state, "na-east", "na", 6, { autoscaleServers: 10, autoscaleDB: 5, highTier: true });
      const eu = buildZoneStack10(reg, state, "eu-west", "eu", 6, { autoscaleServers: 10, autoscaleDB: 5, highTier: true });
      const ap = buildZoneStack10(reg, state, "ap-south", "ap", 5, { autoscaleServers: 10, autoscaleDB: 5, highTier: true });

      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: na.cdn.component, ingressPortId: na.cdn.ingressPortId }, "c-dns-na", { bandwidth: bw10 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: eu.cdn.component, ingressPortId: eu.cdn.ingressPortId }, "c-dns-eu", { bandwidth: bw10 });
      wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: ap.cdn.component, ingressPortId: ap.cdn.ingressPortId }, "c-dns-ap", { bandwidth: bw10 });

      const r = safeRunWave(state, WAVE_10, dns.component.id);
      if (r) results.push(extractMetrics("D: 3z, Srv+DB autoscale(10/5), high tier, Srv6/6/5", r));
    }

    rankAndReport("WAVE 10: The Viral Moment (3000/tick, chaos, 3 zones)", results);
  });
});

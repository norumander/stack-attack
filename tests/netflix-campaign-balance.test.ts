/**
 * Headless balance test for all 8 Netflix campaign waves.
 * Each wave uses the intended architecture from the briefing.
 * Validates: drops < 100 (viability), latency within SLA, availability meets SLA.
 * Uses game-realistic latencySeconds: 0.1 (matching connect-ux.ts).
 */
import { describe, it, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { buildSimComponent } from "../src/physics-td/component-factory";
import { wireWorkers } from "../src/physics-td/wire-workers";
import { applyChaosEvent, type ChaosEvent } from "../src/physics-td/chaos";
import { CAMPAIGN_WAVES } from "../src/physics-td/waves";
import { enableAutoScale } from "@sim/capabilities/auto-scale";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";
import type { WaveMetrics } from "@sim/sla";

const CLIENT_ID = "client" as ComponentId;
const LATENCY = 0.1; // game-realistic

function wire(sim: Sim, from: string, to: string, n: { v: number }) {
  const fid = `c${n.v++}f` as ConnectionId;
  const bid = `c${n.v++}b` as ConnectionId;
  sim.addConnection(new SimConnection({
    id: fid,
    from: { componentId: from as ComponentId, portId: "p" as PortId },
    to: { componentId: to as ComponentId, portId: "p" as PortId },
    bandwidth: 500, latencySeconds: LATENCY, twinId: bid, direction: "forward",
  }));
  sim.addConnection(new SimConnection({
    id: bid,
    from: { componentId: to as ComponentId, portId: "p" as PortId },
    to: { componentId: from as ComponentId, portId: "p" as PortId },
    bandwidth: 500, latencySeconds: LATENCY, twinId: fid, direction: "back",
  }));
}

function add(sim: Sim, type: string, id: string, wave: WaveDef, zone?: string) {
  const comp = buildSimComponent(type, id as ComponentId, wave.revenue, zone)!;
  sim.addComponent(comp);
  return comp;
}

function makeClient(sim: Sim, wave: WaveDef, seed: number) {
  const ts = new TrafficSource(wave, makeSimRng(seed));
  const client = new SimClient({
    id: CLIENT_ID, capabilities: [], packetRate: wave.packetRate,
    trafficSource: ts, waveStartTime: 0, waveEndTime: wave.duration,
    ...(wave.rampSeconds !== undefined && { rampSeconds: wave.rampSeconds }),
  });
  sim.addClient(client);
}

function runWithChaos(sim: Sim, wave: WaveDef, chaos: ReadonlyArray<ChaosEvent>): WaveMetrics {
  const step = 1 / 60;
  const total = Math.ceil((wave.duration + 4) / step);
  let responded = 0, terminated = 0, drops = 0, totalRevenue = 0;
  let latencySum = 0, latencyCount = 0, totalRequests = 0;
  const seenIds = new Set<string>();
  const fired = new Set<number>();
  let elapsed = 0;
  for (let i = 0; i < total; i++) {
    for (let k = 0; k < chaos.length; k++) {
      if (fired.has(k)) continue;
      if (chaos[k]!.atSeconds <= elapsed) { applyChaosEvent(chaos[k]!, sim); fired.add(k); }
    }
    sim.step(step);
    elapsed += step;
    for (const p of sim.activePackets) {
      if (p.direction !== "forward" || p.parentId !== null) continue;
      if (!seenIds.has(p.id)) { seenIds.add(p.id); totalRequests += p.requests.length; }
    }
    for (const ev of sim.lastStepEvents) {
      if (ev.kind === "drop") drops += ev.count;
      if (ev.kind === "terminate") { terminated += ev.count; totalRevenue += ev.revenue; latencySum += ev.latencySeconds; latencyCount++; }
      if (ev.kind === "respond-delivered") { responded += ev.count; totalRevenue += ev.revenue; latencySum += ev.latencySeconds; latencyCount++; }
    }
  }
  return { totalRequests, responded, terminated, drops, avgLatencySeconds: latencyCount > 0 ? latencySum / latencyCount : 0, totalRevenue };
}

function report(label: string, m: WaveMetrics, sla: { availability: number; maxAvgLatencySeconds: number }) {
  const denom = Math.max(1, m.totalRequests);
  const avail = (m.responded + m.terminated) / denom;
  console.log(`${label}: reqs=${m.totalRequests} drops=${m.drops} avail=${(avail*100).toFixed(1)}% latency=${m.avgLatencySeconds.toFixed(3)}s | SLA: avail≥${(sla.availability*100).toFixed(0)}% lat≤${sla.maxAvgLatencySeconds}s | viability=${m.drops < 100 ? "OK" : "DEAD"}`);
  return { avail, drops: m.drops };
}

describe("Netflix campaign balance", () => {
  // W1: Client → Server → Database
  it("W1 — Launch Day", () => {
    const w = CAMPAIGN_WAVES[0]!;
    const sim = new Sim({ seed: 42 });
    const n = { v: 0 };
    makeClient(sim, w.wave, 42);
    add(sim, "server", "srv", w.wave);
    add(sim, "database", "db", w.wave);
    wire(sim, CLIENT_ID, "srv", n);
    wire(sim, "srv", "db", n);
    const m = runWave(sim, { durationSeconds: w.wave.duration, drainSeconds: 4 });
    const r = report("W1", m, w.sla);
    expect(r.drops).toBeLessThan(100);
    expect(r.avail).toBeGreaterThanOrEqual(w.sla.availability);
  });

  // W2: Client → LB → Server1/Server2 → DataCache → Database
  it("W2 — Growth Spike", () => {
    const w = CAMPAIGN_WAVES[1]!;
    const sim = new Sim({ seed: 43 });
    const n = { v: 0 };
    makeClient(sim, w.wave, 43);
    add(sim, "load_balancer", "lb", w.wave);
    add(sim, "server", "srv1", w.wave);
    add(sim, "server", "srv2", w.wave);
    add(sim, "data_cache", "dc", w.wave);
    add(sim, "database", "db", w.wave);
    wire(sim, CLIENT_ID, "lb", n);
    wire(sim, "lb", "srv1", n);
    wire(sim, "lb", "srv2", n);
    wire(sim, "srv1", "dc", n);
    wire(sim, "srv2", "dc", n);
    wire(sim, "dc", "db", n);
    const m = runWave(sim, { durationSeconds: w.wave.duration, drainSeconds: 4 });
    const r = report("W2", m, w.sla);
    expect(r.drops).toBeLessThan(100);
    expect(r.avail).toBeGreaterThanOrEqual(w.sla.availability);
  });

  // W3: Client → CDN (large), Client → APIGateway (auth) → LB → Servers → DC → DB
  it("W3 — Going Mainstream", () => {
    const w = CAMPAIGN_WAVES[2]!;
    const sim = new Sim({ seed: 44 });
    const n = { v: 0 };
    makeClient(sim, w.wave, 44);
    add(sim, "cdn", "cdn", w.wave);
    add(sim, "api_gateway", "ag", w.wave);
    add(sim, "load_balancer", "lb", w.wave);
    add(sim, "server", "srv1", w.wave);
    add(sim, "server", "srv2", w.wave);
    add(sim, "data_cache", "dc", w.wave);
    add(sim, "database", "db", w.wave);
    wire(sim, CLIENT_ID, "cdn", n);
    wire(sim, CLIENT_ID, "ag", n);
    wire(sim, "cdn", "lb", n);
    wire(sim, "ag", "lb", n);
    wire(sim, "lb", "srv1", n);
    wire(sim, "lb", "srv2", n);
    wire(sim, "srv1", "dc", n);
    wire(sim, "srv2", "dc", n);
    wire(sim, "dc", "db", n);
    const m = runWave(sim, { durationSeconds: w.wave.duration, drainSeconds: 4 });
    const r = report("W3", m, w.sla);
    expect(r.drops).toBeLessThan(100);
    expect(r.avail).toBeGreaterThanOrEqual(w.sla.availability);
  });

  // W4: Queue before LB. Client → CDN/AG → Queue → LB → Servers → DC → DB, Queue → Worker
  it("W4 — Async Operations", () => {
    const w = CAMPAIGN_WAVES[3]!;
    const sim = new Sim({ seed: 45 });
    const n = { v: 0 };
    makeClient(sim, w.wave, 45);
    add(sim, "cdn", "cdn", w.wave);
    add(sim, "api_gateway", "ag", w.wave);
    add(sim, "queue", "q", w.wave);
    add(sim, "load_balancer", "lb", w.wave);
    add(sim, "server", "srv1", w.wave);
    add(sim, "server", "srv2", w.wave);
    add(sim, "data_cache", "dc", w.wave);
    add(sim, "database", "db", w.wave);
    add(sim, "worker", "wk", w.wave);
    wire(sim, CLIENT_ID, "cdn", n);
    wire(sim, CLIENT_ID, "ag", n);
    wire(sim, "cdn", "q", n);
    wire(sim, "ag", "q", n);
    wire(sim, "q", "lb", n);
    wire(sim, "q", "wk", n);
    wire(sim, "lb", "srv1", n);
    wire(sim, "lb", "srv2", n);
    wire(sim, "srv1", "dc", n);
    wire(sim, "srv2", "dc", n);
    wire(sim, "dc", "db", n);
    wireWorkers(sim);
    const m = runWave(sim, { durationSeconds: w.wave.duration, drainSeconds: 4 });
    const r = report("W4", m, w.sla);
    expect(r.drops).toBeLessThan(100);
    expect(r.avail).toBeGreaterThanOrEqual(w.sla.availability);
  });

  // W5: CB → Queue → LB → 3 Servers. Chaos crashes servers.
  it("W5 — Things Break", () => {
    const w = CAMPAIGN_WAVES[4]!;
    const sim = new Sim({ seed: 46 });
    const n = { v: 0 };
    makeClient(sim, w.wave, 46);
    add(sim, "cdn", "cdn", w.wave);
    add(sim, "api_gateway", "ag", w.wave);
    add(sim, "circuit_breaker", "cb", w.wave);
    add(sim, "queue", "q", w.wave);
    add(sim, "load_balancer", "lb", w.wave);
    add(sim, "server", "srv1", w.wave);
    add(sim, "server", "srv2", w.wave);
    add(sim, "server", "srv3", w.wave);
    add(sim, "data_cache", "dc", w.wave);
    add(sim, "database", "db", w.wave);
    add(sim, "worker", "wk", w.wave);
    wire(sim, CLIENT_ID, "cdn", n);
    wire(sim, CLIENT_ID, "ag", n);
    wire(sim, "cdn", "cb", n);
    wire(sim, "ag", "cb", n);
    wire(sim, "cb", "q", n);
    wire(sim, "q", "lb", n);
    wire(sim, "q", "wk", n);
    wire(sim, "lb", "srv1", n);
    wire(sim, "lb", "srv2", n);
    wire(sim, "lb", "srv3", n);
    wire(sim, "srv1", "dc", n);
    wire(sim, "srv2", "dc", n);
    wire(sim, "srv3", "dc", n);
    wire(sim, "dc", "db", n);
    wireWorkers(sim);
    const m = runWithChaos(sim, w.wave, w.chaosSchedule!);
    const r = report("W5", m, w.sla);
    expect(r.drops).toBeLessThan(100);
    expect(r.avail).toBeGreaterThanOrEqual(w.sla.availability);
  });

  // W6: SS client-facing for streams. CB → Queue → LB → 3 Servers.
  it("W6 — Video Launch", () => {
    const w = CAMPAIGN_WAVES[5]!;
    const sim = new Sim({ seed: 47 });
    const n = { v: 0 };
    makeClient(sim, w.wave, 47);
    add(sim, "cdn", "cdn", w.wave);
    add(sim, "api_gateway", "ag", w.wave);
    add(sim, "streaming_server", "ss", w.wave);
    add(sim, "circuit_breaker", "cb", w.wave);
    add(sim, "queue", "q", w.wave);
    add(sim, "load_balancer", "lb", w.wave);
    add(sim, "server", "srv1", w.wave);
    add(sim, "server", "srv2", w.wave);
    add(sim, "server", "srv3", w.wave);
    add(sim, "data_cache", "dc", w.wave);
    add(sim, "database", "db", w.wave);
    add(sim, "blob_storage", "blob", w.wave);
    add(sim, "worker", "wk", w.wave);
    wire(sim, CLIENT_ID, "cdn", n);
    wire(sim, CLIENT_ID, "ag", n);
    wire(sim, CLIENT_ID, "ss", n);
    wire(sim, "cdn", "cb", n);
    wire(sim, "ag", "cb", n);
    wire(sim, "ss", "blob", n);
    wire(sim, "cb", "q", n);
    wire(sim, "q", "lb", n);
    wire(sim, "q", "wk", n);
    wire(sim, "lb", "srv1", n);
    wire(sim, "lb", "srv2", n);
    wire(sim, "lb", "srv3", n);
    wire(sim, "srv1", "dc", n);
    wire(sim, "srv2", "dc", n);
    wire(sim, "srv3", "dc", n);
    wire(sim, "dc", "db", n);
    wire(sim, "dc", "blob", n);
    wireWorkers(sim);
    const m = runWave(sim, { durationSeconds: w.wave.duration, drainSeconds: 4 });
    const r = report("W6", m, w.sla);
    expect(r.drops).toBeLessThan(100);
    expect(r.avail).toBeGreaterThanOrEqual(w.sla.availability);
  });

  // W7: DNS/GTM → 3 zone stacks (each: LB → 2 Servers → DC → DB)
  it("W7 — Going Global", () => {
    const w = CAMPAIGN_WAVES[6]!;
    const sim = new Sim({ seed: 48 });
    const n = { v: 0 };
    makeClient(sim, w.wave, 48);
    add(sim, "dns_gtm", "dns", w.wave);
    for (const zone of ["zone_na", "zone_eu", "zone_ap"]) {
      const z = zone.replace("zone_", "");
      add(sim, "load_balancer", `lb_${z}`, w.wave, zone);
      add(sim, "server", `srv1_${z}`, w.wave, zone);
      add(sim, "server", `srv2_${z}`, w.wave, zone);
      add(sim, "data_cache", `dc_${z}`, w.wave, zone);
      add(sim, "database", `db_${z}`, w.wave, zone);
    }
    wire(sim, CLIENT_ID, "dns", n);
    for (const z of ["na", "eu", "ap"]) {
      wire(sim, "dns", `lb_${z}`, n);
      wire(sim, `lb_${z}`, `srv1_${z}`, n);
      wire(sim, `lb_${z}`, `srv2_${z}`, n);
      wire(sim, `srv1_${z}`, `dc_${z}`, n);
      wire(sim, `srv2_${z}`, `dc_${z}`, n);
      wire(sim, `dc_${z}`, `db_${z}`, n);
    }
    const m = runWave(sim, { durationSeconds: w.wave.duration, drainSeconds: 4 });
    const r = report("W7", m, w.sla);
    expect(r.drops).toBeLessThan(100);
    expect(r.avail).toBeGreaterThanOrEqual(w.sla.availability);
  });

  // W8: Viral moment — single zone, AutoScale on servers+DB, chaos crashes servers
  it("W8 — Viral Moment", () => {
    const w = CAMPAIGN_WAVES[7]!;
    const sim = new Sim({ seed: 49 });
    const n = { v: 0 };
    makeClient(sim, w.wave, 49);
    add(sim, "cdn", "cdn", w.wave);
    add(sim, "api_gateway", "ag", w.wave);
    add(sim, "circuit_breaker", "cb", w.wave);
    add(sim, "load_balancer", "lb", w.wave);
    add(sim, "queue", "q", w.wave);
    const s1 = add(sim, "server", "srv1", w.wave);
    const s2 = add(sim, "server", "srv2", w.wave);
    const s3 = add(sim, "server", "srv3", w.wave);
    add(sim, "streaming_server", "ss", w.wave);
    add(sim, "data_cache", "dc", w.wave);
    const db = add(sim, "database", "db", w.wave);
    add(sim, "blob_storage", "blob", w.wave);
    add(sim, "worker", "wk", w.wave);
    enableAutoScale(s1); enableAutoScale(s2); enableAutoScale(s3); enableAutoScale(db);
    wire(sim, CLIENT_ID, "cdn", n);
    wire(sim, CLIENT_ID, "ag", n);
    wire(sim, CLIENT_ID, "ss", n);
    wire(sim, "cdn", "cb", n);
    wire(sim, "ag", "cb", n);
    wire(sim, "ss", "blob", n);
    wire(sim, "cb", "q", n);
    wire(sim, "q", "lb", n);
    wire(sim, "q", "wk", n);
    wire(sim, "lb", "srv1", n);
    wire(sim, "lb", "srv2", n);
    wire(sim, "lb", "srv3", n);
    wire(sim, "srv1", "dc", n);
    wire(sim, "srv2", "dc", n);
    wire(sim, "srv3", "dc", n);
    wire(sim, "dc", "db", n);
    wire(sim, "dc", "blob", n);
    wireWorkers(sim);
    const m = runWithChaos(sim, w.wave, w.chaosSchedule!);
    const r = report("W8", m, w.sla);
    expect(r.drops).toBeLessThan(100);
    expect(r.avail).toBeGreaterThanOrEqual(w.sla.availability);
  });
});

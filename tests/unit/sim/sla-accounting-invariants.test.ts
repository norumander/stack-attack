import { describe, it, expect, beforeEach } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { SimClient } from "@sim/client";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { CachingCapability } from "@sim/capabilities/caching";
import { resetIdCountersForTest } from "@sim/packet";
import { runWave } from "@sim/test-harness";
import type { WaveDef } from "@sim/wave";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

/**
 * Guards against the SLA > 100% bug: when a cache splits a packet into
 * hits + misses, two separate `respond-delivered` events fire for one
 * original packet. The availability denominator must be in REQUESTS
 * (not packets) so both events are counted against the same unit.
 */

const CLIENT = "client" as ComponentId;
const CACHE = "cache" as ComponentId;
const DB = "db" as ComponentId;

function connect(
  from: ComponentId,
  fromPort: string,
  to: ComponentId,
  toPort: string,
  forwardId: string,
  twinId: string,
  direction: "forward" | "back",
): SimConnection {
  return new SimConnection({
    id: forwardId as ConnectionId,
    from: { componentId: from, portId: fromPort as PortId },
    to: { componentId: to, portId: toPort as PortId },
    bandwidth: 1000,
    latencySeconds: 0.05,
    twinId: twinId as ConnectionId,
    direction,
  });
}

function boot(): Sim {
  const sim = new Sim({ seed: 1 });
  const cacheComp = new SimComponent({
    id: CACHE,
    capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: 1 })],
  });
  const dbComp = new SimComponent({
    id: DB,
    capabilities: [new ProcessingCapability({ revenuePerRead: 1, revenuePerWrite: 0 })],
    capacityPerSecond: 1000,
  });
  sim.addComponent(cacheComp);
  sim.addComponent(dbComp);
  sim.addConnection(connect(CLIENT, "out", CACHE, "in", "cli_cache_f", "cli_cache_b", "forward"));
  sim.addConnection(connect(CACHE, "out", CLIENT, "in", "cli_cache_b", "cli_cache_f", "back"));
  sim.addConnection(connect(CACHE, "out", DB, "in", "cache_db_f", "cache_db_b", "forward"));
  sim.addConnection(connect(DB, "out", CACHE, "in", "cache_db_b", "cache_db_f", "back"));
  return sim;
}

describe("SLA accounting invariants", () => {
  beforeEach(() => resetIdCountersForTest());

  it("responded + terminated === totalRequests for a clean-pass wave with cache splits", () => {
    const sim = boot();
    const wave: WaveDef = {
      intensity: 6,
      packetRate: 1,
      duration: 3,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      // Tiny keyspace → cache will partial-hit after warmup, forcing split
      // responses (hits respond at cache, misses forward to DB).
      keyDistribution: { kind: "zipf", alpha: 1.2, spaceSize: 4 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT],
    };
    const ts = new TrafficSource(wave, makeSimRng(2));
    const clientObj = new SimClient({
      id: CLIENT,
      capabilities: [],
      packetRate: wave.packetRate,
      trafficSource: ts,
      waveStartTime: 0,
      waveEndTime: wave.duration,
    });
    sim.addClient(clientObj);

    const metrics = runWave(sim, { durationSeconds: wave.duration, drainSeconds: 2 });

    expect(metrics.drops).toBe(0);
    expect(metrics.totalRequests).toBeGreaterThan(0);
    expect(metrics.responded + metrics.terminated).toBe(metrics.totalRequests);
  });

  it("revenue equals totalRequests * perRead when wave.perRead is 1", () => {
    const sim = boot();
    const wave: WaveDef = {
      intensity: 6,
      packetRate: 1,
      duration: 3,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.2, spaceSize: 4 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT],
    };
    const ts = new TrafficSource(wave, makeSimRng(3));
    const clientObj = new SimClient({
      id: CLIENT,
      capabilities: [],
      packetRate: wave.packetRate,
      trafficSource: ts,
      waveStartTime: 0,
      waveEndTime: wave.duration,
    });
    sim.addClient(clientObj);

    const metrics = runWave(sim, { durationSeconds: wave.duration, drainSeconds: 2 });

    expect(metrics.drops).toBe(0);
    expect(metrics.totalRevenue).toBe(metrics.totalRequests * wave.revenue.perRead);
  });
});

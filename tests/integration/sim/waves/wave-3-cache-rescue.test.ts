import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const WAVE_3: WaveDef = {
  intensity: 50,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 1 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.95, maxAvgLatencySeconds: 1, maxDropRate: 0.05 };

describe("Wave 3 — Data Cache rescue wins", () => {
  beforeEach(() => resetIdCountersForTest());

  it("cache absorbs hot-key reads; DB handles only misses", () => {
    const sim = new Sim({ seed: 7 });
    const ts = new TrafficSource(WAVE_3, makeSimRng(7));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_3.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_3.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: 1 })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 30,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 300, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    sim.addConnection(mk("sk", server.id, cache.id, "forward", "ks"));
    sim.addConnection(mk("ks", cache.id, server.id, "back", "sk"));
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_3.duration, drainSeconds: 3 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.drops).toBe(0);
  });
});

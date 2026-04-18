import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { CachingCapability } from "@sim/capabilities/caching";
import { StreamingCapability } from "@sim/capabilities/streaming";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

class StreamSplitDispatcher implements SimCapability {
  readonly id = "stream-split";
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const isStream = packet.requests[0]?.stream !== undefined;
    const idx = isStream ? 0 : 1;
    const egress = ctx.egressEdges[idx];
    if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    const child: Packet = {
      id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
      spawnedAt: packet.spawnedAt, parentId: packet.id, direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }
}

const WAVE_8: WaveDef = {
  intensity: 80,
  packetRate: 8,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0.3, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 5 },
  streamConfig: { duration: 1.5, bandwidth: 50 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 };

describe("Wave 8 — streaming bandwidth reservation", () => {
  beforeEach(() => resetIdCountersForTest());

  it("streams reserve bandwidth on dedicated server, others go through cache", () => {
    const sim = new Sim({ seed: 42 });
    const ts = new TrafficSource(WAVE_8, makeSimRng(42));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_8.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_8.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new StreamSplitDispatcher()],
    });
    const ss = new SimComponent({
      id: "stream-server" as ComponentId,
      capabilities: [new StreamingCapability({ revenuePerStream: WAVE_8.revenue.perStream })],
    });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_8.revenue.perRead })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: WAVE_8.revenue.perRead })],
      capacityPerSecond: 60,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addComponent(ss);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string, bandwidth = 500) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    // Client ↔ Server
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    // Server egresses MUST be ordered [streamServer, cache] to match dispatcher
    // The streaming-server ingress needs ample bandwidth for stream reservations
    // (peak: 24 streams/sec × 1.5s × 50 bw = 1800 bw).
    sim.addConnection(mk("sst", server.id, ss.id, "forward", "sts", 5000));
    sim.addConnection(mk("sts", ss.id, server.id, "back", "sst"));
    sim.addConnection(mk("sk", server.id, cache.id, "forward", "ks"));
    sim.addConnection(mk("ks", cache.id, server.id, "back", "sk"));
    // Cache ↔ DB
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_8.duration, drainSeconds: 4 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.terminated).toBeGreaterThan(0); // streams terminate at SS
    expect(metrics.responded).toBeGreaterThan(0);  // reads respond
  });
});

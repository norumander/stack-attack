import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { CachingCapability } from "@sim/capabilities/caching";
import { QueueCapability } from "@sim/capabilities/queue";
import { WorkerCapability } from "@sim/capabilities/worker";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

/**
 * Three-way dispatcher: batch → queue, write → db, else → cache. Egresses
 * must be configured in that exact order on the component.
 */
class ServerTrioDispatcher implements SimCapability {
  readonly id = "server-trio";
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const first = packet.requests[0];
    if (!first) return { kind: "drop", reason: "empty_packet", count: 0 };
    let idx = 2; // default cache
    if (first.isAsync) idx = 0;
    else if (first.isWrite) idx = 1;
    const egress = ctx.egressEdges[idx];
    if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    const child: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: egress.id,
      progress: 0,
      speed: egress.speed,
      spawnedAt: packet.spawnedAt,
      parentId: packet.id,
      direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }
}

const WAVE_6: WaveDef = {
  intensity: 100,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0.2, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0.2 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 };

describe("Wave 6 — Queue + Worker batch handling", () => {
  beforeEach(() => resetIdCountersForTest());

  it("dispatches batch to Queue/Worker, writes to DB, reads through Cache", () => {
    const sim = new Sim({ seed: 31 });
    const ts = new TrafficSource(WAVE_6, makeSimRng(31));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_6.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_6.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ServerTrioDispatcher()],
    });
    const queue = new QueueCapability({ capacity: 100 });
    const queueComp = new SimComponent({ id: "queue" as ComponentId, capabilities: [queue] });
    const worker = new WorkerCapability({ pullRate: 30, revenuePerItem: 1 }, queue);
    const workerComp = new SimComponent({ id: "worker" as ComponentId, capabilities: [worker] });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_6.revenue.perRead })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: WAVE_6.revenue.perWrite, revenuePerRead: WAVE_6.revenue.perRead })],
      capacityPerSecond: 60,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addComponent(queueComp);
    sim.addComponent(workerComp);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 500, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    // Client ↔ Server
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    // Server egresses MUST be in order [queue, db, cache] to match dispatcher indices
    sim.addConnection(mk("sq", server.id, queueComp.id, "forward", "qs"));
    sim.addConnection(mk("qs", queueComp.id, server.id, "back", "sq"));
    sim.addConnection(mk("sd", server.id, db.id, "forward", "ds"));
    sim.addConnection(mk("ds", db.id, server.id, "back", "sd"));
    sim.addConnection(mk("sk", server.id, cache.id, "forward", "ks"));
    sim.addConnection(mk("ks", cache.id, server.id, "back", "sk"));
    // Cache ↔ DB
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_6.duration, drainSeconds: 4 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    // batch + writes terminate; reads respond
    expect(metrics.terminated).toBeGreaterThan(0);
    expect(metrics.responded).toBeGreaterThan(0);
  });
});

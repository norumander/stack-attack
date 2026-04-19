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
import type { ArrivalContext, Outcome, Packet, SimCapability } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

class CDNDispatcherCapability implements SimCapability {
  readonly id = "cdn-dispatcher";
  private readonly cache: CachingCapability;
  constructor(private readonly revenuePerRead: number, capacity: number) {
    this.cache = new CachingCapability({ capacity, revenuePerRead });
  }
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allLarge = packet.requests.every((r) => r.isLarge);
    if (allLarge) return this.cache.onArriveRequest(packet, ctx);
    const egress = ctx.egressEdges[0];
    if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    const child: Packet = {
      id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
      spawnedAt: packet.spawnedAt, parentId: packet.id, direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }
  onArriveResponse(packet: Packet, ctx: ArrivalContext): void {
    this.cache.onArriveResponse?.(packet, ctx);
  }
}

const WAVE_4: WaveDef = {
  intensity: 80,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0.5, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 1 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.9, maxAvgLatencySeconds: 1, maxDropRate: 0.1 };

describe("Wave 4 — CDN + Cache rescue", () => {
  beforeEach(() => resetIdCountersForTest());

  it("CDN absorbs static_asset; core stack handles rest", () => {
    const sim = new Sim({ seed: 11 });
    const ts = new TrafficSource(WAVE_4, makeSimRng(11));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_4.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_4.duration,
    });
    const cdn = new SimComponent({
      id: "cdn" as ComponentId,
      capabilities: [new CDNDispatcherCapability(WAVE_4.revenue.perRead, 32)],
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_4.revenue.perRead })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: WAVE_4.revenue.perRead })],
      capacityPerSecond: 40,
    });
    sim.addClient(client);
    sim.addComponent(cdn);
    sim.addComponent(server);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 300, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cl", client.id, cdn.id, "forward", "lc"));
    sim.addConnection(mk("lc", cdn.id, client.id, "back", "cl"));
    sim.addConnection(mk("ls", cdn.id, server.id, "forward", "sl"));
    sim.addConnection(mk("sl", server.id, cdn.id, "back", "ls"));
    sim.addConnection(mk("sk", server.id, cache.id, "forward", "ks"));
    sim.addConnection(mk("ks", cache.id, server.id, "back", "sk"));
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_4.duration, drainSeconds: 3 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
  });
});

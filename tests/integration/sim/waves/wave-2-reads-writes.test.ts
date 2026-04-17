import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

class ServerDispatcherCapability implements SimCapability {
  readonly id = "server-dispatcher";
  constructor(private readonly revenuePerRead: number) {}
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const isWrite = packet.requests[0]?.isWrite ?? false;
    if (!isWrite) {
      const response: Packet = {
        id: ctx.mintPacketId(),
        requests: packet.requests,
        edgeId: packet.edgeId,
        progress: 0,
        speed: packet.speed,
        spawnedAt: packet.spawnedAt,
        parentId: packet.id,
        direction: "back",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "respond", responsePacket: response, revenueOnDelivery: this.revenuePerRead * packet.requests.length };
    }
    const egress = ctx.egressEdges[0];
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

const WAVE_2: WaveDef = {
  intensity: 20,
  packetRate: 5,
  duration: 5,
  composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 50 },
  revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.9, maxAvgLatencySeconds: 1, maxDropRate: 0.1 };

describe("Wave 2 — Client ↔ Server ↔ DB", () => {
  beforeEach(() => resetIdCountersForTest());

  it("reads served locally; writes routed to DB; both hit SLA", () => {
    const sim = new Sim({ seed: 99 });
    const ts = new TrafficSource(WAVE_2, makeSimRng(99));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_2.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_2.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ServerDispatcherCapability(WAVE_2.revenue.perRead)],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: WAVE_2.revenue.perWrite, revenuePerRead: 0 })],
      capacityPerSecond: 50,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    sim.addConnection(mk("sd", server.id, db.id, "forward", "ds"));
    sim.addConnection(mk("ds", db.id, server.id, "back", "sd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_2.duration, drainSeconds: 2 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.responded).toBeGreaterThan(0);
    expect(metrics.terminated).toBeGreaterThan(0);
  });
});

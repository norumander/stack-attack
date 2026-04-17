import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, mintPacketId, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, ArrivalContext, Packet, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function forwardingCap(toEdgeId: ConnectionId, speed: number): SimCapability {
  return {
    id: "forwarder",
    onArriveRequest(p: Packet, ctx: ArrivalContext): Outcome {
      const child: Packet = {
        ...p,
        id: ctx.mintPacketId(),
        edgeId: toEdgeId,
        progress: 0,
        speed,
        route: [...p.route, ctx.ingressEdgeId],
      } as Packet;
      return { kind: "forward", emit: [{ edgeId: toEdgeId, packet: child }] };
    },
  };
}

describe("outcome: forward", () => {
  beforeEach(() => resetIdCountersForTest());

  it("spawns emitted packet onto egress edge and tracks route", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const edge1 = new SimConnection({
      id: "e1" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "e1t" as ConnectionId,
      direction: "forward",
    });
    const edge2 = new SimConnection({
      id: "e2" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "c" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "e2t" as ConnectionId,
      direction: "forward",
    });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [forwardingCap(edge2.id, edge2.speed)] });
    const c = new SimComponent({ id: "c" as ComponentId, capabilities: [] });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addComponent(c);
    sim.addConnection(edge1);
    sim.addConnection(edge2);
    const p = makePacket({ requests: [], edgeId: edge1.id, speed: edge1.speed, spawnedAt: 0, direction: "forward" });
    sim.spawnPacket(p);

    sim.step(1 / 60); // p arrives at b, is forwarded onto edge2
    expect(sim.activePackets.length).toBe(1);
    const emitted = sim.activePackets[0];
    expect(emitted.edgeId).toBe(edge2.id);
    expect(emitted.progress).toBe(0);
    expect(emitted.route).toEqual([edge1.id]);
  });
});

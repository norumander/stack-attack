import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, ArrivalContext, Packet, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function forwarder(toEdge: ConnectionId, speed: number): SimCapability {
  return {
    id: "forwarder",
    onArriveRequest(p: Packet, ctx: ArrivalContext): Outcome {
      const child: Packet = {
        ...p,
        id: ctx.mintPacketId(),
        edgeId: toEdge,
        progress: 0,
        speed,
        route: [...p.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: toEdge, packet: child }] };
    },
  };
}

function responder(revenue: number, backSpeed: number): SimCapability {
  return {
    id: "responder",
    onArriveRequest(p: Packet, ctx: ArrivalContext): Outcome {
      const response: Packet = {
        id: ctx.mintPacketId(),
        requests: p.requests,
        edgeId: p.edgeId,
        progress: 0,
        speed: backSpeed,
        spawnedAt: ctx.simTime,
        parentId: p.id,
        direction: "back",
        route: [...p.route, ctx.ingressEdgeId],
      };
      return { kind: "respond", responsePacket: response, revenueOnDelivery: revenue };
    },
  };
}

describe("twin retrace — 3-hop", () => {
  beforeEach(() => resetIdCountersForTest());

  it("response traverses A→B, B→C and retires at A", () => {
    const sim = new Sim({ seed: 1 });
    const eAB = new SimConnection({
      id: "eAB" as ConnectionId,
      from: { componentId: "a" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eBA" as ConnectionId, direction: "forward",
    });
    const eBA = new SimConnection({
      id: "eBA" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "a" as ComponentId, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eAB" as ConnectionId, direction: "back",
    });
    const eBC = new SimConnection({
      id: "eBC" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "c" as ComponentId, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eCB" as ConnectionId, direction: "forward",
    });
    const eCB = new SimConnection({
      id: "eCB" as ConnectionId,
      from: { componentId: "c" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eBC" as ConnectionId, direction: "back",
    });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [forwarder(eBC.id, eBC.speed)] });
    const c = new SimComponent({ id: "c" as ComponentId, capabilities: [responder(11, eCB.speed)] });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addComponent(c);
    sim.addConnection(eAB);
    sim.addConnection(eBA);
    sim.addConnection(eBC);
    sim.addConnection(eCB);
    sim.spawnPacket(makePacket({ requests: [], edgeId: eAB.id, speed: eAB.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60); // arrives at b, forwarded onto eBC
    sim.step(1 / 60); // arrives at c, responds onto eCB
    expect(sim.activePackets[0]?.edgeId).toBe(eCB.id);
    expect(sim.activePackets[0]?.direction).toBe("back");
    sim.step(1 / 60); // response arrives at b, retraces onto eBA
    expect(sim.activePackets[0]?.edgeId).toBe(eBA.id);
    sim.step(1 / 60); // response arrives at a, retires
    const delivered = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: "respond-delivered", componentId: a.id, revenue: 11 });
    expect(sim.activePackets.length).toBe(0);
  });
});

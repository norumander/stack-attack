import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, ArrivalContext, Packet, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function responder(revenue: number, backSpeed: number): SimCapability {
  return {
    id: "responder",
    onArriveRequest(p: Packet, ctx: ArrivalContext): Outcome {
      const response: Packet = {
        id: ctx.mintPacketId(),
        requests: p.requests,
        edgeId: p.edgeId, // will be overwritten by sim using twin lookup
        progress: 0,
        speed: backSpeed,
        spawnedAt: ctx.simTime,
        parentId: p.id,
        direction: "back",
        route: [...p.route],
      };
      return { kind: "respond", responsePacket: response, revenueOnDelivery: revenue };
    },
  };
}

describe("outcome: respond", () => {
  beforeEach(() => resetIdCountersForTest());

  it("emits response packet on the twin of the request's ingress edge", () => {
    const sim = new Sim({ seed: 1 });
    const forwardEdge = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: "a" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "eb" as ConnectionId,
      direction: "forward",
    });
    const backEdge = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "a" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "ef" as ConnectionId,
      direction: "back",
    });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [responder(5, backEdge.speed)] });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(forwardEdge);
    sim.addConnection(backEdge);
    sim.spawnPacket(makePacket({ requests: [], edgeId: forwardEdge.id, speed: forwardEdge.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    // request arrived at b; response should now be in-flight on backEdge
    expect(sim.activePackets.length).toBe(1);
    const p = sim.activePackets[0]!;
    expect(p.direction).toBe("back");
    expect(p.edgeId).toBe(backEdge.id);
  });

  it("fires respond-delivered event when response reaches origin (empty route)", () => {
    const sim = new Sim({ seed: 1 });
    const forwardEdge = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: "a" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "eb" as ConnectionId,
      direction: "forward",
    });
    const backEdge = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "a" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "ef" as ConnectionId,
      direction: "back",
    });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [responder(7, backEdge.speed)] });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(forwardEdge);
    sim.addConnection(backEdge);
    sim.spawnPacket(makePacket({ requests: [], edgeId: forwardEdge.id, speed: forwardEdge.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60); // request arrives at b, response born on eb
    sim.step(1 / 60); // response arrives at a
    const delivered = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: "respond-delivered", componentId: a.id, revenue: 7 });
    expect(sim.activePackets.length).toBe(0);
  });
});

import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("ForwardingCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  it("emits a child packet onto the single egress edge with route appended", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [new ForwardingCapability()] });
    const c = new SimComponent({ id: "c" as ComponentId, capabilities: [] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    const ba = new SimConnection({
      id: "ba" as ConnectionId,
      from: { componentId: b.id, portId: "out" as PortId },
      to: { componentId: a.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ab" as ConnectionId, direction: "back",
    });
    const bc = new SimConnection({
      id: "bc" as ConnectionId,
      from: { componentId: b.id, portId: "out" as PortId },
      to: { componentId: c.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "cb" as ConnectionId, direction: "forward",
    });
    const cb = new SimConnection({
      id: "cb" as ConnectionId,
      from: { componentId: c.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "bc" as ConnectionId, direction: "back",
    });
    sim.addComponent(a); sim.addComponent(b); sim.addComponent(c);
    sim.addConnection(ab); sim.addConnection(ba); sim.addConnection(bc); sim.addConnection(cb);
    sim.spawnPacket(makePacket({ requests: [mkReq()], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    const p = sim.activePackets[0]!;
    expect(p.edgeId).toBe(bc.id);
    expect(p.route).toEqual([ab.id]);
  });

  it("drops on missing egress edge", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [new ForwardingCapability()] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(b);
    sim.addConnection(ab);
    sim.spawnPacket(makePacket({ requests: [mkReq()], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((ev) => ev.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "no_egress", count: 1 });
  });
});

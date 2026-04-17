import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { ProcessingCapability } from "@sim/capabilities/processing";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(isWrite: boolean): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite,
    requiresAuth: false,
    isLarge: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("ProcessingCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function bootWithResponse(capacityPerSecond: number) {
    const sim = new Sim({ seed: 1 });
    const cap = new ProcessingCapability({ revenuePerWrite: 3, revenuePerRead: 2 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [cap], capacityPerSecond });
    const ef = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eb" as ConnectionId, direction: "forward",
    });
    const eb = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: b.id, portId: "out" as PortId },
      to: { componentId: a.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ef" as ConnectionId, direction: "back",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(ef);
    sim.addConnection(eb);
    return { sim, ef, eb, a, b };
  }

  it("terminates a write-only packet with revenuePerWrite × count", () => {
    const { sim, ef } = bootWithResponse(100);
    const pkt = makePacket({
      requests: [mkReq(true), mkReq(true), mkReq(true)],
      edgeId: ef.id,
      speed: ef.speed,
      spawnedAt: 0,
      direction: "forward",
      route: [],
    });
    sim.spawnPacket(pkt);
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((ev) => ev.kind === "terminate");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: "terminate", revenue: 9 });
  });

  it("responds to a read-only packet with revenuePerRead × count", () => {
    const { sim, ef, a } = bootWithResponse(100);
    const pkt = makePacket({
      requests: [mkReq(false), mkReq(false)],
      edgeId: ef.id,
      speed: ef.speed,
      spawnedAt: 0,
      direction: "forward",
      route: [],
    });
    sim.spawnPacket(pkt);
    sim.step(1 / 60); // request arrives, response born
    sim.step(1 / 60); // response arrives at a
    const delivered = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: "respond-delivered", componentId: a.id, revenue: 4 });
  });

  it("drops when bucket has insufficient credits", () => {
    const { sim, ef } = bootWithResponse(2); // capacity 2/sec
    // At step 1 (dt=1/60): bucket starts at 2. 3 writes want 3 credits → drop.
    const pkt = makePacket({
      requests: [mkReq(true), mkReq(true), mkReq(true)],
      edgeId: ef.id,
      speed: ef.speed,
      spawnedAt: 0,
      direction: "forward",
      route: [],
    });
    sim.spawnPacket(pkt);
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((ev) => ev.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "overloaded", count: 3 });
  });

  it("rejects mixed-write/read packets to keep Stage A semantics unambiguous", () => {
    const { sim, ef } = bootWithResponse(100);
    const pkt = makePacket({
      requests: [mkReq(true), mkReq(false)],
      edgeId: ef.id,
      speed: ef.speed,
      spawnedAt: 0,
      direction: "forward",
      route: [],
    });
    sim.spawnPacket(pkt);
    expect(() => sim.step(1 / 60)).toThrow(/mixed/i);
  });
});

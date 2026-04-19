import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { BlobStorageCapability } from "@sim/capabilities/blob-storage";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkLargeReq(isWrite: boolean): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite,
    requiresAuth: false,
    isLarge: true,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

function mkSmallReq(): Request {
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

function mkStreamReq(bandwidth: number, duration: number): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    stream: { bandwidth, duration },
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("BlobStorageCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot(capacityPerSecond: number, bandwidth = 1000) {
    const sim = new Sim({ seed: 1 });
    const cap = new BlobStorageCapability({
      revenuePerWrite: 5,
      revenuePerRead: 3,
      revenuePerStream: 11,
    });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({
      id: "b" as ComponentId,
      capabilities: [cap],
      capacityPerSecond,
    });
    const ef = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth,
      latencySeconds: 1 / 60,
      twinId: "eb" as ConnectionId,
      direction: "forward",
    });
    const eb = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: b.id, portId: "out" as PortId },
      to: { componentId: a.id, portId: "in" as PortId },
      bandwidth,
      latencySeconds: 1 / 60,
      twinId: "ef" as ConnectionId,
      direction: "back",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(ef);
    sim.addConnection(eb);
    return { sim, ef, eb, a, b };
  }

  it("terminates a large write packet with revenuePerWrite × count", () => {
    const { sim, ef } = boot(100);
    sim.spawnPacket(
      makePacket({
        requests: [mkLargeReq(true), mkLargeReq(true)],
        edgeId: ef.id,
        speed: ef.speed,
        spawnedAt: 0,
        direction: "forward",
        route: [],
      }),
    );
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((e) => e.kind === "terminate");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: "terminate", revenue: 10 });
  });

  it("responds to a large read packet with revenuePerRead × count", () => {
    const { sim, ef, a } = boot(100);
    sim.spawnPacket(
      makePacket({
        requests: [mkLargeReq(false), mkLargeReq(false), mkLargeReq(false)],
        edgeId: ef.id,
        speed: ef.speed,
        spawnedAt: 0,
        direction: "forward",
        route: [],
      }),
    );
    sim.step(1 / 60); // request arrival, response born
    sim.step(1 / 60); // response delivered at a
    const delivered = sim.lastStepEvents.filter(
      (e) => e.kind === "respond-delivered",
    );
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      kind: "respond-delivered",
      componentId: a.id,
      revenue: 9,
    });
  });

  it("terminates a stream packet with revenuePerStream × count", () => {
    const { sim, ef } = boot(100, 1000);
    sim.spawnPacket(
      makePacket({
        requests: [mkStreamReq(50, 2), mkStreamReq(50, 2)],
        edgeId: ef.id,
        speed: ef.speed,
        spawnedAt: 0,
        direction: "forward",
        route: [],
      }),
    );
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((e) => e.kind === "terminate");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: "terminate", revenue: 22 });
  });

  it("drops non-large, non-stream requests as unsupported", () => {
    const { sim, ef } = boot(100);
    sim.spawnPacket(
      makePacket({
        requests: [mkSmallReq(), mkSmallReq()],
        edgeId: ef.id,
        speed: ef.speed,
        spawnedAt: 0,
        direction: "forward",
        route: [],
      }),
    );
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((e) => e.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "unsupported", count: 2 });
  });

  it("drops when capacity bucket saturates", () => {
    const { sim, ef } = boot(2); // only 2 credits/sec
    sim.spawnPacket(
      makePacket({
        requests: [mkLargeReq(true), mkLargeReq(true), mkLargeReq(true)],
        edgeId: ef.id,
        speed: ef.speed,
        spawnedAt: 0,
        direction: "forward",
        route: [],
      }),
    );
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((e) => e.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "overloaded", count: 3 });
  });

  it("does not forward egress (terminal behavior) — a large write emits no forward event", () => {
    const { sim, ef } = boot(100);
    sim.spawnPacket(
      makePacket({
        requests: [mkLargeReq(true)],
        edgeId: ef.id,
        speed: ef.speed,
        spawnedAt: 0,
        direction: "forward",
        route: [],
      }),
    );
    sim.step(1 / 60);
    // Only terminate events should appear; no drops, no forward-onward responses (response is "back", not "forward")
    const evts = sim.lastStepEvents;
    expect(evts.some((e) => e.kind === "terminate")).toBe(true);
    expect(evts.some((e) => e.kind === "drop")).toBe(false);
  });

  it("rejects mixed stream/non-stream packets", () => {
    const { sim, ef } = boot(100);
    sim.spawnPacket(
      makePacket({
        requests: [mkLargeReq(false), mkStreamReq(10, 1)],
        edgeId: ef.id,
        speed: ef.speed,
        spawnedAt: 0,
        direction: "forward",
        route: [],
      }),
    );
    expect(() => sim.step(1 / 60)).toThrow(/mixed/i);
  });
});

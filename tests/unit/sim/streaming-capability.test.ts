import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { StreamingCapability } from "@sim/capabilities/streaming";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

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

describe("StreamingCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot(bandwidth: number) {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const ss = new SimComponent({ id: "ss" as ComponentId, capabilities: [new StreamingCapability({ revenuePerStream: 10 })] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: ss.id, portId: "p" as PortId },
      bandwidth, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(ss);
    sim.addConnection(ab);
    return { sim, ab };
  }

  it("terminates stream packet when bandwidth fits", () => {
    const { sim, ab } = boot(100);
    sim.spawnPacket(makePacket({
      requests: [mkStreamReq(30, 2)],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((e) => e.kind === "terminate");
    expect(terms).toHaveLength(1);
  });

  it("drops when bandwidth insufficient", () => {
    const { sim, ab } = boot(10);
    sim.spawnPacket(makePacket({
      requests: [mkStreamReq(100, 2)],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((e) => e.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "bandwidth_saturated" });
  });
});

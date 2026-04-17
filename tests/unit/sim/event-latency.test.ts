import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkRead(): Request {
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

describe("event latency", () => {
  beforeEach(() => resetIdCountersForTest());

  it("respond-delivered records end-to-end latency", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({
      id: "b" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 100,
    });
    const ef = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: b.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.1, twinId: "eb" as ConnectionId, direction: "forward",
    });
    const eb = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: b.id, portId: "p" as PortId },
      to: { componentId: a.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.1, twinId: "ef" as ConnectionId, direction: "back",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(ef);
    sim.addConnection(eb);
    sim.spawnPacket(makePacket({ requests: [mkRead()], edgeId: ef.id, speed: ef.speed, spawnedAt: 0, direction: "forward" }));
    let delivered: { latencySeconds: number } | undefined;
    for (let i = 0; i < 30; i += 1) {
      sim.step(1 / 60);
      for (const ev of sim.lastStepEvents) {
        if (ev.kind === "respond-delivered") delivered = { latencySeconds: ev.latencySeconds };
      }
    }
    expect(delivered).toBeDefined();
    expect(delivered!.latencySeconds).toBeGreaterThan(0.15);
    expect(delivered!.latencySeconds).toBeLessThan(0.3);
  });
});

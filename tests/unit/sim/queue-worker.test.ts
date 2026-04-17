import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { QueueCapability } from "@sim/capabilities/queue";
import { WorkerCapability } from "@sim/capabilities/worker";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkAsyncReq(): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: true,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("Queue + Worker", () => {
  beforeEach(() => resetIdCountersForTest());

  it("queue holds async packet; worker pulls and terminates over time", () => {
    const sim = new Sim({ seed: 1 });
    const queue = new QueueCapability({ capacity: 10 });
    const q = new SimComponent({ id: "q" as ComponentId, capabilities: [queue] });
    const worker = new WorkerCapability({ pullRate: 10, revenuePerItem: 2 }, queue);
    const w = new SimComponent({ id: "w" as ComponentId, capabilities: [worker] });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: q.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(q); sim.addComponent(w); sim.addConnection(ab);

    for (let i = 0; i < 5; i += 1) {
      sim.spawnPacket(makePacket({
        requests: [mkAsyncReq()],
        edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
      }));
    }
    sim.step(1 / 60);
    expect(queue.held.length).toBe(5);
    let terminates = 0;
    for (let i = 0; i < 60; i += 1) {
      sim.step(1 / 60);
      terminates += sim.lastStepEvents.filter((e) => e.kind === "terminate").length;
    }
    expect(terminates).toBeGreaterThanOrEqual(5);
    expect(queue.held.length).toBe(0);
  });
});

import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
import { ProcessingCapability } from "@sim/capabilities/processing";
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

describe("LoadBalancer wait-all merge — 2 servers", () => {
  beforeEach(() => resetIdCountersForTest());

  it("merges 2 child responses into one response-delivered at origin", () => {
    const sim = new Sim({ seed: 1 });
    const client = new SimClient({ id: "client" as ComponentId, capabilities: [], packetRate: 1 });
    const lb = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1 = new SimComponent({
      id: "s1" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 3 })],
      capacityPerSecond: 100,
    });
    const s2 = new SimComponent({
      id: "s2" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 3 })],
      capacityPerSecond: 100,
    });
    const wire = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 1 / 60, twinId: twin as ConnectionId, direction: dir,
      });
    const cl = wire("cl", client.id, lb.id, "forward", "lc");
    const lc = wire("lc", lb.id, client.id, "back", "cl");
    const l1 = wire("l1", lb.id, s1.id, "forward", "1l");
    const onel = wire("1l", s1.id, lb.id, "back", "l1");
    const l2 = wire("l2", lb.id, s2.id, "forward", "2l");
    const twol = wire("2l", s2.id, lb.id, "back", "l2");
    sim.addClient(client);
    sim.addComponent(lb);
    sim.addComponent(s1);
    sim.addComponent(s2);
    for (const e of [cl, lc, l1, onel, l2, twol]) sim.addConnection(e);

    sim.spawnPacket(makePacket({
      requests: [mkRead(), mkRead(), mkRead(), mkRead()],
      edgeId: cl.id, speed: cl.speed, spawnedAt: 0, direction: "forward",
    }));

    let totalDelivered = 0;
    let totalRevenue = 0;
    for (let i = 0; i < 10; i += 1) {
      sim.step(1 / 60);
      for (const ev of sim.lastStepEvents) {
        if (ev.kind === "respond-delivered") {
          totalDelivered += 1;
          totalRevenue += ev.revenue;
        }
      }
    }
    expect(totalDelivered).toBe(1);
    expect(totalRevenue).toBe(12);
  });
});

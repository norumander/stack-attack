import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
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

describe("LoadBalancerCapability — split", () => {
  beforeEach(() => resetIdCountersForTest());

  it("splits 8 requests across 2 egresses as 4/4", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const lb = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1 = new SimComponent({ id: "s1" as ComponentId, capabilities: [] });
    const s2 = new SimComponent({ id: "s2" as ComponentId, capabilities: [] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: lb.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    const ls1 = new SimConnection({
      id: "ls1" as ConnectionId,
      from: { componentId: lb.id, portId: "p" as PortId },
      to: { componentId: s1.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "s1l" as ConnectionId, direction: "forward",
    });
    const ls2 = new SimConnection({
      id: "ls2" as ConnectionId,
      from: { componentId: lb.id, portId: "p" as PortId },
      to: { componentId: s2.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "s2l" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(lb); sim.addComponent(s1); sim.addComponent(s2);
    sim.addConnection(ab); sim.addConnection(ls1); sim.addConnection(ls2);
    const requests = [mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq()];
    sim.spawnPacket(makePacket({ requests, edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(2);
    const onLs1 = sim.activePackets.find((p) => p.edgeId === ls1.id)!;
    const onLs2 = sim.activePackets.find((p) => p.edgeId === ls2.id)!;
    expect(onLs1.requests.length).toBe(4);
    expect(onLs2.requests.length).toBe(4);
  });

  it("distributes remainder — 7 requests across 3 egresses as 3/2/2", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const lb = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1 = new SimComponent({ id: "s1" as ComponentId, capabilities: [] });
    const s2 = new SimComponent({ id: "s2" as ComponentId, capabilities: [] });
    const s3 = new SimComponent({ id: "s3" as ComponentId, capabilities: [] });
    const mk = (id: string, from: ComponentId, to: ComponentId, twin: string): SimConnection =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 1 / 60, twinId: twin as ConnectionId, direction: "forward",
      });
    const ab = mk("ab", a.id, lb.id, "ba");
    const ls1 = mk("ls1", lb.id, s1.id, "s1l");
    const ls2 = mk("ls2", lb.id, s2.id, "s2l");
    const ls3 = mk("ls3", lb.id, s3.id, "s3l");
    sim.addComponent(a); sim.addComponent(lb); sim.addComponent(s1); sim.addComponent(s2); sim.addComponent(s3);
    for (const e of [ab, ls1, ls2, ls3]) sim.addConnection(e);
    const requests = [mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq()];
    sim.spawnPacket(makePacket({ requests, edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(3);
    const counts = sim.activePackets.map((p) => p.requests.length).sort((a, b) => b - a);
    expect(counts).toEqual([3, 2, 2]);
  });
});

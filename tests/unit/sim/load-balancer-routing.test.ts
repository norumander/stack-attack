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

function mkConn(id: string, from: ComponentId, to: ComponentId, twin: string): SimConnection {
  return new SimConnection({
    id: id as ConnectionId,
    from: { componentId: from, portId: "p" as PortId },
    to: { componentId: to, portId: "p" as PortId },
    bandwidth: 1_000_000,
    latencySeconds: 1 / 60,
    twinId: twin as ConnectionId,
    direction: "forward",
  });
}

describe("LoadBalancerCapability — routing fairness across packets", () => {
  beforeEach(() => resetIdCountersForTest());

  it("spreads 30 single-request packets fairly across 3 egresses (±2)", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const lb = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1 = new SimComponent({ id: "s1" as ComponentId, capabilities: [] });
    const s2 = new SimComponent({ id: "s2" as ComponentId, capabilities: [] });
    const s3 = new SimComponent({ id: "s3" as ComponentId, capabilities: [] });
    const ab = mkConn("ab", a.id, lb.id, "ba");
    const ls1 = mkConn("ls1", lb.id, s1.id, "s1l");
    const ls2 = mkConn("ls2", lb.id, s2.id, "s2l");
    const ls3 = mkConn("ls3", lb.id, s3.id, "s3l");
    sim.addComponent(a); sim.addComponent(lb);
    sim.addComponent(s1); sim.addComponent(s2); sim.addComponent(s3);
    for (const e of [ab, ls1, ls2, ls3]) sim.addConnection(e);

    const countPerEgress = new Map<string, number>();
    countPerEgress.set(ls1.id, 0);
    countPerEgress.set(ls2.id, 0);
    countPerEgress.set(ls3.id, 0);
    // Spawn packets one at a time, step until each reaches LB and is
    // re-dispatched, tally which egress the child(ren) ended up on, then
    // drain the new children before spawning the next packet.
    for (let i = 0; i < 30; i += 1) {
      sim.spawnPacket(makePacket({
        requests: [mkReq()],
        edgeId: ab.id,
        speed: ab.speed,
        spawnedAt: 0,
        direction: "forward",
      }));
      // Step once: advances packet on ab→lb, arrives, LB emits child on ls*
      sim.step(1 / 60);
      // Child packet(s) for this arrival now sit on ls1/ls2/ls3 with progress=0.
      for (const p of sim.activePackets) {
        if (p.progress === 0 && countPerEgress.has(p.edgeId)) {
          countPerEgress.set(p.edgeId, (countPerEgress.get(p.edgeId) ?? 0) + 1);
        }
      }
      // Drain remaining packets so the next iteration starts clean.
      for (let t = 0; t < 5; t += 1) sim.step(1 / 60);
    }
    const counts = [...countPerEgress.values()];
    // Fair share is 10 per egress; each must be within 1 of 10.
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(9);
      expect(c).toBeLessThanOrEqual(11);
    }
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30);
  });

  it("spreads 30 two-request packets fairly across 3 egresses", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const lb = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1 = new SimComponent({ id: "s1" as ComponentId, capabilities: [] });
    const s2 = new SimComponent({ id: "s2" as ComponentId, capabilities: [] });
    const s3 = new SimComponent({ id: "s3" as ComponentId, capabilities: [] });
    const ab = mkConn("ab", a.id, lb.id, "ba");
    const ls1 = mkConn("ls1", lb.id, s1.id, "s1l");
    const ls2 = mkConn("ls2", lb.id, s2.id, "s2l");
    const ls3 = mkConn("ls3", lb.id, s3.id, "s3l");
    sim.addComponent(a); sim.addComponent(lb);
    sim.addComponent(s1); sim.addComponent(s2); sim.addComponent(s3);
    for (const e of [ab, ls1, ls2, ls3]) sim.addConnection(e);

    const reqPerEgress = new Map<string, number>();
    reqPerEgress.set(ls1.id, 0);
    reqPerEgress.set(ls2.id, 0);
    reqPerEgress.set(ls3.id, 0);
    for (let i = 0; i < 30; i += 1) {
      sim.spawnPacket(makePacket({
        requests: [mkReq(), mkReq()],
        edgeId: ab.id,
        speed: ab.speed,
        spawnedAt: 0,
        direction: "forward",
      }));
      sim.step(1 / 60);
      for (const p of sim.activePackets) {
        if (p.progress === 0 && reqPerEgress.has(p.edgeId)) {
          reqPerEgress.set(p.edgeId, (reqPerEgress.get(p.edgeId) ?? 0) + p.requests.length);
        }
      }
      for (let t = 0; t < 5; t += 1) sim.step(1 / 60);
    }
    const counts = [...reqPerEgress.values()];
    // 60 requests / 3 egresses = 20 each; must be within 2.
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(18);
      expect(c).toBeLessThanOrEqual(22);
    }
    expect(counts.reduce((a, b) => a + b, 0)).toBe(60);
  });
});

import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { CachingCapability } from "@sim/capabilities/caching";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { Request, SimEvent } from "@sim/types";

function mkReq(isWrite: boolean, key: string): Request {
  return {
    id: mintRequestId(),
    key,
    isWrite,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

function buildScenario(seed: number): { sim: Sim; run: () => SimEvent[] } {
  const sim = new Sim({ seed });
  const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
  const b = new SimComponent({ id: "b" as ComponentId, capabilities: [new ForwardingCapability()] });
  const cache = new CachingCapability({ capacity: 4, revenuePerRead: 5 });
  const c = new SimComponent({ id: "c" as ComponentId, capabilities: [cache] });
  const d = new SimComponent({ id: "d" as ComponentId, capabilities: [new ProcessingCapability({ revenuePerWrite: 3, revenuePerRead: 2 })], capacityPerSecond: 100 });
  sim.addComponent(a); sim.addComponent(b); sim.addComponent(c); sim.addComponent(d);
  const wire = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
    new SimConnection({
      id: id as ConnectionId, from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: twin as ConnectionId, direction: dir,
    });
  const ab = wire("ab", a.id, b.id, "forward", "ba"); const ba = wire("ba", b.id, a.id, "back", "ab");
  const bc = wire("bc", b.id, c.id, "forward", "cb"); const cb = wire("cb", c.id, b.id, "back", "bc");
  const cd = wire("cd", c.id, d.id, "forward", "dc"); const dc = wire("dc", d.id, c.id, "back", "cd");
  for (const e of [ab, ba, bc, cb, cd, dc]) sim.addConnection(e);

  const run = (): SimEvent[] => {
    const log: SimEvent[] = [];
    sim.spawnPacket(makePacket({ requests: [mkReq(false, "k1"), mkReq(false, "k2")], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.spawnPacket(makePacket({ requests: [mkReq(true, "k3")], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    for (let i = 0; i < 20; i += 1) {
      sim.step(1 / 60);
      log.push(...sim.lastStepEvents.map((ev) => ({ ...ev })));
    }
    return log;
  };
  return { sim, run };
}

describe("determinism replay", () => {
  beforeEach(() => resetIdCountersForTest());

  it("same seed + same scenario produces identical event logs", () => {
    const run1 = (() => { resetIdCountersForTest(); return buildScenario(42).run(); })();
    const run2 = (() => { resetIdCountersForTest(); return buildScenario(42).run(); })();
    expect(run2).toEqual(run1);
  });
});

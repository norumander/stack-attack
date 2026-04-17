import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

describe("edge physics — advance", () => {
  beforeEach(() => resetIdCountersForTest());

  it("packet progress advances by speed × dt per step", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [] });
    sim.addComponent(a);
    sim.addComponent(b);
    const edge = new SimConnection({
      id: "e1" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 0.5,
      twinId: "e2" as ConnectionId,
      direction: "forward",
    });
    sim.addConnection(edge);
    const p = makePacket({
      requests: [],
      edgeId: edge.id,
      speed: edge.speed,
      spawnedAt: 0,
      direction: "forward",
    });
    sim.spawnPacket(p);
    sim.step(1 / 60);
    // speed = 2 (1/0.5), dt = 1/60 → progress ~= 0.0333
    expect(p.progress).toBeCloseTo(2 / 60, 6);
  });
});

import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

const droppingCap: SimCapability = {
  id: "dropper",
  onArriveRequest(): Outcome {
    return { kind: "drop", reason: "overloaded", count: 5 };
  },
};

describe("outcome: drop", () => {
  beforeEach(() => resetIdCountersForTest());

  it("emits a drop event at the receiving component", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [droppingCap] });
    const e = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "et" as ConnectionId,
      direction: "forward",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(e);
    const p = makePacket({ requests: [], edgeId: e.id, speed: e.speed, spawnedAt: 0, direction: "forward" });
    sim.spawnPacket(p);
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((ev) => ev.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ kind: "drop", componentId: b.id, reason: "overloaded", count: 5 });
    expect(sim.activePackets.length).toBe(0);
  });

  it("clears events at the start of each step", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [droppingCap] });
    const e = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "et" as ConnectionId,
      direction: "forward",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(e);
    sim.spawnPacket(makePacket({ requests: [], edgeId: e.id, speed: e.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.lastStepEvents.length).toBe(1);
    sim.step(1 / 60);
    expect(sim.lastStepEvents.length).toBe(0);
  });
});

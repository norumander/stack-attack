import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

const terminator: SimCapability = {
  id: "terminator",
  onArriveRequest(): Outcome {
    return { kind: "terminate", revenue: 42 };
  },
};

describe("outcome: terminate", () => {
  beforeEach(() => resetIdCountersForTest());

  it("emits a terminate event with revenue at the receiving component", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [terminator] });
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
    const terms = sim.lastStepEvents.filter((ev) => ev.kind === "terminate");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: "terminate", componentId: b.id, revenue: 42 });
  });
});

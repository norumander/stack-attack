import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function buildPair(
  sim: Sim,
  fromId: string,
  toId: string,
  edgeId: string,
  twinEdgeId: string,
): { forward: SimConnection; back: SimConnection } {
  const forward = new SimConnection({
    id: edgeId as ConnectionId,
    from: { componentId: fromId as ComponentId, portId: "out" as PortId },
    to: { componentId: toId as ComponentId, portId: "in" as PortId },
    bandwidth: 100,
    latencySeconds: 1,
    twinId: twinEdgeId as ConnectionId,
    direction: "forward",
  });
  const back = new SimConnection({
    id: twinEdgeId as ConnectionId,
    from: { componentId: toId as ComponentId, portId: "in" as PortId },
    to: { componentId: fromId as ComponentId, portId: "out" as PortId },
    bandwidth: 100,
    latencySeconds: 1,
    twinId: edgeId as ConnectionId,
    direction: "back",
  });
  sim.addConnection(forward);
  sim.addConnection(back);
  return { forward, back };
}

describe("sim chaos primitives", () => {
  beforeEach(() => resetIdCountersForTest());

  it("crashComponent drops in-flight packets targeting the crashed component", () => {
    const sim = new Sim({ seed: 1 });
    sim.addComponent(new SimComponent({ id: "a" as ComponentId, capabilities: [] }));
    sim.addComponent(new SimComponent({ id: "b" as ComponentId, capabilities: [] }));
    const { forward } = buildPair(sim, "a", "b", "e1", "e1t");

    const p = makePacket({ requests: [], edgeId: forward.id, speed: 1, spawnedAt: 0, direction: "forward" });
    sim.spawnPacket(p);
    expect(sim.activePackets.length).toBe(1);

    sim.crashComponent("b" as ComponentId);

    expect(sim.activePackets.length).toBe(0);
    expect(sim.crashedComponents.has("b" as ComponentId)).toBe(true);
    const crashEvt = sim.lastStepEvents.find((e) => e.kind === "component-crashed");
    expect(crashEvt).toBeDefined();
    if (crashEvt && crashEvt.kind === "component-crashed") {
      expect(crashEvt.flushedPackets).toBe(1);
    }
  });

  it("crashComponent drops subsequent arrivals with reason=component_crashed", () => {
    const sim = new Sim({ seed: 1 });
    sim.addComponent(new SimComponent({ id: "a" as ComponentId, capabilities: [] }));
    sim.addComponent(new SimComponent({ id: "b" as ComponentId, capabilities: [] }));
    const { forward } = buildPair(sim, "a", "b", "e1", "e1t");

    sim.crashComponent("b" as ComponentId);
    // Spawn a packet already at the destination edge with progress so it arrives next step.
    const p = makePacket({ requests: [], edgeId: forward.id, speed: 10, spawnedAt: 0, direction: "forward" });
    sim.spawnPacket(p);
    sim.step(1); // progress → 10, arrival dispatched

    const drop = sim.lastStepEvents.find((e) => e.kind === "drop" && e.reason === "component_crashed");
    expect(drop).toBeDefined();
  });

  it("crashComponent is idempotent", () => {
    const sim = new Sim({ seed: 1 });
    sim.addComponent(new SimComponent({ id: "a" as ComponentId, capabilities: [] }));
    sim.crashComponent("a" as ComponentId);
    const eventsAfterFirst = sim.lastStepEvents.length;
    sim.crashComponent("a" as ComponentId);
    expect(sim.lastStepEvents.length).toBe(eventsAfterFirst); // no duplicate event
  });

  it("severConnection removes both forward and back edges and flushes in-flight", () => {
    const sim = new Sim({ seed: 1 });
    sim.addComponent(new SimComponent({ id: "a" as ComponentId, capabilities: [] }));
    sim.addComponent(new SimComponent({ id: "b" as ComponentId, capabilities: [] }));
    const { forward, back } = buildPair(sim, "a", "b", "e1", "e1t");

    sim.spawnPacket(makePacket({ requests: [], edgeId: forward.id, speed: 1, spawnedAt: 0, direction: "forward" }));
    sim.spawnPacket(makePacket({ requests: [], edgeId: back.id, speed: 1, spawnedAt: 0, direction: "back" }));
    expect(sim.activePackets.length).toBe(2);

    sim.severConnection(forward.id);

    expect(sim.connections.has(forward.id)).toBe(false);
    expect(sim.connections.has(back.id)).toBe(false);
    expect(sim.activePackets.length).toBe(0);
    const sev = sim.lastStepEvents.find((e) => e.kind === "connection-severed");
    expect(sev).toBeDefined();
    if (sev && sev.kind === "connection-severed") {
      expect(sev.flushedPackets).toBe(2);
    }
  });

  it("severConnection is idempotent", () => {
    const sim = new Sim({ seed: 1 });
    sim.addComponent(new SimComponent({ id: "a" as ComponentId, capabilities: [] }));
    sim.addComponent(new SimComponent({ id: "b" as ComponentId, capabilities: [] }));
    const { forward } = buildPair(sim, "a", "b", "e1", "e1t");

    sim.severConnection(forward.id);
    const len1 = sim.lastStepEvents.length;
    sim.severConnection(forward.id); // already gone
    expect(sim.lastStepEvents.length).toBe(len1);
  });
});

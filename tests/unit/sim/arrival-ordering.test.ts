import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, ArrivalContext, Packet, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function recorder(): { calls: string[]; cap: SimCapability } {
  const calls: string[] = [];
  const cap: SimCapability = {
    id: "recorder",
    onArriveRequest(p: Packet, _ctx: ArrivalContext): Outcome {
      calls.push(p.id);
      return { kind: "drop", reason: "test-drop", count: 0 };
    },
  };
  return { calls, cap };
}

describe("arrival firing", () => {
  beforeEach(() => resetIdCountersForTest());

  it("dispatches arrivals in monotonic packet-id order", () => {
    const sim = new Sim({ seed: 1 });
    const { calls, cap } = recorder();
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [cap] });
    sim.addComponent(a);
    sim.addComponent(b);
    const edge = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60, // arrives in one step
      twinId: "e-twin" as ConnectionId,
      direction: "forward",
    });
    sim.addConnection(edge);
    const p1 = makePacket({ requests: [], edgeId: edge.id, speed: edge.speed, spawnedAt: 0, direction: "forward" });
    const p2 = makePacket({ requests: [], edgeId: edge.id, speed: edge.speed, spawnedAt: 0, direction: "forward" });
    const p3 = makePacket({ requests: [], edgeId: edge.id, speed: edge.speed, spawnedAt: 0, direction: "forward" });
    // Insert out of order to prove we sort.
    sim.spawnPacket(p3);
    sim.spawnPacket(p1);
    sim.spawnPacket(p2);
    sim.step(1 / 60);
    expect(calls).toEqual([p1.id, p2.id, p3.id]);
  });

  it("packets that arrive retire from activePackets", () => {
    const sim = new Sim({ seed: 1 });
    const { cap } = recorder();
    sim.addComponent(new SimComponent({ id: "a" as ComponentId, capabilities: [] }));
    sim.addComponent(new SimComponent({ id: "b" as ComponentId, capabilities: [cap] }));
    const edge = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: "a" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "et" as ConnectionId,
      direction: "forward",
    });
    sim.addConnection(edge);
    const p = makePacket({ requests: [], edgeId: edge.id, speed: edge.speed, spawnedAt: 0, direction: "forward" });
    sim.spawnPacket(p);
    expect(sim.activePackets.length).toBe(1);
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(0);
  });
});

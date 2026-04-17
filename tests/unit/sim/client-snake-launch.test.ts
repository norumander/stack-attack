import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

describe("client snake launch", () => {
  beforeEach(() => resetIdCountersForTest());

  it("launches snake.head onto the only forward egress at the configured cadence", () => {
    const sim = new Sim({ seed: 1 });
    const client = new SimClient({ id: "c" as ComponentId, capabilities: [], packetRate: 5 });
    const server = new SimComponent({ id: "s" as ComponentId, capabilities: [] });
    const e = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: client.id, portId: "out" as PortId },
      to: { componentId: server.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 0.5, twinId: "et" as ConnectionId, direction: "forward",
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addConnection(e);
    const p1 = makePacket({ requests: [], edgeId: "" as ConnectionId, speed: 0, spawnedAt: 0, direction: "forward" });
    const p2 = makePacket({ requests: [], edgeId: "" as ConnectionId, speed: 0, spawnedAt: 0, direction: "forward" });
    client.snake.push(p1, p2);

    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(e.id);
    expect(sim.activePackets[0]!.speed).toBeCloseTo(2, 6);
    expect(client.snake.length).toBe(1);

    for (let i = 0; i < 12; i += 1) sim.step(1 / 60);
    expect(client.snake.length).toBe(0);
  });

  it("launches randomly when there are multiple forward egresses", () => {
    const sim = new Sim({ seed: 1 });
    const client = new SimClient({ id: "c" as ComponentId, capabilities: [], packetRate: 60 });
    const sA = new SimComponent({ id: "sa" as ComponentId, capabilities: [] });
    const sB = new SimComponent({ id: "sb" as ComponentId, capabilities: [] });
    const eA = new SimConnection({
      id: "eA" as ConnectionId,
      from: { componentId: client.id, portId: "out" as PortId },
      to: { componentId: sA.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1, twinId: "eAt" as ConnectionId, direction: "forward",
    });
    const eB = new SimConnection({
      id: "eB" as ConnectionId,
      from: { componentId: client.id, portId: "out" as PortId },
      to: { componentId: sB.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1, twinId: "eBt" as ConnectionId, direction: "forward",
    });
    sim.addClient(client);
    sim.addComponent(sA);
    sim.addComponent(sB);
    sim.addConnection(eA);
    sim.addConnection(eB);
    let aCount = 0;
    let bCount = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const p = makePacket({ requests: [], edgeId: "" as ConnectionId, speed: 0, spawnedAt: 0, direction: "forward" });
      client.snake.push(p);
    }
    for (let i = 0; i < 200; i += 1) {
      sim.step(1 / 60);
      for (const p of sim.activePackets) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        if (p.edgeId === eA.id) aCount += 1;
        if (p.edgeId === eB.id) bCount += 1;
      }
    }
    expect(aCount).toBeGreaterThan(50);
    expect(bCount).toBeGreaterThan(50);
  });
});

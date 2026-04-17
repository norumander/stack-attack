import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { ProcessingCapability } from "@sim/capabilities/processing";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 100 },
  entryClients: ["client" as ComponentId],
};

describe("Wave 1 end-to-end — Client → Server", () => {
  beforeEach(() => resetIdCountersForTest());

  it("delivers responses for the majority of generated reads with no drops", () => {
    const sim = new Sim({ seed: 7 });
    const ts = new TrafficSource(wave, makeSimRng(7));
    const client = new SimClient({
      id: "client" as ComponentId,
      capabilities: [],
      packetRate: 5,
      trafficSource: ts,
      waveStartTime: 0,
      waveEndTime: wave.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 50,
    });
    const ef = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: client.id, portId: "out" as PortId },
      to: { componentId: server.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "eb" as ConnectionId, direction: "forward",
    });
    const eb = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: server.id, portId: "out" as PortId },
      to: { componentId: client.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "ef" as ConnectionId, direction: "back",
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addConnection(ef);
    sim.addConnection(eb);

    let drops = 0;
    let respondedReads = 0;
    let revenueTotal = 0;
    const totalSteps = Math.ceil((wave.duration + 2) * 60);
    for (let i = 0; i < totalSteps; i += 1) {
      sim.step(1 / 60);
      for (const ev of sim.lastStepEvents) {
        if (ev.kind === "drop") drops += ev.count;
        if (ev.kind === "respond-delivered") {
          respondedReads += 1;
          revenueTotal += ev.revenue;
        }
      }
    }

    expect(drops).toBe(0);
    expect(respondedReads).toBeGreaterThanOrEqual(20);
    expect(revenueTotal).toBeGreaterThan(0);
  });
});

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
import type { SimEvent } from "@sim/types";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 3,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 50 },
  revenue: { perRead: 1, perWrite: 1, perAuth: 1, perStream: 1 },
  entryClients: ["client" as ComponentId],
};

function buildAndRun(seed: number): SimEvent[] {
  resetIdCountersForTest();
  const sim = new Sim({ seed });
  const ts = new TrafficSource(wave, makeSimRng(seed));
  const client = new SimClient({
    id: "client" as ComponentId,
    capabilities: [],
    packetRate: wave.packetRate,
    trafficSource: ts,
    waveStartTime: 0,
    waveEndTime: wave.duration,
  });
  const server = new SimComponent({
    id: "server" as ComponentId,
    capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
    capacityPerSecond: 100,
  });
  sim.addClient(client);
  sim.addComponent(server);
  sim.addConnection(new SimConnection({
    id: "ef" as ConnectionId,
    from: { componentId: client.id, portId: "p" as PortId },
    to: { componentId: server.id, portId: "p" as PortId },
    bandwidth: 100, latencySeconds: 0.1, twinId: "eb" as ConnectionId, direction: "forward",
  }));
  sim.addConnection(new SimConnection({
    id: "eb" as ConnectionId,
    from: { componentId: server.id, portId: "p" as PortId },
    to: { componentId: client.id, portId: "p" as PortId },
    bandwidth: 100, latencySeconds: 0.1, twinId: "ef" as ConnectionId, direction: "back",
  }));
  const log: SimEvent[] = [];
  const totalSteps = Math.ceil((wave.duration + 1) * 60);
  for (let i = 0; i < totalSteps; i += 1) {
    sim.step(1 / 60);
    log.push(...sim.lastStepEvents.map((ev) => ({ ...ev })));
  }
  return log;
}

describe("Wave 1 replay determinism", () => {
  beforeEach(() => resetIdCountersForTest());

  it("two runs with the same seed produce identical event streams", () => {
    const a = buildAndRun(99);
    const b = buildAndRun(99);
    expect(b).toEqual(a);
  });
});

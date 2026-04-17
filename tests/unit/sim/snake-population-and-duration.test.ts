import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 1,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 10 },
  entryClients: ["c" as ComponentId],
};

describe("snake population + duration", () => {
  beforeEach(() => resetIdCountersForTest());

  it("populates snake from TrafficSource at packetRate cadence and stops after waveEndTime", () => {
    const sim = new Sim({ seed: 1 });
    const ts = new TrafficSource(wave, makeSimRng(1));
    const client = new SimClient({
      id: "c" as ComponentId,
      capabilities: [],
      packetRate: 5,
      trafficSource: ts,
      waveStartTime: 0,
      waveEndTime: 1,
    });
    const sink = new SimComponent({ id: "s" as ComponentId, capabilities: [] });
    sim.addClient(client);
    sim.addComponent(sink);
    sim.addConnection(new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: client.id, portId: "p" as PortId },
      to: { componentId: sink.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 10, twinId: "et" as ConnectionId, direction: "forward",
    }));
    let totalLaunched = 0;
    const seenIds = new Set<string>();
    for (let i = 0; i < 120; i += 1) {
      sim.step(1 / 60);
      for (const p of sim.activePackets) {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          totalLaunched += 1;
        }
      }
    }
    expect(totalLaunched).toBeGreaterThanOrEqual(4);
    expect(totalLaunched).toBeLessThanOrEqual(7);
  });
});

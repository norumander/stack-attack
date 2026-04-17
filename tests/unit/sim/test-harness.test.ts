import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 3,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 50 },
  revenue: { perRead: 1, perWrite: 1, perAuth: 1, perStream: 1 },
  entryClients: ["client" as ComponentId],
};

describe("runWave + evaluateSLA", () => {
  beforeEach(() => resetIdCountersForTest());

  it("reports availability, latency, and drops from a simple topology", () => {
    const sim = new Sim({ seed: 1 });
    const ts = new TrafficSource(wave, makeSimRng(1));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: wave.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: wave.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: wave.revenue.perRead })],
      capacityPerSecond: 100,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addConnection(new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: client.id, portId: "p" as PortId },
      to: { componentId: server.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "eb" as ConnectionId, direction: "forward",
    }));
    sim.addConnection(new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: server.id, portId: "p" as PortId },
      to: { componentId: client.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "ef" as ConnectionId, direction: "back",
    }));
    const metrics = runWave(sim, { durationSeconds: wave.duration, drainSeconds: 2 });
    expect(metrics.responded).toBeGreaterThanOrEqual(10);
    expect(metrics.drops).toBe(0);
    expect(metrics.avgLatencySeconds).toBeGreaterThan(0);
    const sla = evaluateSLA(metrics, { availability: 0.95, maxAvgLatencySeconds: 1, maxDropRate: 0.05 });
    expect(sla.passed).toBe(true);
  });
});

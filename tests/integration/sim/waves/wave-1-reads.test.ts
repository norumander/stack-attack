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

const WAVE_1: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 50 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.95, maxAvgLatencySeconds: 1, maxDropRate: 0.05 };

describe("Wave 1 — Client → Server", () => {
  beforeEach(() => resetIdCountersForTest());

  it("lone server handles 10 req/sec comfortably", () => {
    const sim = new Sim({ seed: 42 });
    const ts = new TrafficSource(WAVE_1, makeSimRng(42));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_1.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_1.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 50,
    });
    sim.addClient(client);
    sim.addComponent(server);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId, from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("ef", client.id, server.id, "forward", "eb"));
    sim.addConnection(mk("eb", server.id, client.id, "back", "ef"));
    const metrics = runWave(sim, { durationSeconds: WAVE_1.duration, drainSeconds: 2 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.drops).toBe(0);
    expect(metrics.totalRevenue).toBeGreaterThan(40);
  });
});

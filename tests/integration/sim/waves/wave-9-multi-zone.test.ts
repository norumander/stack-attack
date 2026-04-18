import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { GeoRoutingCapability } from "@sim/capabilities/geo-routing";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const WAVE_9: WaveDef = {
  intensity: 60,
  packetRate: 6,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  zoneDistribution: new Map<string, number>([["NA", 0.5], ["EU", 0.3], ["AP", 0.2]]),
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.9, maxAvgLatencySeconds: 1, maxDropRate: 0.1 };

describe("Wave 9 — multi-zone GeoRouting", () => {
  beforeEach(() => resetIdCountersForTest());

  it("DNS routes packets to their origin-zone stack; each zone serves locally", () => {
    const sim = new Sim({ seed: 53 });
    const ts = new TrafficSource(WAVE_9, makeSimRng(53));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_9.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_9.duration,
    });
    const dns = new SimComponent({
      id: "dns" as ComponentId,
      capabilities: [new GeoRoutingCapability()],
    });
    sim.addClient(client);
    sim.addComponent(dns);
    sim.addConnection(new SimConnection({
      id: "cd" as ConnectionId,
      from: { componentId: client.id, portId: "p" as PortId },
      to: { componentId: dns.id, portId: "p" as PortId },
      bandwidth: 500, latencySeconds: 0.05, twinId: "dc" as ConnectionId, direction: "forward",
    }));
    sim.addConnection(new SimConnection({
      id: "dc" as ConnectionId,
      from: { componentId: dns.id, portId: "p" as PortId },
      to: { componentId: client.id, portId: "p" as PortId },
      bandwidth: 500, latencySeconds: 0.05, twinId: "cd" as ConnectionId, direction: "back",
    }));
    const zones = ["NA", "EU", "AP"] as const;
    for (const zone of zones) {
      const server = new SimComponent({
        id: `server-${zone}` as ComponentId,
        capabilities: [new ForwardingCapability()],
        zone,
      });
      const cache = new SimComponent({
        id: `cache-${zone}` as ComponentId,
        capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_9.revenue.perRead })],
        zone,
      });
      const db = new SimComponent({
        id: `db-${zone}` as ComponentId,
        capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: WAVE_9.revenue.perRead })],
        capacityPerSecond: 30,
        zone,
      });
      sim.addComponent(server);
      sim.addComponent(cache);
      sim.addComponent(db);
      const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string, latency = 0.05) =>
        new SimConnection({
          id: id as ConnectionId,
          from: { componentId: from, portId: "p" as PortId },
          to: { componentId: to, portId: "p" as PortId },
          bandwidth: 500, latencySeconds: latency, twinId: twin as ConnectionId, direction: dir,
        });
      // DNS ↔ zone server (cross-zone latency = 0.2s; longer than intra-zone)
      sim.addConnection(mk(`d-${zone}`, dns.id, server.id, "forward", `${zone}-d`, 0.2));
      sim.addConnection(mk(`${zone}-d`, server.id, dns.id, "back", `d-${zone}`, 0.2));
      // server ↔ cache
      sim.addConnection(mk(`${zone}-sk`, server.id, cache.id, "forward", `${zone}-ks`));
      sim.addConnection(mk(`${zone}-ks`, cache.id, server.id, "back", `${zone}-sk`));
      // cache ↔ db
      sim.addConnection(mk(`${zone}-kd`, cache.id, db.id, "forward", `${zone}-dk`));
      sim.addConnection(mk(`${zone}-dk`, db.id, cache.id, "back", `${zone}-kd`));
    }
    const metrics = runWave(sim, { durationSeconds: WAVE_9.duration, drainSeconds: 3 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.responded).toBeGreaterThan(0);
  });
});

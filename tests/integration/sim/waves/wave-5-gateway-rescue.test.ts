import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { GatewayCapability } from "@sim/capabilities/gateway";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const WAVE_5: WaveDef = {
  intensity: 150,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0.2, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 2, perStream: 0, perAsync: 1 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.85, maxAvgLatencySeconds: 1, maxDropRate: 0.15 };

describe("Wave 5 — Gateway + LB + 2 servers", () => {
  beforeEach(() => resetIdCountersForTest());

  it("gateway terminates auth, LB fans out reads across 2 servers backed by cache", () => {
    const sim = new Sim({ seed: 17 });
    const ts = new TrafficSource(WAVE_5, makeSimRng(17));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_5.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_5.duration,
    });
    const gateway = new SimComponent({
      id: "gw" as ComponentId,
      capabilities: [new GatewayCapability({ revenuePerAuth: WAVE_5.revenue.perAuth })],
    });
    const lb = new SimComponent({
      id: "lb" as ComponentId,
      capabilities: [new LoadBalancerCapability()],
    });
    const server1 = new SimComponent({
      id: "server1" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const server2 = new SimComponent({
      id: "server2" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_5.revenue.perRead })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: WAVE_5.revenue.perRead })],
      capacityPerSecond: 50,
    });
    sim.addClient(client);
    sim.addComponent(gateway);
    sim.addComponent(lb);
    sim.addComponent(server1);
    sim.addComponent(server2);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 500, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cg", client.id, gateway.id, "forward", "gc"));
    sim.addConnection(mk("gc", gateway.id, client.id, "back", "cg"));
    sim.addConnection(mk("gl", gateway.id, lb.id, "forward", "lg"));
    sim.addConnection(mk("lg", lb.id, gateway.id, "back", "gl"));
    sim.addConnection(mk("l1", lb.id, server1.id, "forward", "1l"));
    sim.addConnection(mk("1l", server1.id, lb.id, "back", "l1"));
    sim.addConnection(mk("l2", lb.id, server2.id, "forward", "2l"));
    sim.addConnection(mk("2l", server2.id, lb.id, "back", "l2"));
    sim.addConnection(mk("1k", server1.id, cache.id, "forward", "k1"));
    sim.addConnection(mk("k1", cache.id, server1.id, "back", "1k"));
    sim.addConnection(mk("2k", server2.id, cache.id, "forward", "k2"));
    sim.addConnection(mk("k2", cache.id, server2.id, "back", "2k"));
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_5.duration, drainSeconds: 3 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.terminated).toBeGreaterThan(0);
    expect(metrics.responded).toBeGreaterThan(0);
  });
});

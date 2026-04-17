import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

export type DemoTopology = {
  sim: Sim;
  positions: Map<ComponentId, { x: number; y: number }>;
};

const WAVE_3: WaveDef = {
  intensity: 50,
  packetRate: 10,
  duration: 60,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

export function buildWave3CacheRescue(seed: number): DemoTopology {
  const sim = new Sim({ seed });
  const ts = new TrafficSource(WAVE_3, makeSimRng(seed));
  const client = new SimClient({
    id: "client" as ComponentId,
    capabilities: [],
    packetRate: WAVE_3.packetRate,
    trafficSource: ts,
    waveStartTime: 0,
    waveEndTime: WAVE_3.duration,
  });
  const server = new SimComponent({ id: "server" as ComponentId, capabilities: [new ForwardingCapability()] });
  const cache = new SimComponent({
    id: "cache" as ComponentId,
    capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: 1 })],
  });
  const db = new SimComponent({
    id: "db" as ComponentId,
    capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
    capacityPerSecond: 30,
  });
  sim.addClient(client);
  sim.addComponent(server);
  sim.addComponent(cache);
  sim.addComponent(db);

  const wire = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
    new SimConnection({
      id: id as ConnectionId,
      from: { componentId: from, portId: "p" as PortId },
      to: { componentId: to, portId: "p" as PortId },
      bandwidth: 300, latencySeconds: 0.5, twinId: twin as ConnectionId, direction: dir,
    });
  sim.addConnection(wire("cs", client.id, server.id, "forward", "sc"));
  sim.addConnection(wire("sc", server.id, client.id, "back", "cs"));
  sim.addConnection(wire("sk", server.id, cache.id, "forward", "ks"));
  sim.addConnection(wire("ks", cache.id, server.id, "back", "sk"));
  sim.addConnection(wire("kd", cache.id, db.id, "forward", "dk"));
  sim.addConnection(wire("dk", db.id, cache.id, "back", "kd"));

  const positions = new Map<ComponentId, { x: number; y: number }>([
    [client.id, { x: 0, y: 0 }],
    [server.id, { x: 3, y: 0 }],
    [cache.id, { x: 6, y: 0 }],
    [db.id, { x: 9, y: 0 }],
  ]);

  return { sim, positions };
}

import { SimulationState } from "@core/state/simulation-state";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { Engine } from "@core/engine/engine";
import { bootstrapRegistries } from "@core/registry/register-all";
import { makeConnection } from "@harness/fixtures";
import type { Component } from "@core/component/component";
import type { ComponentId } from "@core/types/ids";

export interface TopologyInfo {
  state: SimulationState;
  controller: SandboxModeController;
  engine: Engine;
  entryPointId: ComponentId;
  components: { id: ComponentId; name: string; type: string }[];
  connections: { id: string; from: string; to: string }[];
}

const { components: registry } = bootstrapRegistries();

function wire(
  state: SimulationState,
  connId: string,
  from: Component,
  to: Component,
  opts: { bandwidth?: number; latency?: number } = {},
): { id: string; from: string; to: string } {
  const egressPort = from.ports.find((p) => p.direction === "egress")!;
  const ingressPort = to.ports.find((p) => p.direction === "ingress")!;
  const conn = makeConnection(
    connId,
    { componentId: from.id as string, portId: egressPort.id as string },
    { componentId: to.id as string, portId: ingressPort.id as string },
    opts,
  );
  egressPort.connections.push(conn.id);
  ingressPort.connections.push(conn.id);
  state.addConnection(conn);
  return { id: connId, from: from.name, to: to.name };
}

function compInfo(c: Component): { id: ComponentId; name: string; type: string } {
  return { id: c.id, name: c.name, type: c.type };
}

/**
 * Server only — simplest topology. Traffic enters at the Server directly.
 * Shows: throughput limits, upkeep costs, condition degradation under load.
 */
export function createSimpleTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const server = registry.create("server", { x: 0, y: 0 }, "default");
  state.placeComponent(server);

  return {
    state, controller, engine: new Engine(state),
    entryPointId: server.id,
    components: [compInfo(server)],
    connections: [],
  };
}

/**
 * Cache → Server. Traffic enters at Cache.
 * Shows: cache hits intercept reads before they reach the server,
 * cache misses fall through. Hit rate depends on key space vs capacity.
 */
export function createCacheTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const cache = registry.create("cache", { x: 0, y: 0 }, "default");
  const server = registry.create("server", { x: 1, y: 0 }, "default");

  state.placeComponent(cache);
  state.placeComponent(server);

  const conns = [wire(state, "cx-cs", cache, server, { latency: 2 })];

  return {
    state, controller, engine: new Engine(state),
    entryPointId: cache.id,
    components: [compInfo(cache), compInfo(server)],
    connections: conns,
  };
}

/**
 * Load Balancer → Server×2. Traffic enters at LB.
 * Shows: round-robin distribution (T1), least-load (T2), condition-aware (T3).
 * Kill one server to see routing adapt.
 */
export function createLoadBalancedTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const lb = registry.create("load_balancer", { x: 0, y: 0 }, "default");
  const server1 = registry.create("server", { x: 1, y: -1 }, "default");
  const server2 = registry.create("server", { x: 1, y: 1 }, "default");

  state.placeComponent(lb);
  state.placeComponent(server1);
  state.placeComponent(server2);

  const conns = [
    wire(state, "cx-lb-s1", lb, server1),
    wire(state, "cx-lb-s2", lb, server2),
  ];

  return {
    state, controller, engine: new Engine(state),
    entryPointId: lb.id,
    components: [compInfo(lb), compInfo(server1), compInfo(server2)],
    connections: conns,
  };
}

/**
 * Cache → Server → Database. Traffic enters at Cache.
 * Shows: caching reduces server load, server forwards writes to DB,
 * DB has lower throughput than server (bottleneck).
 */
export function createFullStackTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const cache = registry.create("cache", { x: 0, y: 0 }, "default");
  const server = registry.create("server", { x: 1, y: 0 }, "default");
  const db = registry.create("database", { x: 2, y: 0 }, "default");

  state.placeComponent(cache);
  state.placeComponent(server);
  state.placeComponent(db);

  const conns = [
    wire(state, "cx-cs", cache, server, { latency: 1 }),
    wire(state, "cx-sd", server, db, { latency: 3 }),
  ];

  return {
    state, controller, engine: new Engine(state),
    entryPointId: cache.id,
    components: [compInfo(cache), compInfo(server), compInfo(db)],
    connections: conns,
  };
}

/**
 * API Gateway → Server with rate limiting + auth.
 * Shows: rate limiting drops excess traffic, auth handles auth_required efficiently.
 */
export function createApiGatewayTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const gw = registry.create("api_gateway", { x: 0, y: 0 }, "default");
  const server = registry.create("server", { x: 1, y: 0 }, "default");

  state.placeComponent(gw);
  state.placeComponent(server);

  const conns = [wire(state, "cx-gs", gw, server)];

  return {
    state, controller, engine: new Engine(state),
    entryPointId: gw.id,
    components: [compInfo(gw), compInfo(server)],
    connections: conns,
  };
}

export const TOPOLOGIES: Record<string, () => TopologyInfo> = {
  "Server Only": createSimpleTopology,
  "Cache → Server": createCacheTopology,
  "Load Balanced → Server×2": createLoadBalancedTopology,
  "Cache → Server → Database": createFullStackTopology,
  "API Gateway → Server": createApiGatewayTopology,
};

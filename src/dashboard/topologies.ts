import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { Engine } from "@core/engine/engine";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

export interface TopologyInfo {
  state: SimulationState;
  controller: SandboxModeController;
  engine: Engine;
  entryPointId: ComponentId;
  components: { id: ComponentId; name: string; type: string }[];
  connections: { id: string; from: string; to: string }[];
}

function fwdCap(id: string): Map<CapabilityId, Capability> {
  return new Map([[id as CapabilityId, new ProcessingCapability(id as CapabilityId, { outcomeKind: "FORWARD" })]]);
}

function fwdTier(id: string): Map<CapabilityId, number> {
  return new Map([[id as CapabilityId, 1]]);
}

function respCap(id: string): Map<CapabilityId, Capability> {
  return new Map([[id as CapabilityId, new ProcessingCapability(id as CapabilityId, { outcomeKind: "RESPOND" })]]);
}

function respTier(id: string): Map<CapabilityId, number> {
  return new Map([[id as CapabilityId, 1]]);
}

export function createSimpleTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const clientEgress = makePort("p-c-out", "egress");
  const client = makeComponent({ id: "client", type: "client", ports: [clientEgress], capabilities: fwdCap("cap-fwd"), tiers: fwdTier("cap-fwd") });

  const serverIngress = makePort("p-s-in", "ingress");
  const server = makeComponent({ id: "server", type: "server", ports: [serverIngress], capabilities: respCap("cap-resp"), tiers: respTier("cap-resp") });

  state.placeComponent(client);
  state.placeComponent(server);

  const conn = makeConnection("cx-cs", { componentId: "client", portId: "p-c-out" }, { componentId: "server", portId: "p-s-in" });
  clientEgress.connections.push(conn.id);
  serverIngress.connections.push(conn.id);
  state.addConnection(conn);

  const engine = new Engine(state);

  return {
    state, controller, engine,
    entryPointId: "client" as ComponentId,
    components: [
      { id: "client" as ComponentId, name: "Client", type: "client" },
      { id: "server" as ComponentId, name: "Server", type: "server" },
    ],
    connections: [{ id: "cx-cs", from: "Client", to: "Server" }],
  };
}

export function createCacheTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const clientEgress = makePort("p-c-out", "egress");
  const client = makeComponent({ id: "client", type: "client", ports: [clientEgress], capabilities: fwdCap("cap-fwd-c"), tiers: fwdTier("cap-fwd-c") });

  const cacheIngress = makePort("p-cache-in", "ingress");
  const cacheEgress = makePort("p-cache-out", "egress");
  const cache = makeComponent({ id: "cache", type: "cache", ports: [cacheIngress, cacheEgress], capabilities: fwdCap("cap-fwd-cache"), tiers: fwdTier("cap-fwd-cache") });

  const serverIngress = makePort("p-s-in", "ingress");
  const server = makeComponent({ id: "server", type: "server", ports: [serverIngress], capabilities: respCap("cap-resp"), tiers: respTier("cap-resp") });

  state.placeComponent(client);
  state.placeComponent(cache);
  state.placeComponent(server);

  const conn1 = makeConnection("cx-cc", { componentId: "client", portId: "p-c-out" }, { componentId: "cache", portId: "p-cache-in" }, { latency: 1 });
  clientEgress.connections.push(conn1.id);
  cacheIngress.connections.push(conn1.id);
  state.addConnection(conn1);

  const conn2 = makeConnection("cx-cs", { componentId: "cache", portId: "p-cache-out" }, { componentId: "server", portId: "p-s-in" }, { latency: 2 });
  cacheEgress.connections.push(conn2.id);
  serverIngress.connections.push(conn2.id);
  state.addConnection(conn2);

  const engine = new Engine(state);

  return {
    state, controller, engine,
    entryPointId: "client" as ComponentId,
    components: [
      { id: "client" as ComponentId, name: "Client", type: "client" },
      { id: "cache" as ComponentId, name: "Cache", type: "cache" },
      { id: "server" as ComponentId, name: "Server", type: "server" },
    ],
    connections: [
      { id: "cx-cc", from: "Client", to: "Cache" },
      { id: "cx-cs", from: "Cache", to: "Server" },
    ],
  };
}

export function createLoadBalancedTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const clientEgress = makePort("p-c-out", "egress");
  const client = makeComponent({ id: "client", type: "client", ports: [clientEgress], capabilities: fwdCap("cap-fwd-c"), tiers: fwdTier("cap-fwd-c") });

  const lbIngress = makePort("p-lb-in", "ingress");
  const lbEgress = makePort("p-lb-out", "egress");
  const lb = makeComponent({ id: "lb", type: "load-balancer", ports: [lbIngress, lbEgress], capabilities: fwdCap("cap-fwd-lb"), tiers: fwdTier("cap-fwd-lb") });

  const s1Ingress = makePort("p-s1-in", "ingress");
  const server1 = makeComponent({ id: "server-1", type: "server", ports: [s1Ingress], capabilities: respCap("cap-resp-1"), tiers: respTier("cap-resp-1") });

  const s2Ingress = makePort("p-s2-in", "ingress");
  const server2 = makeComponent({ id: "server-2", type: "server", ports: [s2Ingress], capabilities: respCap("cap-resp-2"), tiers: respTier("cap-resp-2") });

  state.placeComponent(client);
  state.placeComponent(lb);
  state.placeComponent(server1);
  state.placeComponent(server2);

  const conn1 = makeConnection("cx-clb", { componentId: "client", portId: "p-c-out" }, { componentId: "lb", portId: "p-lb-in" });
  clientEgress.connections.push(conn1.id);
  lbIngress.connections.push(conn1.id);
  state.addConnection(conn1);

  const conn2 = makeConnection("cx-lb-s1", { componentId: "lb", portId: "p-lb-out" }, { componentId: "server-1", portId: "p-s1-in" });
  lbEgress.connections.push(conn2.id);
  s1Ingress.connections.push(conn2.id);
  state.addConnection(conn2);

  const conn3 = makeConnection("cx-lb-s2", { componentId: "lb", portId: "p-lb-out" }, { componentId: "server-2", portId: "p-s2-in" });
  lbEgress.connections.push(conn3.id);
  s2Ingress.connections.push(conn3.id);
  state.addConnection(conn3);

  const engine = new Engine(state);

  return {
    state, controller, engine,
    entryPointId: "client" as ComponentId,
    components: [
      { id: "client" as ComponentId, name: "Client", type: "client" },
      { id: "lb" as ComponentId, name: "Load Balancer", type: "load-balancer" },
      { id: "server-1" as ComponentId, name: "Server 1", type: "server" },
      { id: "server-2" as ComponentId, name: "Server 2", type: "server" },
    ],
    connections: [
      { id: "cx-clb", from: "Client", to: "LB" },
      { id: "cx-lb-s1", from: "LB", to: "Server 1" },
      { id: "cx-lb-s2", from: "LB", to: "Server 2" },
    ],
  };
}

export function createFullStackTopology(): TopologyInfo {
  const controller = new SandboxModeController();
  const state = new SimulationState(controller.getInitialZoneTopology());

  const clientEgress = makePort("p-c-out", "egress");
  const client = makeComponent({ id: "client", type: "client", ports: [clientEgress], capabilities: fwdCap("cap-fwd-c"), tiers: fwdTier("cap-fwd-c") });

  const lbIngress = makePort("p-lb-in", "ingress");
  const lbEgress = makePort("p-lb-out", "egress");
  const lb = makeComponent({ id: "lb", type: "load-balancer", ports: [lbIngress, lbEgress], capabilities: fwdCap("cap-fwd-lb"), tiers: fwdTier("cap-fwd-lb") });

  const serverIngress = makePort("p-s-in", "ingress");
  const serverEgress = makePort("p-s-out", "egress");
  const server = makeComponent({ id: "server", type: "server", ports: [serverIngress, serverEgress], capabilities: fwdCap("cap-fwd-s"), tiers: fwdTier("cap-fwd-s") });

  const dbIngress = makePort("p-db-in", "ingress");
  const db = makeComponent({ id: "database", type: "database", ports: [dbIngress], capabilities: respCap("cap-resp-db"), tiers: respTier("cap-resp-db") });

  state.placeComponent(client);
  state.placeComponent(lb);
  state.placeComponent(server);
  state.placeComponent(db);

  const c1 = makeConnection("cx-clb", { componentId: "client", portId: "p-c-out" }, { componentId: "lb", portId: "p-lb-in" });
  clientEgress.connections.push(c1.id);
  lbIngress.connections.push(c1.id);
  state.addConnection(c1);

  const c2 = makeConnection("cx-lb-s", { componentId: "lb", portId: "p-lb-out" }, { componentId: "server", portId: "p-s-in" });
  lbEgress.connections.push(c2.id);
  serverIngress.connections.push(c2.id);
  state.addConnection(c2);

  const c3 = makeConnection("cx-s-db", { componentId: "server", portId: "p-s-out" }, { componentId: "database", portId: "p-db-in" }, { latency: 3 });
  serverEgress.connections.push(c3.id);
  dbIngress.connections.push(c3.id);
  state.addConnection(c3);

  const engine = new Engine(state);

  return {
    state, controller, engine,
    entryPointId: "client" as ComponentId,
    components: [
      { id: "client" as ComponentId, name: "Client", type: "client" },
      { id: "lb" as ComponentId, name: "Load Balancer", type: "load-balancer" },
      { id: "server" as ComponentId, name: "Server", type: "server" },
      { id: "database" as ComponentId, name: "Database", type: "database" },
    ],
    connections: [
      { id: "cx-clb", from: "Client", to: "LB" },
      { id: "cx-lb-s", from: "LB", to: "Server" },
      { id: "cx-s-db", from: "Server", to: "Database" },
    ],
  };
}

export const TOPOLOGIES: Record<string, () => TopologyInfo> = {
  "Simple: Client → Server": createSimpleTopology,
  "With Cache: Client → Cache → Server": createCacheTopology,
  "Load Balanced: Client → LB → Server×2": createLoadBalancedTopology,
  "Full Stack: Client → LB → Server → DB": createFullStackTopology,
};

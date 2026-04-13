import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { TestForwardingCapability, RespondingCapability } from "@harness/test-capabilities";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type {
  CapabilityId,
  ComponentId,
  ConnectionId,
  PortId,
} from "@core/types/ids";
import type { Capability } from "@core/capability/capability";
import type { Port } from "@core/types/port";
import type { Connection } from "@core/types/connection";

const profile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [],
  criticalEffects: [],
};

function mkPort(id: string, direction: "ingress" | "egress"): Port {
  return {
    id: id as PortId,
    direction,
    dataType: "any",
    capacity: 100,
    connections: [],
  };
}

function mkComp(
  id: string,
  ports: Port[],
  caps: ReadonlyMap<CapabilityId, Capability>,
  tiers: ReadonlyMap<CapabilityId, number>,
): Component {
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: caps,
    initialTiers: tiers,
    ports,
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
  });
}

function mkConn(
  id: string,
  from: ComponentId,
  to: ComponentId,
  fromPort: PortId,
  toPort: PortId,
): Connection {
  return {
    id: id as ConnectionId,
    source: { componentId: from, portId: fromPort },
    target: { componentId: to, portId: toPort },
    bandwidth: 100,
    latency: 1,
    currentLoad: 0,
  };
}

describe("Engine walking skeleton", () => {
  it("injects traffic, forwards from Client to Server, logs events", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const clientEgress = mkPort("p-c-out", "egress");
    const clientCap = new TestForwardingCapability("cap-client" as CapabilityId);
    const clientCaps = new Map<CapabilityId, Capability>([
      ["cap-client" as CapabilityId, clientCap],
    ]);
    const clientTiers = new Map<CapabilityId, number>([["cap-client" as CapabilityId, 1]]);
    const client = mkComp("c-client", [clientEgress], clientCaps, clientTiers);

    const serverIngress = mkPort("p-s-in", "ingress");
    const serverCap = new RespondingCapability("cap-proc" as CapabilityId);
    const caps = new Map<CapabilityId, Capability>([
      ["cap-proc" as CapabilityId, serverCap],
    ]);
    const tiers = new Map<CapabilityId, number>([["cap-proc" as CapabilityId, 1]]);
    const server = mkComp("c-server", [serverIngress], caps, tiers);

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = mkConn(
      "cx-1",
      "c-client" as ComponentId,
      "c-server" as ComponentId,
      "p-c-out" as PortId,
      "p-s-in" as PortId,
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });

    const engine = new Engine(state);
    engine.tick(mode);

    const logs = [...state.requestLog.values()];
    expect(logs).toHaveLength(2);
    for (const events of logs) {
      const types = events.map((e) => e.type);
      expect(types).toContain("ENTERED");
      expect(types).toContain("TRAVERSED");
      expect(types).toContain("RESPONDED");
    }
    expect(state.currentTick).toBe(1);
  });

  it("5 ticks with intensity 2 produces 10 total requests", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const clientEgress = mkPort("p-c-out", "egress");
    const clientCap = new TestForwardingCapability("cap-client" as CapabilityId);
    const clientCaps = new Map<CapabilityId, Capability>([
      ["cap-client" as CapabilityId, clientCap],
    ]);
    const clientTiers = new Map<CapabilityId, number>([["cap-client" as CapabilityId, 1]]);
    const client = mkComp("c-client", [clientEgress], clientCaps, clientTiers);

    const serverIngress = mkPort("p-s-in", "ingress");
    const cap = new RespondingCapability("cap-proc" as CapabilityId);
    const server = mkComp(
      "c-server",
      [serverIngress],
      new Map([["cap-proc" as CapabilityId, cap]]),
      new Map([["cap-proc" as CapabilityId, 1]]),
    );

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = mkConn(
      "cx-1",
      "c-client" as ComponentId,
      "c-server" as ComponentId,
      "p-c-out" as PortId,
      "p-s-in" as PortId,
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });
    const engine = new Engine(state);
    for (let i = 0; i < 5; i++) engine.tick(mode);

    expect(state.currentTick).toBe(5);
    expect([...state.requestLog.values()]).toHaveLength(10);
  });
});

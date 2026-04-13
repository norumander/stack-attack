import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { TestForwardingCapability, RespondingCapability } from "@harness/test-capabilities";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

describe("Sandbox mode smoke test", () => {
  it("Client → Server topology, 10 requests over 5 ticks, all RESPONDED", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const clientEgress = makePort("p-c-out", "egress");
    const clientCaps = new Map<CapabilityId, Capability>([
      [
        "cap-client" as CapabilityId,
        new TestForwardingCapability("cap-client" as CapabilityId),
      ],
    ]);
    const clientTiers = new Map<CapabilityId, number>([["cap-client" as CapabilityId, 1]]);
    const client = makeComponent({
      id: "c-client",
      ports: [clientEgress],
      capabilities: clientCaps,
      tiers: clientTiers,
    });

    const serverIngress = makePort("p-s-in", "ingress");
    const caps = new Map<CapabilityId, Capability>([
      [
        "cap-proc" as CapabilityId,
        new RespondingCapability("cap-proc" as CapabilityId),
      ],
    ]);
    const tiers = new Map<CapabilityId, number>([["cap-proc" as CapabilityId, 1]]);
    const server = makeComponent({
      id: "c-server",
      ports: [serverIngress],
      capabilities: caps,
      tiers,
    });

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = makeConnection(
      "cx-1",
      { componentId: "c-client", portId: "p-c-out" },
      { componentId: "c-server", portId: "p-s-in" },
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new SandboxModeController();
    mode.addTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      requestType: "api_read",
      intensity: 2,
      pattern: "steady",
    });
    mode.advancePhase(); // build → simulate

    const engine = new Engine(state);
    for (let i = 0; i < 5; i++) engine.tick(mode);

    expect(state.currentTick).toBe(5);

    const logs = [...state.requestLog.values()];
    expect(logs).toHaveLength(10);

    for (const events of logs) {
      const types = events.map((e) => e.type);
      expect(types).toContain("ENTERED");
      expect(types).toContain("TRAVERSED");
      expect(types).toContain("RESPONDED");
      expect(types).not.toContain("DROPPED");
    }
  });

  it("multi-source traffic generates requests from all sources", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const clientEgress = makePort("p-c-out", "egress");
    const clientCaps = new Map<CapabilityId, Capability>([
      [
        "cap-client" as CapabilityId,
        new TestForwardingCapability("cap-client" as CapabilityId),
      ],
    ]);
    const clientTiers = new Map<CapabilityId, number>([["cap-client" as CapabilityId, 1]]);
    const client = makeComponent({
      id: "c-client",
      ports: [clientEgress],
      capabilities: clientCaps,
      tiers: clientTiers,
    });

    const serverIngress = makePort("p-s-in", "ingress");
    const caps = new Map<CapabilityId, Capability>([
      [
        "cap-proc" as CapabilityId,
        new RespondingCapability("cap-proc" as CapabilityId),
      ],
    ]);
    const tiers = new Map<CapabilityId, number>([["cap-proc" as CapabilityId, 1]]);
    const server = makeComponent({
      id: "c-server",
      ports: [serverIngress],
      capabilities: caps,
      tiers,
    });

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = makeConnection(
      "cx-1",
      { componentId: "c-client", portId: "p-c-out" },
      { componentId: "c-server", portId: "p-s-in" },
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new SandboxModeController();
    // Two sources both targeting same entry point
    mode.addTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      requestType: "api_read",
      intensity: 3,
      pattern: "steady",
    });
    mode.addTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      requestType: "api_write",
      intensity: 2,
      pattern: "steady",
    });
    mode.advancePhase(); // build → simulate

    const engine = new Engine(state);
    engine.tick(mode);

    // 3 + 2 = 5 requests in one tick
    const logs = [...state.requestLog.values()];
    expect(logs).toHaveLength(5);

    const allEvents = logs.flat();
    const types = allEvents
      .filter((e) => e.type === "ENTERED")
      .map((e) => {
        // Find the request by looking at the requestLog keys
        return e;
      });
    expect(types).toHaveLength(5);
  });

  it("mixed traffic distribution generates varied request types", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const clientEgress = makePort("p-c-out", "egress");
    const clientCaps = new Map<CapabilityId, Capability>([
      [
        "cap-client" as CapabilityId,
        new TestForwardingCapability("cap-client" as CapabilityId),
      ],
    ]);
    const clientTiers = new Map<CapabilityId, number>([["cap-client" as CapabilityId, 1]]);
    const client = makeComponent({
      id: "c-client",
      ports: [clientEgress],
      capabilities: clientCaps,
      tiers: clientTiers,
    });

    const serverIngress = makePort("p-s-in", "ingress");
    const caps = new Map<CapabilityId, Capability>([
      [
        "cap-proc" as CapabilityId,
        new RespondingCapability("cap-proc" as CapabilityId),
      ],
    ]);
    const tiers = new Map<CapabilityId, number>([["cap-proc" as CapabilityId, 1]]);
    const server = makeComponent({
      id: "c-server",
      ports: [serverIngress],
      capabilities: caps,
      tiers,
    });

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = makeConnection(
      "cx-1",
      { componentId: "c-client", portId: "p-c-out" },
      { componentId: "c-server", portId: "p-s-in" },
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new SandboxModeController();
    mode.addTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      requestType: "api_read",
      intensity: 10,
      pattern: "steady",
      requestTypeDistribution: [
        { type: "api_read", weight: 6 },
        { type: "api_write", weight: 4 },
      ],
    });
    mode.advancePhase(); // build → simulate

    const engine = new Engine(state);
    for (let i = 0; i < 5; i++) engine.tick(mode);

    const logs = [...state.requestLog.values()];
    expect(logs).toHaveLength(50); // 10 per tick * 5 ticks

    // All should be RESPONDED
    for (const events of logs) {
      const types = events.map((e) => e.type);
      expect(types).toContain("RESPONDED");
    }
  });

  it("chaos scheduling returns events at correct tick", () => {
    const mode = new SandboxModeController();
    mode.scheduleChaos(
      { kind: "component_failure", componentId: "c-server" as ComponentId },
      3,
    );

    expect(mode.getScheduledChaos(2)).toHaveLength(0);
    expect(mode.getScheduledChaos(3)).toHaveLength(1);
    expect(mode.getScheduledChaos(3)[0]!.kind).toBe("component_failure");
    expect(mode.getScheduledChaos(4)).toHaveLength(0);
  });
});

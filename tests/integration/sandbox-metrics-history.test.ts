import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import { TestForwardingCapability, RespondingCapability } from "@harness/test-capabilities";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

function buildClientServerTopology() {
  const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

  const clientEgress = makePort("p-c-out", "egress");
  const clientCaps = new Map<CapabilityId, Capability>([
    ["cap-fwd" as CapabilityId, new TestForwardingCapability("cap-fwd" as CapabilityId)],
  ]);
  const clientTiers = new Map<CapabilityId, number>([["cap-fwd" as CapabilityId, 1]]);
  const client = makeComponent({
    id: "c-client",
    ports: [clientEgress],
    capabilities: clientCaps,
    tiers: clientTiers,
  });

  const serverIngress = makePort("p-s-in", "ingress");
  const serverCaps = new Map<CapabilityId, Capability>([
    ["cap-resp" as CapabilityId, new RespondingCapability("cap-resp" as CapabilityId)],
  ]);
  const serverTiers = new Map<CapabilityId, number>([["cap-resp" as CapabilityId, 1]]);
  const server = makeComponent({
    id: "c-server",
    ports: [serverIngress],
    capabilities: serverCaps,
    tiers: serverTiers,
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

  return { state, clientId: "c-client" as ComponentId };
}

describe("Sandbox metrics history", () => {
  it("accumulates one TickMetrics entry per tick over 10 ticks", () => {
    const { state, clientId } = buildClientServerTopology();

    const mode = new SandboxModeController();
    mode.addTrafficSource({
      targetEntryPointId: clientId,
      requestType: "api_read",
      intensity: 5,
      pattern: "steady",
    });
    mode.advancePhase(); // build → simulate

    const engine = new Engine(state);
    for (let i = 0; i < 10; i++) engine.tick(mode);

    expect(state.metricsHistory).toHaveLength(10);

    // Each entry has the correct tick number
    for (let i = 0; i < 10; i++) {
      expect(state.metricsHistory[i]!.tick).toBe(i);
    }
  });

  it("total resolved across all ticks equals total injected requests", () => {
    const { state, clientId } = buildClientServerTopology();

    const mode = new SandboxModeController();
    mode.addTrafficSource({
      targetEntryPointId: clientId,
      requestType: "api_read",
      intensity: 5,
      pattern: "steady",
    });
    mode.advancePhase();

    const engine = new Engine(state);
    for (let i = 0; i < 10; i++) engine.tick(mode);

    const totalResolved = state.metricsHistory.reduce((sum, m) => sum + m.requestsResolved, 0);
    expect(totalResolved).toBe(50); // 5 req/tick × 10 ticks
  });

  it("getMetricsSnapshot summary matches manual aggregation", () => {
    const { state, clientId } = buildClientServerTopology();

    const mode = new SandboxModeController();
    mode.addTrafficSource({
      targetEntryPointId: clientId,
      requestType: "api_read",
      intensity: 5,
      pattern: "steady",
    });
    mode.advancePhase();

    const engine = new Engine(state);
    for (let i = 0; i < 10; i++) engine.tick(mode);

    const snap = mode.getMetricsSnapshot(state);

    expect(snap.ticks).toBe(10);
    expect(snap.totalResolved).toBe(50);
    expect(snap.totalDropped).toBe(0);
    expect(snap.totalTimedOut).toBe(0);
    expect(snap.reliability).toBe(1);
    expect(snap.perTickHistory).toBe(state.metricsHistory);
  });

  it("per-component metrics are present for both client and server", () => {
    const { state, clientId } = buildClientServerTopology();

    const mode = new SandboxModeController();
    mode.addTrafficSource({
      targetEntryPointId: clientId,
      requestType: "api_read",
      intensity: 2,
      pattern: "steady",
    });
    mode.advancePhase();

    const engine = new Engine(state);
    engine.tick(mode);

    const tickMetrics = state.metricsHistory[0]!;
    expect(tickMetrics.perComponent.has("c-client" as ComponentId)).toBe(true);
    expect(tickMetrics.perComponent.has("c-server" as ComponentId)).toBe(true);
  });
});

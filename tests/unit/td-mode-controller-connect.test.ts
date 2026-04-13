import { describe, expect, it } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function setup() {
  const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);

  // Seed a Client (entry-point)
  const client = compRegistry.create("client", { x: 0, y: 0 }, null);
  state.placeComponent(client);

  const economy = new TDEconomy({
    startingBudget: 10_000,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  const tdc = new TDModeController({
    waves: [WAVE_1, WAVE_2, WAVE_3],
    economy,
    entryPointId: client.id,
    rng: makeRng(1),
    componentRegistry: compRegistry,
  });
  return { state, tdc, client };
}

describe("TDModeController.tryConnect", () => {
  it("creates a connection between Client and a placed Server", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(place.ok).toBe(true);
    if (!place.ok) throw new Error();
    const result = tdc.tryConnect(state, client.id, place.componentId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(state.connections.has(result.connectionId)).toBe(true);

    // Verify port.connections updated on both endpoints
    const conn = state.connections.get(result.connectionId)!;
    const sourceComp = state.components.get(conn.source.componentId)!;
    const targetComp = state.components.get(conn.target.componentId)!;
    const sourcePort = sourceComp.ports.find((p) => p.id === conn.source.portId)!;
    const targetPort = targetComp.ports.find((p) => p.id === conn.target.portId)!;
    expect(sourcePort.connections).toContain(result.connectionId);
    expect(targetPort.connections).toContain(result.connectionId);
  });

  it("rejects with wrong_phase in simulate phase", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    tdc.advancePhase(state);  // build → simulate
    const result = tdc.tryConnect(state, client.id, place.componentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("wrong_phase");
  });

  it("rejects with unknown_source for bogus source id", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    const result = tdc.tryConnect(state, "ghost" as ComponentId, place.componentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("unknown_source");
  });

  it("rejects with unknown_target for bogus target id", () => {
    const { state, tdc, client } = setup();
    const result = tdc.tryConnect(state, client.id, "ghost" as ComponentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("unknown_target");
  });

  it("rejects with no_ingress_port when target is the Client", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    // Connecting Server → Client: Client has no ingress port (CLIENT_ENTRY only declares egress)
    const result = tdc.tryConnect(state, place.componentId, client.id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("no_ingress_port");
  });

  it("rejects duplicate_connection on second connect of same pair", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    const first = tdc.tryConnect(state, client.id, place.componentId);
    expect(first.ok).toBe(true);
    const second = tdc.tryConnect(state, client.id, place.componentId);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error();
    expect(second.reason).toBe("duplicate_connection");
  });
});

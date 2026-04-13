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

function setup(opts?: { startingBudget?: number }) {
  const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);
  const economy = new TDEconomy({
    startingBudget: opts?.startingBudget ?? WAVE_1.startingBudget,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  const tdc = new TDModeController({
    waves: [WAVE_1, WAVE_2, WAVE_3],
    economy,
    entryPointId: "entry-stub" as ComponentId,
    rng: makeRng(1),
    componentRegistry: compRegistry,
  });
  return { state, tdc, economy };
}

describe("TDModeController.tryPlace", () => {
  it("places a server, debits the economy, mutates state", () => {
    const { state, tdc, economy } = setup();
    const before = economy.getBudget();
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(state.components.has(result.componentId)).toBe(true);
    expect(economy.getBudget()).toBeLessThan(before);
  });

  it("rejects with disallowed_by_mode in simulate phase", () => {
    const { state, tdc } = setup();
    tdc.advancePhase(state);  // build → simulate
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("disallowed_by_mode");
  });

  it("rejects with disallowed_by_mode for type not in availableComponents", () => {
    const { state, tdc } = setup();
    // Wave 1 only allows server + database
    const result = tdc.tryPlace(state, "cache", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("disallowed_by_mode");
  });

  it("rejects with registry_unknown_type for unknown component types", () => {
    const customWave = {
      ...WAVE_1,
      availableComponents: ["ghost"],
    };
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const economy = new TDEconomy({
      startingBudget: 1000,
      revenuePerRequestType: customWave.revenuePerRequestType,
    });
    const capRegistry = new CapabilityRegistry();
    const compRegistry = new ComponentRegistry(capRegistry);
    registerTDDefaults(capRegistry, compRegistry);
    const tdc = new TDModeController({
      waves: [customWave],
      economy,
      entryPointId: "entry-stub" as ComponentId,
      rng: makeRng(1),
      componentRegistry: compRegistry,
    });
    const result = tdc.tryPlace(state, "ghost", { x: 0, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("registry_unknown_type");
  });

  it("rejects with insufficient_budget when balance is too low", () => {
    const { state, tdc, economy } = setup({ startingBudget: 50 });  // SERVER_ENTRY costs 100
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("insufficient_budget");
    expect(economy.getBudget()).toBe(50);  // unchanged
    expect(state.components.size).toBe(0);
  });
});

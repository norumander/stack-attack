import { describe, expect, it } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1 } from "@modes/td/td-waves";
import { bootTDRegistry, makeRng, makeTDController } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";

describe("TDModeController.tryPlace", () => {
  it("places a server, debits the economy, mutates state", () => {
    const { state, tdc, economy } = makeTDController();
    const before = economy.getBudget();
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(state.components.has(result.componentId)).toBe(true);
    expect(economy.getBudget()).toBeLessThan(before);
  });

  it("rejects with disallowed_by_mode in simulate phase", () => {
    const { state, tdc } = makeTDController();
    tdc.advancePhase(state); // build → simulate
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("disallowed_by_mode");
  });

  it("rejects with disallowed_by_mode for type not in availableComponents", () => {
    const { state, tdc } = makeTDController();
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
    const compRegistry = bootTDRegistry();
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
    const { state, tdc, economy } = makeTDController({ startingBudget: 50 }); // SERVER_ENTRY costs 100
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("insufficient_budget");
    expect(economy.getBudget()).toBe(50); // unchanged
    expect(state.components.size).toBe(0);
  });
});

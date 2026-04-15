import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import { bootTDRegistry, makeRng } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";
import { SimulationState } from "@core/state/simulation-state";

const MINIMAL_WAVE: TDWaveDefinition = {
  id: 1,
  name: "Test",
  startingBudget: 600,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 30,
  ttl: 10,
  availableComponents: ["server", "database"],
  dropThreshold: 0.2,
  revenuePerRequestType: new Map([["api_read", 1]]),
  viabilityPerFailure: 0.1,
  viabilityRampPenalty: 0.5,
};

function makeController(): TDModeController {
  return new TDModeController({
    waves: [MINIMAL_WAVE],
    economy: new TDEconomy({
      startingBudget: 600,
      revenuePerRequestType: new Map([["api_read", 1]]),
    }),
    entryPointId: "client-entry" as ComponentId,
    rng: makeRng(1),
    componentRegistry: bootTDRegistry(),
  });
}

describe("TDModeController.getViability", () => {
  it("starts at 100/100", () => {
    const controller = makeController();
    const v = controller.getViability();
    expect(v.value).toBe(100);
    expect(v.max).toBe(100);
    expect(v.fraction).toBe(1);
    expect(v.isDead).toBe(false);
  });
});

describe("TDModeController.getRentBill", () => {
  it("returns 0 for an empty topology", () => {
    const controller = makeController();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(controller.getRentBill(state)).toBe(0);
  });

  it("sums rentPerWave across all placed components", () => {
    const controller = makeController();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const registry = bootTDRegistry();

    const server1 = registry.create("server", { x: 0, y: 0 }, null);
    const server2 = registry.create("server", { x: 1, y: 0 }, null);
    const database = registry.create("database", { x: 2, y: 0 }, null);
    state.placeComponent(server1);
    state.placeComponent(server2);
    state.placeComponent(database);

    // T8 will set rentPerWave on entries; for now the registry values are
    // all 0 (no rentPerWave field), so the bill is 0. T8's step 3 bumps
    // this assertion to 240.
    expect(controller.getRentBill(state)).toBe(0);
  });
});

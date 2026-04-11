import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { deductUpkeep } from "@core/engine/deduct-upkeep";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import type { Capability } from "@core/capability/capability";
import { TestEconomyStrategy } from "@harness/test-economy";
import { TestChaosController } from "@harness/test-chaos-controller";

function makeCap(id: string, upkeep: number): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: (_tier: number) => upkeep,
    getStats: () => ({}),
  };
}

function makeComp(
  id: string,
  condition: number,
  upkeep: number,
  profile: ConditionProfile,
): Component {
  const cap = makeCap("c", upkeep);
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map([[cap.id, cap]]),
    initialTiers: new Map([[cap.id, 1]]),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
    initialCondition: condition,
  });
}

const healthyProfile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [{ kind: "upkeep_multiplier", factor: 2 }],
  criticalEffects: [{ kind: "upkeep_multiplier", factor: 4 }],
};

describe("deductUpkeep", () => {
  it("sums base upkeep with no multipliers", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("a", 1.0, 10, healthyProfile));
    state.placeComponent(makeComp("b", 1.0, 20, healthyProfile));
    const economy = new TestEconomyStrategy({ budget: 1000 });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);

    expect(economy.debitLog).toEqual([30]);
    expect(state.upkeepPaidThisTick).toBe(30);
  });

  it("applies upkeep_multiplier from condition effects", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("a", 0.5, 10, healthyProfile)); // degraded → 2x
    state.placeComponent(makeComp("b", 0.1, 20, healthyProfile)); // critical → 4x
    const economy = new TestEconomyStrategy({ budget: 1000 });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);

    expect(economy.debitLog).toEqual([10 * 2 + 20 * 4]); // 100
    expect(state.upkeepPaidThisTick).toBe(100);
  });

  it("writes condition=0 to every insolvent component", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const a = makeComp("a", 1.0, 10, healthyProfile);
    const b = makeComp("b", 1.0, 20, healthyProfile);
    state.placeComponent(a);
    state.placeComponent(b);
    const economy = new TestEconomyStrategy({
      budget: 1000,
      insolvencyRule: () => [a.id, b.id],
    });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);

    expect(a.condition).toBe(0);
    expect(b.condition).toBe(0);
  });

  it("does nothing to condition when insolvency returns []", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const a = makeComp("a", 0.8, 10, healthyProfile);
    state.placeComponent(a);
    const economy = new TestEconomyStrategy({ budget: 1000 });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);

    expect(a.condition).toBe(0.8);
  });

  it("calls debitUpkeep exactly once per tick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("a", 1.0, 5, healthyProfile));
    const economy = new TestEconomyStrategy({ budget: 1000 });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);
    expect(economy.debitLog.length).toBe(1);
    deductUpkeep(state, mc);
    expect(economy.debitLog.length).toBe(2);
  });
});

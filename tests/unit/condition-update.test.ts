import { describe, it, expect, beforeEach } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { updateCondition } from "@core/engine/stubs";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import { NoOpModeController } from "@harness/noop-mode-controller";

const profile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [],
  criticalEffects: [],
};

function makeComp(id: string, initialCondition: number): Component {
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map(),
    initialTiers: new Map<CapabilityId, number>(),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
    initialCondition,
  });
}

function place(state: SimulationState, comp: Component): void {
  state.placeComponent(comp);
  state.visitOrder.push(comp.id);
}

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("updateCondition", () => {
  let state: SimulationState;

  beforeEach(() => {
    state = new SimulationState({ zones: [], pairLatency: new Map() });
  });

  it("decays condition on a tick with any drops", () => {
    const c = makeComp("c1", 1.0);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 0, drops: 1, timeouts: 0, overloaded: 0, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.9, 10);
  });

  it("decays on a timeout-only tick", () => {
    const c = makeComp("c1", 0.8);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 5, drops: 0, timeouts: 1, overloaded: 0, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.7, 10);
  });

  it("decays on an overloaded-only tick", () => {
    const c = makeComp("c1", 0.9);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 0, drops: 0, timeouts: 0, overloaded: 2, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.8, 10);
  });

  it("decays on a backpressured-only tick", () => {
    const c = makeComp("c1", 0.5);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 0, drops: 0, timeouts: 0, overloaded: 0, backpressured: 3,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.4, 10);
  });

  it("recovers condition on a clean tick", () => {
    const c = makeComp("c1", 0.5);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 10, drops: 0, timeouts: 0, overloaded: 0, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.55, 10);
  });

  it("recovers when the component has no counter entry at all", () => {
    const c = makeComp("c1", 0.5);
    place(state, c);
    // No perComponentThisTick entry — treated as clean.
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.55, 10);
  });

  it("clamps at 1.0 when healthy and recovering", () => {
    const c = makeComp("c1", 0.99);
    place(state, c);
    updateCondition(state, mc);
    expect(c.condition).toBe(1);
  });

  it("clamps at 0.0 when critical and decaying", () => {
    const c = makeComp("c1", 0.05);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 0, drops: 1, timeouts: 0, overloaded: 0, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBe(0);
  });

  it("updates each component independently in one pass", () => {
    const a = makeComp("a", 0.8);
    const b = makeComp("b", 0.8);
    place(state, a);
    place(state, b);
    state.perComponentThisTick.set(a.id, {
      processed: 0, drops: 1, timeouts: 0, overloaded: 0, backpressured: 0,
    });
    // b is clean (no counter entry).
    updateCondition(state, mc);
    expect(a.condition).toBeCloseTo(0.7, 10);
    expect(b.condition).toBeCloseTo(0.85, 10);
  });

  it("iterates in visitOrder (deterministic)", () => {
    const a = makeComp("a", 0.5);
    const b = makeComp("b", 0.5);
    place(state, a);
    place(state, b);
    expect(state.visitOrder).toEqual(["a", "b"]);
  });
});

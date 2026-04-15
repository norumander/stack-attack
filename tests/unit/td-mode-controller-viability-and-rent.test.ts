import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import { bootTDRegistry, makeRng } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";
import { SimulationState } from "@core/state/simulation-state";
import type { SimulationStateReader } from "@core/state/state-reader";

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

    // Server rent=80, Server rent=80, Database rent=80 → total 240
    expect(controller.getRentBill(state)).toBe(240);
  });
});

describe("TDModeController.payRent", () => {
  it("returns ok: true with bill when rent is affordable (empty topology)", () => {
    const controller = makeController();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const result = controller.payRent(state);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bill).toBe(0);
    }
  });
});

describe("TDModeController.onTick viability damage", () => {
  it("damages viability per dropped/timed-out request this tick", () => {
    const controller = makeController();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Advance to simulate phase so onTick runs
    controller.advancePhase(state);

    // Seed metricsHistory with one tick: 10 dropped requests
    state.metricsHistory.push({
      tick: 0,
      requestsGenerated: 10,
      requestsResolved: 0,
      requestsDropped: 10,
      requestsTimedOut: 0,
      avgLatency: 0,
      componentsActive: 0,
      revenueEarned: 0,
      upkeepPaid: 0,
    } as any);

    controller.onTick(state as unknown as SimulationStateReader);

    // Base damage: 10 drops × 0.1 viabilityPerFailure = 1.0
    // Plus ramp penalty (0.5): drop rate = 100% > dropThreshold 0.2 → fires
    // Total: 1.5
    expect(controller.getViability().value).toBeCloseTo(98.5, 1);
  });

  it("does not apply ramp penalty when drop rate is below dropThreshold", () => {
    const controller = makeController();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    controller.advancePhase(state);

    // Fill with healthy tick: 100 resolved, 1 dropped → 1% drop rate < 20% threshold
    state.metricsHistory.push({
      tick: 0,
      requestsGenerated: 101,
      requestsResolved: 100,
      requestsDropped: 1,
      requestsTimedOut: 0,
      avgLatency: 0,
      componentsActive: 0,
      revenueEarned: 0,
      upkeepPaid: 0,
    } as any);

    controller.onTick(state as unknown as SimulationStateReader);

    // Only base damage: 1 drop × 0.1 = 0.1; no ramp penalty
    expect(controller.getViability().value).toBeCloseTo(99.9, 2);
  });

  it("does not damage viability in build phase", () => {
    const controller = makeController();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Still in build phase — do not advance
    state.metricsHistory.push({
      tick: 0,
      requestsGenerated: 100,
      requestsResolved: 0,
      requestsDropped: 100,
      requestsTimedOut: 0,
      avgLatency: 0,
      componentsActive: 0,
      revenueEarned: 0,
      upkeepPaid: 0,
    } as any);

    controller.onTick(state as unknown as SimulationStateReader);

    expect(controller.getViability().value).toBe(100);
  });
});

describe("TDModeController.getTerminalState", () => {
  it('returns "running" in build phase', () => {
    const controller = makeController();
    expect(controller.getTerminalState()).toBe("running");
  });

  it('returns "running" in simulate with viability > 0 and wave not drained', () => {
    const controller = makeController();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    controller.advancePhase(state);
    state.metricsHistory.push({
      tick: 0, requestsGenerated: 10, requestsResolved: 10,
      requestsDropped: 0, requestsTimedOut: 0, avgLatency: 0,
      componentsActive: 0, revenueEarned: 10, upkeepPaid: 0,
    } as any);
    expect(controller.getTerminalState()).toBe("running");
  });

  it('returns "dead" when viability hits 0', () => {
    const controller = makeController();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    controller.advancePhase(state);

    // Drop 1500 in one tick × 0.1 = 150 viability damage → dead
    state.metricsHistory.push({
      tick: 0, requestsGenerated: 1500, requestsResolved: 0,
      requestsDropped: 1500, requestsTimedOut: 0, avgLatency: 0,
      componentsActive: 0, revenueEarned: 0, upkeepPaid: 0,
    } as any);
    controller.onTick(state as any);

    expect(controller.getViability().isDead).toBe(true);
    expect(controller.getTerminalState()).toBe("dead");
  });
});

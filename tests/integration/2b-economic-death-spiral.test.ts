import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import type { Request } from "@core/types/request";
import { RespondingCapability } from "@harness/test-capabilities";
import { TestEconomyStrategy } from "@harness/test-economy";
import { TestChaosController } from "@harness/test-chaos-controller";
import type { Capability } from "@core/capability/capability";

// A profile that decays fast and recovers slowly, with aggressive
// upkeep multipliers so the budget tips over quickly.
const deathSpiralProfile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.2,
  recoveryRate: 0.05,
  degradedEffects: [
    { kind: "upkeep_multiplier", factor: 2 },
    { kind: "drop_probability", p: 0.5 },
  ],
  criticalEffects: [
    { kind: "upkeep_multiplier", factor: 4 },
    { kind: "drop_probability", p: 1.0 },
  ],
};

function makeComp(id: string, throughput: number, upkeep: number): Component {
  const cap = new RespondingCapability("resp" as CapabilityId, {
    throughputPerTier: throughput,
    upkeepPerTier: upkeep,
  });
  return new Component({
    id: id as ComponentId,
    type: "server",
    name: id,
    description: "",
    capabilities: new Map<CapabilityId, Capability>([[cap.id, cap]]),
    initialTiers: new Map<CapabilityId, number>([[cap.id, 1]]),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: deathSpiralProfile,
    initialCondition: 1.0,
  });
}

function makeReq(id: string, origin: ComponentId, tick: number): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin,
    createdAt: tick,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("Stage 2b — economic death spiral", () => {
  it("closes the condition → upkeep → insolvency → condition loop", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComp("server", /*throughput=*/ 3, /*upkeep=*/ 10);
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);

    const economy: TestEconomyStrategy = new TestEconomyStrategy({
      budget: 40, // enough for ~4 ticks of base upkeep
      revenuePerRequest: 5,
      insolvencyRule: (): ComponentId[] =>
        economy.budget < 0 ? [comp.id] : [],
    });
    const mc = new TestChaosController({ economy });
    const engine = new Engine(state);

    // Phase 1: ticks 0..4 — sustainable. 3 requests in, 3 processed,
    // 15 revenue - 10 upkeep = +5/tick. Budget climbs. No drops/timeouts
    // so condition stays pinned at 1.0 (recovery is a no-op at the cap).
    for (let t = 0; t < 5; t++) {
      state.enqueuePending(comp.id, makeReq(`r${t}a`, comp.id, t));
      state.enqueuePending(comp.id, makeReq(`r${t}b`, comp.id, t));
      state.enqueuePending(comp.id, makeReq(`r${t}c`, comp.id, t));
      engine.tick(mc);
    }
    expect(comp.condition).toBe(1.0);
    expect(economy.budget).toBeGreaterThan(40);

    // Phase 2: tick 5 — traffic spike (10 req vs throughput 3).
    // 3 processed, 7 queued. On tick 6 those 7 become overloaded/dropped.
    for (let i = 0; i < 10; i++) {
      state.enqueuePending(comp.id, makeReq(`spike${i}`, comp.id, 5));
    }
    engine.tick(mc); // tick 5: 3 processed, 7 still pending (will overload next tick)

    // Phase 3: tick 6 — drops happen, condition decays.
    engine.tick(mc);
    expect(comp.condition).toBeLessThan(1.0);

    // Phase 4: ticks 7..20 — upkeep multiplier kicks in, budget burns down.
    // Each tick keeps at least one request in play so condition keeps
    // getting marked as a "bad tick" (since drop_probability fires).
    const earlyBudget = economy.budget;
    for (let t = 7; t <= 20; t++) {
      // Keep some pressure on.
      state.enqueuePending(comp.id, makeReq(`p${t}a`, comp.id, t));
      state.enqueuePending(comp.id, makeReq(`p${t}b`, comp.id, t));
      state.enqueuePending(comp.id, makeReq(`p${t}c`, comp.id, t));
      engine.tick(mc);
    }

    // The loop should have closed: condition degraded below the
    // degraded threshold, and the budget fell from where it peaked.
    expect(economy.budget).toBeLessThan(earlyBudget);
    expect(comp.condition).toBeLessThanOrEqual(deathSpiralProfile.degradedThreshold);

    // Metrics history should show non-zero upkeepPaid and revenueEarned
    // across the run.
    const totalUpkeep = state.metricsHistory.reduce((s, m) => s + m.upkeepPaid, 0);
    const totalRevenue = state.metricsHistory.reduce((s, m) => s + m.revenueEarned, 0);
    expect(totalUpkeep).toBeGreaterThan(0);
    expect(totalRevenue).toBeGreaterThan(0);
  });

  it("is deterministic across two runs with the same seed", () => {
    function run(): { conditions: number[]; budgets: number[] } {
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const comp = makeComp("server", 3, 10);
      state.placeComponent(comp);
      state.visitOrder.push(comp.id);
      const economy: TestEconomyStrategy = new TestEconomyStrategy({
        budget: 40,
        revenuePerRequest: 5,
        insolvencyRule: (): ComponentId[] =>
          economy.budget < 0 ? [comp.id] : [],
      });
      const mc = new TestChaosController({ economy });
      const engine = new Engine(state);
      const conditions: number[] = [];
      const budgets: number[] = [];
      for (let t = 0; t < 15; t++) {
        const reqCount = t < 5 ? 3 : 10;
        for (let i = 0; i < reqCount; i++) {
          state.enqueuePending(comp.id, makeReq(`t${t}i${i}`, comp.id, t));
        }
        engine.tick(mc);
        conditions.push(comp.condition);
        budgets.push(economy.budget);
      }
      return { conditions, budgets };
    }

    const a = run();
    const b = run();
    expect(a.conditions).toEqual(b.conditions);
    expect(a.budgets).toEqual(b.budgets);
  });
});

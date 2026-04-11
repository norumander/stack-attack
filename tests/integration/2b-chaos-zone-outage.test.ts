import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import type { Request } from "@core/types/request";
import type { ChaosEvent } from "@core/types/chaos";
import { RespondingCapability } from "@harness/test-capabilities";
import { TestEconomyStrategy } from "@harness/test-economy";
import { TestChaosController } from "@harness/test-chaos-controller";
import type { Capability } from "@core/capability/capability";

// Fast recovery so the post-outage rebound is visible inside a short run.
const outageProfile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.2,
  degradedEffects: [
    { kind: "upkeep_multiplier", factor: 2 },
    { kind: "drop_probability", p: 0.5 },
  ],
  criticalEffects: [
    { kind: "upkeep_multiplier", factor: 4 },
    { kind: "drop_probability", p: 1.0 },
  ],
};

function makeComp(
  id: string,
  zone: string | null,
  throughput: number,
  upkeep: number,
): Component {
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
    zone,
    placementTick: 0,
    conditionProfile: outageProfile,
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

// Shared setup: one us-east server with fast-recovery profile, a
// zone_outage scheduled at tick 3 for 4 ticks, generous revenue so
// normal ticks are profitable.
interface Rig {
  state: SimulationState;
  comp: Component;
  economy: TestEconomyStrategy;
  mc: TestChaosController;
  engine: Engine;
}

function makeRig(): Rig {
  const state = new SimulationState({ zones: [], pairLatency: new Map() });
  const comp = makeComp("server", "us-east", /*throughput=*/ 3, /*upkeep=*/ 5);
  state.placeComponent(comp);
  state.visitOrder.push(comp.id);

  const economy: TestEconomyStrategy = new TestEconomyStrategy({
    budget: 200,
    revenuePerRequest: 4,
    insolvencyRule: (): ComponentId[] => [],
  });

  const zoneOutage: ChaosEvent = {
    kind: "zone_outage",
    zone: "us-east",
    durationTicks: 4,
  };
  const schedule = new Map<number, readonly ChaosEvent[]>([[3, [zoneOutage]]]);

  const mc = new TestChaosController({ economy, schedule });
  const engine = new Engine(state);
  return { state, comp, economy, mc, engine };
}

describe("Stage 2b — chaos-driven zone outage end-to-end", () => {
  it("zone_outage drives condition to 0, zeroes revenue, spikes upkeep, then recovers", () => {
    const { state, comp, economy, mc, engine } = makeRig();

    const conditions: number[] = [];
    const upkeeps: number[] = [];
    const revenues: number[] = [];

    // Ticks 0..6: keep 3 requests/tick in flight (matches throughput).
    // Ticks 7..11: stop sending so the component gets "good ticks" and
    // can recover from condition=0. The outage fires in step 6b of tick 3
    // and expires at the start of step 6b on tick 7 (expiresAtTick=7, swept
    // when 7 <= currentTick).
    const totalTicks = 12;
    for (let t = 0; t < totalTicks; t++) {
      if (t <= 6) {
        state.enqueuePending(comp.id, makeReq(`r${t}a`, comp.id, t));
        state.enqueuePending(comp.id, makeReq(`r${t}b`, comp.id, t));
        state.enqueuePending(comp.id, makeReq(`r${t}c`, comp.id, t));
      }
      engine.tick(mc);
      // metricsHistory[t] is the snapshot recorded in step 8 of this tick.
      const m = state.metricsHistory[t]!;
      conditions.push(comp.condition);
      upkeeps.push(m.upkeepPaid);
      revenues.push(m.revenueEarned);
    }

    // --- Phase A: healthy ticks 0..2 ---
    // No drops, so step 6 (recovery) keeps condition pinned at 1.0.
    // Upkeep is base (5), revenue is 3 req * 4 = 12.
    for (let t = 0; t <= 2; t++) {
      expect(conditions[t]).toBe(1.0);
      expect(upkeeps[t]).toBe(5);
      expect(revenues[t]).toBe(12);
    }

    // --- Phase B: tick 3, the "switchover" ---
    // Processing (step 3) runs BEFORE chaos inject (step 6b), so revenue
    // for tick 3 uses the pre-outage condition (1.0) and is still 12.
    // Step 6 recovers from 1.0 → 1.0. Step 6b then pins condition to 0.
    // Step 7 deducts upkeep AFTER the pin, so the critical 4x multiplier
    // already applies → 5 * 4 = 20.
    expect(conditions[3]).toBe(0);
    expect(revenues[3]).toBe(12);
    expect(upkeeps[3]).toBe(20);

    // --- Phase C: outage window ticks 4..6 ---
    // Condition is 0 at the start of each tick, so every request is
    // drop_probability=1 → dropped. Revenue = 0, upkeep = 20 each tick.
    // Step 6 tries to decay a bad tick but clamps at 0; step 6b re-pins.
    for (let t = 4; t <= 6; t++) {
      expect(conditions[t]).toBe(0);
      expect(revenues[t]).toBe(0);
      expect(upkeeps[t]).toBe(20);
    }

    // --- Phase D: tick 7, chaos expires mid-tick ---
    // At the start of tick 7, activeChaos still contains the entry
    // (expiresAtTick = 3+4 = 7). Step 3 processing sees condition=0, but
    // we've stopped sending requests — nothing to drop, so perComponent
    // counters stay at zero. Step 6 (good tick) recovers 0 → 0.2.
    // Step 6b sweeps the expired entry (7 <= 7) without re-pinning.
    // Upkeep at condition 0.2 is still critical → 20.
    expect(conditions[7]).toBeCloseTo(0.2, 10);
    expect(revenues[7]).toBe(0);
    expect(upkeeps[7]).toBe(20);

    // --- Phase E: recovery ramps up, ticks 8..11 ---
    // With no pressure and no chaos, condition climbs by 0.2 per tick.
    // Upkeep multiplier drops as we cross thresholds:
    //   cond 0.4 → degraded → 2x (critical at <=0.3)
    //   cond 0.6 → degraded → 2x
    //   cond 0.8 → healthy  → 1x (degraded at <=0.7)
    //   cond 1.0 → healthy  → 1x
    expect(conditions[8]).toBeCloseTo(0.4, 10);
    expect(upkeeps[8]).toBe(10); // 5 * 2 (degraded)

    expect(conditions[9]).toBeCloseTo(0.6, 10);
    expect(upkeeps[9]).toBe(10); // 5 * 2 (degraded)

    expect(conditions[10]).toBeCloseTo(0.8, 10);
    expect(upkeeps[10]).toBe(5); // healthy

    expect(conditions[11]).toBeCloseTo(1.0, 10);
    expect(upkeeps[11]).toBe(5); // healthy

    // --- Aggregate sanity ---
    // Outage-window upkeep (ticks 3..6) beats pre-outage upkeep.
    const preOutageUpkeep = upkeeps[0]! + upkeeps[1]! + upkeeps[2]!;
    const outageUpkeep =
      upkeeps[3]! + upkeeps[4]! + upkeeps[5]! + upkeeps[6]!;
    expect(outageUpkeep).toBeGreaterThan(preOutageUpkeep);

    // Pre-outage revenue accrues; outage-window revenue after the
    // switchover (ticks 4..6) is zero.
    const preOutageRevenue = revenues[0]! + revenues[1]! + revenues[2]!;
    const postSwitchOutageRevenue =
      revenues[4]! + revenues[5]! + revenues[6]!;
    expect(preOutageRevenue).toBeGreaterThan(0);
    expect(postSwitchOutageRevenue).toBe(0);

    // Economy budget reflects the whole story: base budget + all
    // revenue credited - all upkeep debited.
    const totalRevenue = revenues.reduce((s, v) => s + v, 0);
    const totalUpkeep = upkeeps.reduce((s, v) => s + v, 0);
    expect(economy.budget).toBeCloseTo(200 + totalRevenue - totalUpkeep, 6);
  });

  it("is deterministic across two runs with the same schedule", () => {
    function run(): {
      conditions: number[];
      upkeeps: number[];
      revenues: number[];
      budget: number;
    } {
      const { state, comp, economy, mc, engine } = makeRig();
      const conditions: number[] = [];
      const upkeeps: number[] = [];
      const revenues: number[] = [];
      for (let t = 0; t < 12; t++) {
        if (t <= 6) {
          state.enqueuePending(comp.id, makeReq(`r${t}a`, comp.id, t));
          state.enqueuePending(comp.id, makeReq(`r${t}b`, comp.id, t));
          state.enqueuePending(comp.id, makeReq(`r${t}c`, comp.id, t));
        }
        engine.tick(mc);
        const m = state.metricsHistory[t]!;
        conditions.push(comp.condition);
        upkeeps.push(m.upkeepPaid);
        revenues.push(m.revenueEarned);
      }
      return { conditions, upkeeps, revenues, budget: economy.budget };
    }

    const a = run();
    const b = run();
    expect(a.conditions).toEqual(b.conditions);
    expect(a.upkeeps).toEqual(b.upkeeps);
    expect(a.revenues).toEqual(b.revenues);
    expect(a.budget).toEqual(b.budget);
  });
});

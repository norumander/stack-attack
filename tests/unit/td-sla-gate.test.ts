import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import type { TickMetrics } from "@core/types/metrics";
import type { ComponentId } from "@core/types/ids";
import { bootTDRegistry, makeRng } from "@harness/td-fixtures";

function makeWave(sla?: TDWaveDefinition["sla"]): TDWaveDefinition {
  const base = {
    id: 1,
    name: "Test Wave",
    startingBudget: 500,
    intensity: 10,
    composition: new Map([["api_read", 1.0]]),
    duration: 30,
    ttl: 10,
    availableComponents: ["server"],
    dropThreshold: 0.05,
    viabilityPerFailure: 0.1,
    viabilityRampPenalty: 0.5,
    revenuePerRequestType: new Map([["api_read", 1]]),
  };
  if (sla === undefined) return base;
  return { ...base, sla };
}

function makeMetrics(overrides: Partial<TickMetrics> = {}): TickMetrics {
  return {
    tick: 0,
    requestsProcessed: 0,
    requestsResolved: 0,
    requestsDropped: 0,
    requestsOverloaded: 0,
    requestsBackpressured: 0,
    requestsTimedOut: 0,
    revenueEarned: 0,
    upkeepPaid: 0,
    avgLatency: 0,
    perComponent: new Map(),
    ...overrides,
  };
}

function makeTDC(wave: TDWaveDefinition, budget = 500): TDModeController {
  const registry = bootTDRegistry();
  return new TDModeController({
    waves: [wave],
    economy: new TDEconomy({
      startingBudget: budget,
      revenuePerRequestType: wave.revenuePerRequestType,
    }),
    entryPointId: "c-entry" as ComponentId,
    rng: makeRng(42),
    componentRegistry: registry,
  });
}

describe("SLA gate — evaluateSLA", () => {
  it("passes all SLAs when metrics are healthy", () => {
    const wave = makeWave({ availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 2 });
    const tdc = makeTDC(wave);
    tdc.advancePhase(); // build → simulate

    // Wave scheduled: 10 req/tick * 30 ticks = 300 requests.
    // 290 resolved + 10 dropped sum to the full scheduled count, so the
    // scheduled-generated denominator (max(accounted, 300) = 300) matches
    // the accounted total — availability = 290/300 ≈ 96.7%.
    const metrics = [makeMetrics({ requestsResolved: 290, requestsDropped: 10, avgLatency: 3 })];
    const sla = tdc.evaluateSLA(metrics);

    expect(sla.availability.passed).toBe(true);
    expect(sla.availability.actual).toBeCloseTo(290 / 300, 3);
    expect(sla.latency.passed).toBe(true);
    expect(sla.latency.actual).toBeCloseTo(3, 3);
    expect(sla.budget.passed).toBe(true);
    expect(sla.allPassed).toBe(true);
  });

  it("fails availability SLA when too many drops", () => {
    const wave = makeWave({ availabilityTarget: 0.95, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 5 });
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    // 240 resolved + 60 dropped = 300 scheduled → availability = 240/300 = 0.8
    const metrics = [makeMetrics({ requestsResolved: 240, requestsDropped: 60 })];
    const sla = tdc.evaluateSLA(metrics);

    expect(sla.availability.actual).toBeCloseTo(0.8, 3);
    expect(sla.availability.passed).toBe(false);
    expect(sla.allPassed).toBe(false);
  });

  it("fails latency SLA when latency exceeds threshold", () => {
    const wave = makeWave({ availabilityTarget: 0.50, maxAvgLatency: 5, minBudget: 0, penaltyPerTick: 3 });
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    const metrics = [makeMetrics({ requestsResolved: 100, avgLatency: 8 })];
    const sla = tdc.evaluateSLA(metrics);

    expect(sla.latency.actual).toBeCloseTo(8, 3);
    expect(sla.latency.passed).toBe(false);
    expect(sla.allPassed).toBe(false);
  });

  it("fails budget SLA when budget is below minimum", () => {
    const wave = makeWave({ availabilityTarget: 0.50, maxAvgLatency: 100, minBudget: 100, penaltyPerTick: 2 });
    const tdc = makeTDC(wave, 50); // start with only $50
    tdc.advancePhase();

    const metrics = [makeMetrics({ requestsResolved: 100 })];
    const sla = tdc.evaluateSLA(metrics);

    expect(sla.budget.actual).toBe(50);
    expect(sla.budget.passed).toBe(false);
    expect(sla.allPassed).toBe(false);
  });

  it("returns all-passed when no SLA defined on wave", () => {
    const wave = makeWave(undefined);
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    const metrics = [makeMetrics({ requestsResolved: 1, requestsDropped: 99 })];
    const sla = tdc.evaluateSLA(metrics);

    // No SLA targets → all targets are 0/Infinity/-Infinity → everything passes
    expect(sla.allPassed).toBe(true);
  });
});

describe("SLA gate — evaluateOutcome integration", () => {
  it("verdict is 'win' when all SLAs pass", () => {
    const wave = makeWave({ availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 2 });
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    // 290 resolved + 10 dropped = 300 scheduled; availability 96.7% > 90%.
    const metrics = [makeMetrics({ requestsResolved: 290, requestsDropped: 10, avgLatency: 2 })];
    const outcome = tdc.evaluateOutcome(metrics);

    expect(outcome.verdict).toBe("win");
    expect(outcome.slaResults).toBeDefined();
    expect(outcome.slaResults!.allPassed).toBe(true);
  });

  it("verdict is 'lose' when availability SLA fails", () => {
    const wave = makeWave({ availabilityTarget: 0.95, maxAvgLatency: 100, minBudget: 0, penaltyPerTick: 5 });
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    const metrics = [makeMetrics({ requestsResolved: 50, requestsDropped: 50 })];
    const outcome = tdc.evaluateOutcome(metrics);

    expect(outcome.verdict).toBe("lose");
    expect(outcome.slaResults!.availability.passed).toBe(false);
    expect(outcome.notes.some(n => n.includes("FAILED SLA"))).toBe(true);
  });

  it("notes include SLA details", () => {
    const wave = makeWave({ availabilityTarget: 0.90, maxAvgLatency: 5, minBudget: 0, penaltyPerTick: 2 });
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    const metrics = [makeMetrics({ requestsResolved: 100, avgLatency: 2 })];
    const outcome = tdc.evaluateOutcome(metrics);

    expect(outcome.notes.some(n => n.includes("availability"))).toBe(true);
    expect(outcome.notes.some(n => n.includes("latency"))).toBe(true);
    expect(outcome.notes.some(n => n.includes("budget"))).toBe(true);
  });

  it("falls back to legacy dropThreshold when no SLA defined", () => {
    const wave = makeWave(undefined);
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    // 10% drop rate > 5% threshold → should lose
    const metrics = [makeMetrics({ requestsResolved: 90, requestsDropped: 10 })];
    const outcome = tdc.evaluateOutcome(metrics);

    expect(outcome.verdict).toBe("lose");
  });
});

describe("SLA gate — onTick penalty", () => {
  it("deducts penalty when rolling availability is below target", () => {
    const wave = makeWave({ availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 10 });
    const tdc = makeTDC(wave, 500);
    tdc.advancePhase();

    // Simulate a state with bad metrics history
    const fakeState = {
      metricsHistory: [
        makeMetrics({ requestsResolved: 50, requestsDropped: 50 }), // 50% availability
      ],
      currentTick: 1,
    };

    tdc.onTick!(fakeState as any);

    // Budget should have been reduced by penaltyPerTick (10)
    expect(tdc.economy.getBudget()).toBe(490);
  });

  it("does not deduct penalty when availability is healthy", () => {
    const wave = makeWave({ availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 10 });
    const tdc = makeTDC(wave, 500);
    tdc.advancePhase();

    const fakeState = {
      metricsHistory: [
        makeMetrics({ requestsResolved: 95, requestsDropped: 5 }), // 95% > 90% target
      ],
      currentTick: 1,
    };

    tdc.onTick!(fakeState as any);

    expect(tdc.economy.getBudget()).toBe(500); // unchanged
  });

  it("does not deduct when not in simulate phase", () => {
    const wave = makeWave({ availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 10 });
    const tdc = makeTDC(wave, 500);
    // Still in build phase

    const fakeState = {
      metricsHistory: [
        makeMetrics({ requestsResolved: 50, requestsDropped: 50 }),
      ],
      currentTick: 1,
    };

    tdc.onTick!(fakeState as any);

    expect(tdc.economy.getBudget()).toBe(500); // unchanged — not in simulate
  });
});

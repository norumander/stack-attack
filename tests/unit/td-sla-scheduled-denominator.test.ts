/**
 * Regression tests for the "silent PASS → vacuous WIN" bug.
 *
 * Before the fix, evaluateSLA computed availability as
 *   resolved / (resolved + dropped + timedOut)
 * with a fallback to `1.0` when all three counters were zero. A topology that
 * silently dropped every request via a PROCESS-phase PASS (no downstream
 * handler for the request type) increment NONE of those counters, so the
 * denominator was 0, availability defaulted to 100%, and the wave was flagged
 * WIN despite serving nothing. The `onTick` mid-wave penalty had the same
 * `if (total === 0) return` short-circuit.
 *
 * After the fix, the denominator is `max(accountedTotal, intensity * duration)`
 * so unaccounted-for-requests (= silently dropped) count as unavailable.
 */
import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import type { TickMetrics } from "@core/types/metrics";
import type { ComponentId } from "@core/types/ids";
import { bootTDRegistry, makeRng } from "@harness/td-fixtures";

function makeWave(sla: TDWaveDefinition["sla"]): TDWaveDefinition {
  return {
    id: 1,
    name: "Silent Drop",
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
    ...(sla !== undefined ? { sla } : {}),
  };
}

function emptyTickMetrics(tick: number): TickMetrics {
  return {
    tick,
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
  };
}

function makeTDC(wave: TDWaveDefinition): TDModeController {
  const registry = bootTDRegistry();
  return new TDModeController({
    waves: [wave],
    economy: new TDEconomy({
      startingBudget: wave.startingBudget ?? 500,
      revenuePerRequestType: wave.revenuePerRequestType,
    }),
    entryPointId: "c-entry" as ComponentId,
    rng: makeRng(1),
    componentRegistry: registry,
  });
}

describe("silent-PASS → vacuous WIN regression (SLA gate)", () => {
  it("fails availability when traffic generated 300 requests but none were accounted for", () => {
    // Scheduled 300 requests, zero came back. Old bug: availability = 1.0,
    // WIN. New semantic: availability = 0/300 = 0% → FAIL.
    const wave = makeWave({
      availabilityTarget: 0.90,
      maxAvgLatency: 10,
      minBudget: 0,
      penaltyPerTick: 2,
    });
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    // 30 ticks of dead-silence: traffic was generated, counters never
    // incremented because every request vanished via PASS.
    const metrics: TickMetrics[] = [];
    for (let t = 0; t < 30; t++) metrics.push(emptyTickMetrics(t));

    const sla = tdc.evaluateSLA(metrics);
    expect(sla.availability.actual).toBe(0);
    expect(sla.availability.passed).toBe(false);
    expect(sla.allPassed).toBe(false);

    const outcome = tdc.evaluateOutcome(metrics);
    expect(outcome.verdict).toBe("lose");
  });

  it("legacy dropThreshold fallback also fails when all traffic silently vanishes", () => {
    // No SLA defined → falls through to the legacy dropThreshold check.
    // Old bug: dropRate = 0/0 → 0 < 0.05 → WIN. New: dropRate includes the
    // scheduled-vs-accounted gap and is forced to 100%.
    const wave = makeWave(undefined);
    const tdc = makeTDC(wave);
    tdc.advancePhase();

    const metrics: TickMetrics[] = [];
    for (let t = 0; t < 30; t++) metrics.push(emptyTickMetrics(t));

    const outcome = tdc.evaluateOutcome(metrics);
    expect(outcome.verdict).toBe("lose");
  });

});

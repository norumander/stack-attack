import { describe, it, expect } from "vitest";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { SimulationState } from "@core/state/simulation-state";
import type { TickMetrics } from "@core/types/metrics";
import type { ComponentId } from "@core/types/ids";

function makeFakeMetrics(overrides: Partial<TickMetrics> = {}): TickMetrics {
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

describe("SandboxModeController.getMetricsSnapshot", () => {
  it("returns zero summary for empty metricsHistory", () => {
    const ctrl = new SandboxModeController();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.ticks).toBe(0);
    expect(snap.totalProcessed).toBe(0);
    expect(snap.totalResolved).toBe(0);
    expect(snap.totalDropped).toBe(0);
    expect(snap.totalTimedOut).toBe(0);
    expect(snap.totalBackpressured).toBe(0);
    expect(snap.totalOverloaded).toBe(0);
    expect(snap.avgLatency).toBe(0);
    expect(snap.reliability).toBe(1);
    expect(snap.perTickHistory).toHaveLength(0);
  });

  it("aggregates totals correctly across multiple ticks", () => {
    const ctrl = new SandboxModeController();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    state.metricsHistory.push(
      makeFakeMetrics({ tick: 0, requestsProcessed: 10, requestsResolved: 8, requestsDropped: 2, avgLatency: 5 }),
      makeFakeMetrics({ tick: 1, requestsProcessed: 20, requestsResolved: 15, requestsDropped: 3, requestsTimedOut: 2, avgLatency: 3 }),
    );

    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.ticks).toBe(2);
    expect(snap.totalProcessed).toBe(30);
    expect(snap.totalResolved).toBe(23);
    expect(snap.totalDropped).toBe(5);
    expect(snap.totalTimedOut).toBe(2);
  });

  it("computes reliability as resolved / (resolved + dropped + timedOut)", () => {
    const ctrl = new SandboxModeController();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    state.metricsHistory.push(
      makeFakeMetrics({ requestsResolved: 80, requestsDropped: 10, requestsTimedOut: 10 }),
    );

    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.reliability).toBeCloseTo(0.8, 5);
  });

  it("reliability is 1 when no terminal requests", () => {
    const ctrl = new SandboxModeController();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    state.metricsHistory.push(
      makeFakeMetrics({ requestsResolved: 0, requestsDropped: 0, requestsTimedOut: 0 }),
    );

    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.reliability).toBe(1);
  });

  it("computes weighted average latency across ticks", () => {
    const ctrl = new SandboxModeController();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // Tick 0: 10 resolved at avg latency 2 → total latency weight = 20
    // Tick 1: 30 resolved at avg latency 6 → total latency weight = 180
    // Weighted avg = (20 + 180) / (10 + 30) = 200 / 40 = 5
    state.metricsHistory.push(
      makeFakeMetrics({ requestsResolved: 10, avgLatency: 2 }),
      makeFakeMetrics({ requestsResolved: 30, avgLatency: 6 }),
    );

    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.avgLatency).toBeCloseTo(5, 5);
  });

  it("avgLatency is 0 when no resolved requests", () => {
    const ctrl = new SandboxModeController();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    state.metricsHistory.push(
      makeFakeMetrics({ requestsResolved: 0, avgLatency: 10 }),
    );

    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.avgLatency).toBe(0);
  });

  it("perTickHistory references the same array", () => {
    const ctrl = new SandboxModeController();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    state.metricsHistory.push(makeFakeMetrics({ tick: 0 }));

    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.perTickHistory).toBe(state.metricsHistory);
  });

  it("tracks backpressured and overloaded totals", () => {
    const ctrl = new SandboxModeController();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    state.metricsHistory.push(
      makeFakeMetrics({ requestsBackpressured: 5, requestsOverloaded: 3 }),
      makeFakeMetrics({ requestsBackpressured: 7, requestsOverloaded: 2 }),
    );

    const snap = ctrl.getMetricsSnapshot(state);
    expect(snap.totalBackpressured).toBe(12);
    expect(snap.totalOverloaded).toBe(5);
  });
});

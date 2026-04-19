import { describe, it, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import {
  ComponentMetricsAggregator,
  STRESS_UTILIZATION,
  DROPPING_RECENT_THRESHOLD,
} from "../../../src/physics-td/component-metrics";
import type { SimEvent } from "@sim/types";
import type { ComponentId } from "@core/types/ids";

function makeSim(): { sim: Sim; dbId: ComponentId; srvId: ComponentId } {
  const sim = new Sim({ seed: 1 });
  const dbId = "db" as ComponentId;
  const srvId = "srv" as ComponentId;
  sim.addComponent(new SimComponent({
    id: dbId,
    capabilities: [new ProcessingCapability({ revenuePerWrite: 1, revenuePerRead: 1 })],
    capacityPerSecond: 30,
  }));
  sim.addComponent(new SimComponent({
    id: srvId,
    capabilities: [new ForwardingCapability()],
  }));
  return { sim, dbId, srvId };
}

describe("ComponentMetricsAggregator", () => {
  it("tracks cumulative drops per component from SimEvents", () => {
    const { sim, dbId, srvId } = makeSim();
    const agg = new ComponentMetricsAggregator();
    const events: SimEvent[] = [
      { kind: "drop", componentId: dbId, reason: "overloaded", count: 3 },
      { kind: "drop", componentId: dbId, reason: "overloaded", count: 2 },
      { kind: "drop", componentId: srvId, reason: "no_capability", count: 1 },
    ];
    agg.update(sim, events, 0.1);
    expect(agg.getMetricsFor(dbId).dropsTotal).toBe(5);
    expect(agg.getMetricsFor(srvId).dropsTotal).toBe(1);
  });

  it("rolls the 1s drop window so old events fall out", () => {
    const { sim, dbId } = makeSim();
    const agg = new ComponentMetricsAggregator();
    agg.update(sim, [
      { kind: "drop", componentId: dbId, reason: "r", count: 2 },
    ], 0);
    expect(agg.getMetricsFor(dbId).dropsLastSecond).toBe(2);
    // Advance past the rolling-window cutoff; old drops should fall out.
    agg.update(sim, [], 1.5);
    expect(agg.getMetricsFor(dbId).dropsLastSecond).toBe(0);
    // But cumulative total is preserved.
    expect(agg.getMetricsFor(dbId).dropsTotal).toBe(2);
  });

  it("keeps recent drops within the window", () => {
    const { sim, dbId } = makeSim();
    const agg = new ComponentMetricsAggregator();
    agg.update(sim, [
      { kind: "drop", componentId: dbId, reason: "r", count: 4 },
    ], 5.0);
    // 0.5s later — still within 1s window.
    agg.update(sim, [], 5.5);
    expect(agg.getMetricsFor(dbId).dropsLastSecond).toBe(4);
    // Just past 1s — rolled off.
    agg.update(sim, [], 6.1);
    expect(agg.getMetricsFor(dbId).dropsLastSecond).toBe(0);
  });

  it("computes utilization from bucket consumption vs effective capacity", () => {
    const { sim, dbId } = makeSim();
    const agg = new ComponentMetricsAggregator();
    // Consume 24 of 30 → 80% utilization (== STRESS_UTILIZATION).
    sim.components.get(dbId)!.bucket!.tryConsume(24);
    agg.update(sim, [], 0.1);
    const m = agg.getMetricsFor(dbId);
    expect(m.utilization).toBeCloseTo(0.8, 5);
    expect(m.stressed).toBe(true);
  });

  it("flags dropping when recent drops meet threshold", () => {
    const { sim, dbId } = makeSim();
    const agg = new ComponentMetricsAggregator();
    agg.update(sim, [
      { kind: "drop", componentId: dbId, reason: "r", count: DROPPING_RECENT_THRESHOLD },
    ], 0);
    expect(agg.getMetricsFor(dbId).dropping).toBe(true);
  });

  it("tracks processed total and average response latency from terminate + respond-delivered", () => {
    const { sim, dbId } = makeSim();
    const agg = new ComponentMetricsAggregator();
    agg.update(sim, [
      { kind: "terminate", componentId: dbId, revenue: 5, latencySeconds: 0.1, count: 2 },
      { kind: "respond-delivered", componentId: dbId, revenue: 3, latencySeconds: 0.3, count: 1 },
    ], 0);
    const m = agg.getMetricsFor(dbId);
    expect(m.processedTotal).toBe(3);
    // Average of the two event latencies.
    expect(m.avgResponseSeconds).toBeCloseTo(0.2, 5);
  });

  it("reset() clears all state", () => {
    const { sim, dbId } = makeSim();
    const agg = new ComponentMetricsAggregator();
    agg.update(sim, [
      { kind: "drop", componentId: dbId, reason: "r", count: 2 },
    ], 0);
    agg.reset();
    const m = agg.getMetricsFor(dbId);
    expect(m.dropsTotal).toBe(0);
    expect(m.dropsLastSecond).toBe(0);
  });

  it("returns zeroed metrics for unknown component", () => {
    const agg = new ComponentMetricsAggregator();
    const m = agg.getMetricsFor("nope" as ComponentId);
    expect(m.dropsTotal).toBe(0);
    expect(m.utilization).toBe(0);
    expect(m.stressed).toBe(false);
    expect(m.dropping).toBe(false);
  });

  it("STRESS_UTILIZATION is the documented threshold (0.8)", () => {
    expect(STRESS_UTILIZATION).toBe(0.8);
  });
});

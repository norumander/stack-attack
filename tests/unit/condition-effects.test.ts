import { describe, it, expect } from "vitest";
import {
  getActiveConditionEffects,
  getUpkeepMultiplier,
  getThroughputMultiplier,
  getDropProbability,
  getLatencyMultiplier,
} from "@core/engine/condition-effects";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId } from "@core/types/ids";
import type { ConditionEffect, ConditionProfile } from "@core/types/condition";

function makeComp(
  condition: number,
  profile: Partial<ConditionProfile> = {},
): Component {
  const full: ConditionProfile = {
    degradedThreshold: 0.7,
    criticalThreshold: 0.3,
    decayRate: 0.05,
    recoveryRate: 0.02,
    degradedEffects: [],
    criticalEffects: [],
    ...profile,
  };
  return new Component({
    id: "c1" as ComponentId,
    type: "test",
    name: "Test",
    description: "",
    capabilities: new Map(),
    initialTiers: new Map<CapabilityId, number>(),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: full,
    initialCondition: condition,
  });
}

describe("getActiveConditionEffects", () => {
  it("returns [] when healthy (condition above degraded threshold)", () => {
    const c = makeComp(0.9, {
      degradedEffects: [{ kind: "drop_probability", p: 0.5 }],
      criticalEffects: [{ kind: "drop_probability", p: 1.0 }],
    });
    expect(getActiveConditionEffects(c)).toEqual([]);
  });

  it("returns degradedEffects when condition equals degradedThreshold", () => {
    const degraded: ConditionEffect[] = [{ kind: "latency_multiplier", factor: 1.5 }];
    const c = makeComp(0.7, { degradedEffects: degraded });
    expect(getActiveConditionEffects(c)).toEqual(degraded);
  });

  it("returns degradedEffects when condition is between thresholds", () => {
    const degraded: ConditionEffect[] = [{ kind: "throughput_multiplier", factor: 0.5 }];
    const c = makeComp(0.5, { degradedEffects: degraded });
    expect(getActiveConditionEffects(c)).toEqual(degraded);
  });

  it("returns criticalEffects when condition equals criticalThreshold", () => {
    const critical: ConditionEffect[] = [{ kind: "drop_probability", p: 0.9 }];
    const c = makeComp(0.3, { criticalEffects: critical });
    expect(getActiveConditionEffects(c)).toEqual(critical);
  });

  it("returns criticalEffects at zero condition", () => {
    const critical: ConditionEffect[] = [{ kind: "drop_probability", p: 1.0 }];
    const c = makeComp(0, { criticalEffects: critical });
    expect(getActiveConditionEffects(c)).toEqual(critical);
  });
});

describe("getUpkeepMultiplier", () => {
  it("returns 1 when no effects", () => {
    expect(getUpkeepMultiplier(makeComp(1.0))).toBe(1);
  });

  it("returns the product of all upkeep_multiplier effects", () => {
    const c = makeComp(0.2, {
      criticalEffects: [
        { kind: "upkeep_multiplier", factor: 2 },
        { kind: "upkeep_multiplier", factor: 1.5 },
        { kind: "drop_probability", p: 0.1 },
      ],
    });
    expect(getUpkeepMultiplier(c)).toBe(3);
  });
});

describe("getThroughputMultiplier", () => {
  it("returns 1 when no effects", () => {
    expect(getThroughputMultiplier(makeComp(1.0))).toBe(1);
  });

  it("returns the product of throughput_multiplier effects", () => {
    const c = makeComp(0.5, {
      degradedEffects: [
        { kind: "throughput_multiplier", factor: 0.5 },
        { kind: "throughput_multiplier", factor: 0.5 },
      ],
    });
    expect(getThroughputMultiplier(c)).toBe(0.25);
  });
});

describe("getDropProbability", () => {
  it("returns 0 when no drop effects", () => {
    expect(getDropProbability(makeComp(1.0))).toBe(0);
  });

  it("sums drop_probability effects", () => {
    const c = makeComp(0.5, {
      degradedEffects: [
        { kind: "drop_probability", p: 0.2 },
        { kind: "drop_probability", p: 0.3 },
      ],
    });
    expect(getDropProbability(c)).toBeCloseTo(0.5, 10);
  });

  it("clamps to 1 when sum exceeds 1", () => {
    const c = makeComp(0.2, {
      criticalEffects: [
        { kind: "drop_probability", p: 0.6 },
        { kind: "drop_probability", p: 0.8 },
      ],
    });
    expect(getDropProbability(c)).toBe(1);
  });
});

describe("getLatencyMultiplier", () => {
  it("returns 1 when no latency effects", () => {
    expect(getLatencyMultiplier(makeComp(1.0))).toBe(1);
  });

  it("returns the product of latency_multiplier effects", () => {
    const c = makeComp(0.5, {
      degradedEffects: [
        { kind: "latency_multiplier", factor: 1.5 },
        { kind: "latency_multiplier", factor: 2.0 },
      ],
    });
    expect(getLatencyMultiplier(c)).toBe(3);
  });
});

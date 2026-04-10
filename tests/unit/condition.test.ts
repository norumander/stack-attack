import { describe, it, expect } from "vitest";
import type { ConditionEffect, ConditionProfile } from "@core/types/condition";

describe("ConditionEffect and ConditionProfile", () => {
  it("models each effect kind", () => {
    const effects: ConditionEffect[] = [
      { kind: "latency_multiplier", factor: 1.5 },
      { kind: "drop_probability", p: 0.25 },
      { kind: "throughput_multiplier", factor: 0.5 },
      { kind: "upkeep_multiplier", factor: 1.2 },
    ];
    expect(effects).toHaveLength(4);
  });

  it("assembles a ConditionProfile", () => {
    const profile: ConditionProfile = {
      degradedThreshold: 0.6,
      criticalThreshold: 0.3,
      decayRate: 0.1,
      recoveryRate: 0.05,
      degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
      criticalEffects: [{ kind: "drop_probability", p: 0.5 }],
    };
    expect(profile.criticalThreshold).toBe(0.3);
  });
});

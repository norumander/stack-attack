export type ConditionEffect =
  | { kind: "latency_multiplier"; factor: number }
  | { kind: "drop_probability"; p: number }
  | { kind: "throughput_multiplier"; factor: number }
  | { kind: "upkeep_multiplier"; factor: number };

export interface ConditionProfile {
  degradedThreshold: number;
  criticalThreshold: number;
  decayRate: number;
  recoveryRate: number;
  degradedEffects: ConditionEffect[];
  criticalEffects: ConditionEffect[];
}

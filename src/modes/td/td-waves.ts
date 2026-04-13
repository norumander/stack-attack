/**
 * TD-mode wave definitions. Data-only module.
 *
 * Each wave is an immutable snapshot of: traffic intensity, composition,
 * duration, TTL, available components, pass thresholds, revenue table,
 * and the payload-pool size for the cache working set.
 */
export interface TDWaveDefinition {
  readonly id: number;
  readonly name: string;
  readonly startingBudget: number;
  readonly intensity: number;
  readonly composition: ReadonlyMap<string, number>;
  readonly duration: number;
  readonly ttl: number;
  readonly availableComponents: readonly string[];
  readonly dropThreshold: number;
  readonly revenuePerRequestType: ReadonlyMap<string, number>;
  readonly maxPlacements?: number;
  readonly readKeyPoolSize?: number;
  /** SLA gate — if present, all three targets must be met to pass the wave. */
  readonly sla?: {
    readonly availabilityTarget: number;
    readonly maxAvgLatency: number;
    readonly minBudget: number;
    readonly penaltyPerTick: number;
  };
}

export const WAVE_1: TDWaveDefinition = {
  id: 1,
  name: "Launch Day",
  startingBudget: 500,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 30,
  ttl: 10,
  availableComponents: ["server", "database"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
  readKeyPoolSize: 20,
  sla: { availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 2 },
};

export const WAVE_2: TDWaveDefinition = {
  id: 2,
  name: "Users Start Signing Up",
  startingBudget: 500,
  intensity: 25,
  composition: new Map([["api_read", 0.7], ["api_write", 0.3]]),
  duration: 30,
  ttl: 10,
  availableComponents: ["server", "database"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
  readKeyPoolSize: 20,
  sla: { availabilityTarget: 0.92, maxAvgLatency: 8, minBudget: 0, penaltyPerTick: 3 },
};

export const WAVE_3: TDWaveDefinition = {
  id: 3,
  name: "Traffic Spikes",
  startingBudget: 600,
  intensity: 50,
  composition: new Map([["api_read", 0.7], ["api_write", 0.3]]),
  duration: 30,
  ttl: 8,
  availableComponents: ["server", "database", "cache", "load_balancer"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
  readKeyPoolSize: 15, // Pool=15 vs Cache capacity=10 → ~67% hit rate target
  sla: { availabilityTarget: 0.95, maxAvgLatency: 5, minBudget: 0, penaltyPerTick: 5 },
};

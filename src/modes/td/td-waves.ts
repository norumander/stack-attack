/**
 * TD-mode wave definitions. Data-only module.
 *
 * Each wave is an immutable snapshot of: traffic intensity, composition,
 * duration, TTL, available components, pass thresholds, revenue table,
 * and the payload-pool size for the cache working set.
 */
export interface TDWaveDefinition {
  readonly id: 1 | 2 | 3;
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
};

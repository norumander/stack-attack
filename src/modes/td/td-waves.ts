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
  readonly keyPoolSize?: number;
  /** SLA gate — if present, all three targets must be met to pass the wave. */
  readonly sla?: {
    readonly availabilityTarget: number;
    readonly maxAvgLatency: number;
    readonly minBudget: number;
    readonly penaltyPerTick: number;
  };
  /** Override default connection bandwidth (300) in tryConnect for high-intensity waves. */
  readonly connectionBandwidth?: number;
  /**
   * Mid-wave chaos events. Tick is wave-relative (0 = first simulate tick).
   * Uses symbolic targeting: chaosKind + targetType + targetIndex are resolved
   * at runtime by the TDModeController against the live topology.
   */
  readonly chaosSchedule?: readonly {
    readonly tick: number;
    readonly chaosKind: "component_failure" | "zone_outage";
    readonly targetType?: string;
    readonly targetIndex?: number;
    readonly zone?: string;
    readonly durationTicks?: number;
  }[];
  /** Stream request config for waves with stream traffic. */
  readonly streamConfig?: {
    readonly duration: number;
    readonly bandwidth: number;
  };
  /** Multi-zone topology override for geographic waves. */
  readonly zoneTopology?: {
    readonly zones: readonly string[];
    readonly pairLatency: ReadonlyMap<string, number>;
  };
  /** Zone distribution for traffic generation (zone name → weight 0-1). */
  readonly zoneDistribution?: ReadonlyMap<string, number>;
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
  keyPoolSize: 20,
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
  keyPoolSize: 20,
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
  keyPoolSize: 10, // pool ≤ capacity → near-100% hit rate. Wave 3 is the player's first encounter with Cache; the rescue should feel powerful, not marginal. The "imperfect cache" lesson comes in later waves if/when we want to teach it.
  sla: { availabilityTarget: 0.95, maxAvgLatency: 5, minBudget: 0, penaltyPerTick: 5 },
};

export const WAVE_4: TDWaveDefinition = {
  id: 4,
  name: "Marketing Adds Images",
  startingBudget: 700,
  intensity: 80,
  composition: new Map([
    ["api_read", 0.4],
    ["api_write", 0.2],
    ["static_asset", 0.4],
  ]),
  duration: 30,
  ttl: 8,
  availableComponents: ["server", "database", "cache", "load_balancer", "cdn"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
  ]),
  keyPoolSize: 10, // keyPoolSize: 10 ≤ Cache capacity 10 → ~100% CDN hit rate (static assets + reads absorbed)
  sla: {
    availabilityTarget: 0.92,
    maxAvgLatency: 6,
    minBudget: 0,
    penaltyPerTick: 5,
  },
};

export const WAVE_5: TDWaveDefinition = {
  id: 5,
  name: "The Authentication Wall",
  startingBudget: 800,
  intensity: 150,
  composition: new Map([
    ["api_read", 0.3],
    ["api_write", 0.2],
    ["static_asset", 0.3],
    ["auth_required", 0.2],
  ]),
  duration: 30,
  ttl: 8,
  availableComponents: [
    "server",
    "database",
    "cache",
    "load_balancer",
    "cdn",
    "api_gateway",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
  ]),
  keyPoolSize: 15,
  sla: {
    availabilityTarget: 0.92,
    maxAvgLatency: 7,
    minBudget: 0,
    penaltyPerTick: 5,
  },
};

export const WAVE_6: TDWaveDefinition = {
  id: 6,
  name: "Async Workloads",
  startingBudget: 1000,
  intensity: 250,
  composition: new Map([
    ["api_read", 0.25],
    ["api_write", 0.15],
    ["static_asset", 0.25],
    ["auth_required", 0.15],
    ["batch", 0.20],
  ]),
  duration: 30,
  ttl: 12,
  availableComponents: [
    "server", "database", "cache", "load_balancer", "cdn", "api_gateway",
    "queue", "worker",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
    ["batch", 5],
  ]),
  keyPoolSize: 15,
  connectionBandwidth: 500,
  sla: {
    availabilityTarget: 0.93,
    maxAvgLatency: 7,
    minBudget: 0,
    penaltyPerTick: 6,
  },
};

export const WAVE_7: TDWaveDefinition = {
  id: 7,
  name: "The Outage",
  startingBudget: 1200,
  intensity: 350,
  composition: new Map([
    ["api_read", 0.25],
    ["api_write", 0.15],
    ["static_asset", 0.25],
    ["auth_required", 0.15],
    ["batch", 0.20],
  ]),
  duration: 30,
  ttl: 12,
  availableComponents: [
    "server", "database", "cache", "load_balancer", "cdn", "api_gateway",
    "queue", "worker", "circuit_breaker",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
    ["batch", 5],
  ]),
  keyPoolSize: 15,
  connectionBandwidth: 600,
  chaosSchedule: [
    // Tick 15: one server goes down (the real outage)
    { tick: 15, chaosKind: "component_failure", targetType: "server", targetIndex: 0 },
    // Tick 22: second hit — same server fails again after partial recovery
    { tick: 22, chaosKind: "component_failure", targetType: "server", targetIndex: 0 },
  ],
  sla: {
    availabilityTarget: 0.90,
    maxAvgLatency: 8,
    minBudget: -200,
    penaltyPerTick: 8,
  },
};

export const WAVE_8: TDWaveDefinition = {
  id: 8,
  name: "Video Launch",
  startingBudget: 1500,
  intensity: 500,
  composition: new Map([
    ["api_read", 0.20],
    ["api_write", 0.10],
    ["static_asset", 0.15],
    ["auth_required", 0.10],
    ["batch", 0.15],
    ["stream", 0.30],
  ]),
  duration: 40,
  ttl: 15,
  availableComponents: [
    "server", "database", "cache", "load_balancer", "cdn", "api_gateway",
    "queue", "worker", "circuit_breaker", "streaming_media_server", "blob_storage",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
    ["batch", 5],
    ["stream", 8],
  ]),
  keyPoolSize: 15,
  connectionBandwidth: 700,
  streamConfig: {
    duration: 20,
    bandwidth: 3,
  },
  sla: {
    availabilityTarget: 0.92,
    maxAvgLatency: 8,
    minBudget: 0,
    penaltyPerTick: 7,
  },
};

export const WAVE_9: TDWaveDefinition = {
  id: 9,
  name: "Going Global",
  startingBudget: 2500,
  intensity: 800,
  composition: new Map([
    ["api_read", 0.25],
    ["api_write", 0.10],
    ["static_asset", 0.15],
    ["auth_required", 0.10],
    ["batch", 0.10],
    ["stream", 0.30],
  ]),
  duration: 40,
  ttl: 15,
  availableComponents: [
    "server", "database", "cache", "load_balancer", "cdn", "api_gateway",
    "queue", "worker", "circuit_breaker", "streaming_media_server", "blob_storage",
    "dns_gtm",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
    ["batch", 5],
    ["stream", 8],
  ]),
  keyPoolSize: 15,
  connectionBandwidth: 800,
  streamConfig: {
    duration: 20,
    bandwidth: 3,
  },
  zoneTopology: {
    zones: ["na-east", "eu-west", "ap-south"],
    pairLatency: new Map([
      ["ap-south|na-east", 5],
      ["eu-west|na-east", 3],
      ["ap-south|eu-west", 4],
    ]),
  },
  zoneDistribution: new Map([
    ["na-east", 0.40],
    ["eu-west", 0.35],
    ["ap-south", 0.25],
  ]),
  sla: {
    availabilityTarget: 0.90,
    maxAvgLatency: 4,
    minBudget: 0,
    penaltyPerTick: 8,
  },
};

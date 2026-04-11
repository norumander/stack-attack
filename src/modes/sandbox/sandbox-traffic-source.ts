import type { TrafficSource } from "../../core/mode/traffic-source.js";
import type { Request } from "../../core/types/request.js";
import type { ComponentId, RequestId } from "../../core/types/ids.js";

export type TrafficPattern = "steady" | "spike" | "sine" | "ramp" | "burst";

export interface RequestTypeWeight {
  readonly type: string;
  readonly weight: number;
}

export interface SandboxTrafficConfig {
  readonly targetEntryPointId: ComponentId;
  readonly requestType: string;
  readonly intensity: number;
  readonly ttl?: number;
  readonly originZone?: string | null;
  readonly pattern: TrafficPattern;
  /** Ticks to reach full intensity (ramp pattern, default 50). */
  readonly rampDuration?: number;
  /** Ticks at peak intensity (burst pattern, default 3). */
  readonly burstDuration?: number;
  /** Full cycle length in ticks (burst pattern, default 30). */
  readonly burstPeriod?: number;
  /** Peak multiplier applied to intensity (burst pattern, default 5). */
  readonly burstMultiplier?: number;
  /**
   * Weighted distribution of request types. When set, each generated request
   * picks a type deterministically based on counter % totalWeight. When unset,
   * all requests use the single `requestType` field.
   */
  readonly requestTypeDistribution?: readonly RequestTypeWeight[];
}

const DEFAULT_TTL = 10;
const SPIKE_PERIOD = 10;
const SPIKE_DURATION = 3;
const SINE_PERIOD = 20;
const DEFAULT_RAMP_DURATION = 50;
const DEFAULT_BURST_DURATION = 3;
const DEFAULT_BURST_PERIOD = 30;
const DEFAULT_BURST_MULTIPLIER = 5;

/**
 * Player-configurable traffic source for Sandbox mode.
 *
 * Supports five patterns:
 * - "steady": constant `intensity` requests per tick
 * - "spike": baseline intensity, doubles every 10th tick for 3 ticks
 * - "sine": oscillates between 0.5x and 1.5x intensity on a 20-tick cycle
 * - "ramp": linear growth from 0 to `intensity` over `rampDuration` ticks, then holds
 * - "burst": emits intensity * multiplier for `burstDuration` ticks, then 0 for remainder of period
 */
let nextSourceId = 0;

export class SandboxTrafficSource implements TrafficSource {
  readonly targetEntryPointId: ComponentId;
  private readonly sourceId: number;
  private _config: SandboxTrafficConfig;
  private counter = 0;
  private _sortedDistribution: RequestTypeWeight[] | null = null;
  private _totalWeight = 0;

  constructor(config: SandboxTrafficConfig) {
    this.sourceId = nextSourceId++;
    this._config = config;
    this.targetEntryPointId = config.targetEntryPointId;
    this.buildDistribution(config);
  }

  get config(): SandboxTrafficConfig {
    return this._config;
  }

  reconfigure(config: SandboxTrafficConfig): void {
    this._config = config;
    this.buildDistribution(config);
  }

  generate(tick: number): Request[] {
    const count = this.getIntensityForTick(tick);
    const out: Request[] = [];
    for (let i = 0; i < count; i++) {
      this.counter += 1;
      out.push({
        id: `sandbox-s${this.sourceId}-r-${this.counter}` as RequestId,
        parentId: null,
        type: this.pickRequestType(this.counter),
        payload: null,
        origin: this._config.targetEntryPointId,
        createdAt: tick,
        ttl: this._config.ttl ?? DEFAULT_TTL,
        originZone: this._config.originZone ?? null,
        streamDuration: null,
        streamBandwidth: null,
      });
    }
    return out;
  }

  private pickRequestType(index: number): string {
    if (!this._sortedDistribution || this._sortedDistribution.length === 0) {
      return this._config.requestType;
    }
    const bucket = index % this._totalWeight;
    let cumulative = 0;
    for (const entry of this._sortedDistribution) {
      cumulative += entry.weight;
      if (bucket < cumulative) return entry.type;
    }
    // Fallback (shouldn't reach here if weights are valid)
    return this._config.requestType;
  }

  private buildDistribution(config: SandboxTrafficConfig): void {
    if (!config.requestTypeDistribution || config.requestTypeDistribution.length === 0) {
      this._sortedDistribution = null;
      this._totalWeight = 0;
      return;
    }
    // Sort by weight descending for deterministic bucket assignment
    this._sortedDistribution = [...config.requestTypeDistribution].sort(
      (a, b) => b.weight - a.weight,
    );
    this._totalWeight = this._sortedDistribution.reduce((sum, e) => sum + e.weight, 0);
  }

  private getIntensityForTick(tick: number): number {
    const base = this._config.intensity;
    switch (this._config.pattern) {
      case "steady":
        return base;
      case "spike": {
        const posInCycle = tick % SPIKE_PERIOD;
        return posInCycle < SPIKE_DURATION ? base * 2 : base;
      }
      case "sine": {
        const phase = (tick % SINE_PERIOD) / SINE_PERIOD;
        const multiplier = 1 + 0.5 * Math.sin(phase * 2 * Math.PI);
        return Math.round(base * multiplier);
      }
      case "ramp": {
        const duration = this._config.rampDuration ?? DEFAULT_RAMP_DURATION;
        if (tick >= duration) return base;
        return Math.floor(base * (tick / duration));
      }
      case "burst": {
        const burstDur = this._config.burstDuration ?? DEFAULT_BURST_DURATION;
        const period = this._config.burstPeriod ?? DEFAULT_BURST_PERIOD;
        const multiplier = this._config.burstMultiplier ?? DEFAULT_BURST_MULTIPLIER;
        const posInCycle = tick % period;
        return posInCycle < burstDur ? Math.round(base * multiplier) : 0;
      }
    }
  }
}

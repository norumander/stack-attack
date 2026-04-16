import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

const CACHEABLE_TYPES = new Set(["api_read", "static_asset"]);

const CAPACITY_PER_TIER = [0, 10, 50, 100] as const;

export interface CachingCapabilityOptions {
  /**
   * Optional restriction of which request types this capability instance
   * will cache. When omitted, defaults to all cacheable types
   * (`api_read`, `static_asset`) — preserves sandbox/general backward
   * compatibility. When specified, canHandle returns false for any type
   * outside this set.
   */
  cacheableTypes?: ReadonlySet<string>;
}

/**
 * INTERCEPT-phase capability implementing an LRU cache.
 *
 * Cache keys are derived from the request's payload (the working-set
 * identifier) scoped by request type — two requests with the same type
 * and payload share a cache entry regardless of their request id. When
 * payload is null, the request id is used as the key, which makes each
 * unique-id request behave as a unique cache entry (preserves unit test
 * semantics).
 *
 * Hit → RESPOND (short-circuit, request never reaches server).
 * Miss → PASS (request continues downstream, key is cached for future hits).
 *
 * Tier 1: capacity 10. Tier 2: capacity 50. Tier 3: capacity 100.
 */
export class CachingCapability implements Capability {
  readonly phase = "INTERCEPT" as const;

  /** Maps composite key (type:slot) → last access tick */
  private cache = new Map<string, number>();
  private hits = 0;
  private misses = 0;
  private hitsByType = new Map<string, number>();
  private missesByType = new Map<string, number>();
  private readonly cacheableTypes: ReadonlySet<string>;

  constructor(readonly id: CapabilityId, options: CachingCapabilityOptions = {}) {
    this.cacheableTypes = options.cacheableTypes ?? CACHEABLE_TYPES;
  }

  canHandle(requestType: string): boolean {
    return this.cacheableTypes.has(requestType);
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    const tier = context.effectiveTiers.get(this.id) ?? 1;
    const capacity = CAPACITY_PER_TIER[tier] ?? CAPACITY_PER_TIER[1]!;
    // Cache key is the request's payload (the working set identifier) scoped
    // by type. Falls back to request.id when payload is null — this makes
    // unique-id requests behave like unique keys, which is what unit tests
    // assume when they pass `payload: null` and use distinct ids.
    const keyPart =
      request.payload !== null && request.payload !== undefined
        ? String(request.payload)
        : (request.id as string);
    const cacheKey = `${request.type}:${keyPart}`;

    if (this.cache.has(cacheKey)) {
      // Cache hit — update access time and RESPOND
      this.cache.set(cacheKey, context.currentTick);
      this.hits += 1;
      this.hitsByType.set(
        request.type,
        (this.hitsByType.get(request.type) ?? 0) + 1,
      );
      return {
        outcome: { kind: "RESPOND" },
        sideEffects: [],
        events: [{
          tick: context.currentTick,
          componentId: context.componentId,
          capabilityId: this.id,
          connectionId: null,
          type: "CACHED_HIT" as const,
          latencyAdded: 0,
        }],
      };
    }

    // Cache miss — evict LRU if at capacity, store new entry, PASS
    if (this.cache.size >= capacity) {
      this.evictLRU();
    }
    this.cache.set(cacheKey, context.currentTick);
    this.misses += 1;
    this.missesByType.set(
      request.type,
      (this.missesByType.get(request.type) ?? 0) + 1,
    );

    return {
      outcome: { kind: "PASS" },
      sideEffects: [],
      events: [{
        tick: context.currentTick,
        componentId: context.componentId,
        capabilityId: this.id,
        connectionId: null,
        type: "CACHED_MISS" as const,
        latencyAdded: 0,
      }],
    };
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTick = Infinity;
    for (const [key, tick] of this.cache) {
      if (tick < oldestTick) {
        oldestTick = tick;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.cache.delete(oldestKey);
    }
  }

  getUpkeepCost(tier: number): number {
    return tier * 3;
  }

  getStats(): CapabilityStats {
    const total = this.hits + this.misses;
    const hitRateByType: Record<
      string,
      { hits: number; misses: number; hitRate: number }
    > = {};
    const allTypes = new Set<string>([
      ...this.hitsByType.keys(),
      ...this.missesByType.keys(),
    ]);
    for (const type of allTypes) {
      const h = this.hitsByType.get(type) ?? 0;
      const m = this.missesByType.get(type) ?? 0;
      hitRateByType[type] = {
        hits: h,
        misses: m,
        hitRate: h + m > 0 ? h / (h + m) : 0,
      };
    }
    return {
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRateByType,
    };
  }
}

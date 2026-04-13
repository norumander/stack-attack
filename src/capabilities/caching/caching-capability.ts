import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult, PrimaryOutcome } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * INTERCEPT-phase cache keyed on stringified request.payload. Hit returns
 * RESPOND with CACHED_HIT event. Miss returns PASS (pipeline continues
 * to PROCESS, which typically runs ForwardingCapability to the egress).
 *
 * Cache-on-miss shortcut: the miss path inserts the key immediately. This
 * is observationally correct for homogeneous workloads (Stage 3a) because
 * every api_read returns the same response — it would fail for real
 * heterogeneous payloads, and a proper write-back flow is deferred.
 */
export class CachingCapability implements Capability {
  readonly phase = "INTERCEPT" as const;
  private readonly cache = new Map<string, { tick: number }>();
  private readonly capacity: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(
    readonly id: CapabilityId,
    options: { capacity?: number } = {},
  ) {
    this.capacity = options.capacity ?? 10;
  }

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    if (request.type !== "api_read") {
      return { outcome: { kind: "PASS" } as PrimaryOutcome, sideEffects: [], events: [] };
    }

    const key = String(request.payload);

    if (this.cache.has(key)) {
      this.hitCount += 1;
      return {
        outcome: { kind: "RESPOND" },
        sideEffects: [],
        events: [
          {
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "CACHED_HIT",
            latencyAdded: 0,
          },
        ],
      };
    }

    // Miss: insert (cache-on-miss shortcut — see class docstring) and PASS.
    if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { tick: context.currentTick });
    this.missCount += 1;

    return {
      outcome: { kind: "PASS" } as PrimaryOutcome,
      sideEffects: [],
      events: [],
    };
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 3, 2: 6, 3: 12 };
    return table[tier] ?? 3;
  }

  getStats(): CapabilityStats {
    return { hitCount: this.hitCount, missCount: this.missCount };
  }
}

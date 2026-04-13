import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * INTERCEPT-phase capability implementing a token-bucket rate limiter.
 * Tokens refill each tick based on tier. Excess requests are DROPped.
 * Tier 1: 20 tokens/tick. Tier 2: 40. Tier 3: 80.
 */
export class RateLimitCapability implements Capability {
  readonly phase = "INTERCEPT" as const;

  private tokensRemaining = 0;
  private totalDropped = 0;
  private lastTier = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    const tier = context.effectiveTiers.get(this.id) ?? 1;
    // Refill on first call of a new tier (or first call of tick after reset)
    if (this.lastTier !== tier) {
      this.tokensRemaining = tier * 20;
      this.lastTier = tier;
    }

    if (this.tokensRemaining > 0) {
      this.tokensRemaining -= 1;
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    this.totalDropped += 1;
    return {
      outcome: { kind: "DROP", reason: "rate_limited" },
      sideEffects: [],
      events: [],
    };
  }

  getUpkeepCost(tier: number): number {
    return tier * 2;
  }

  getStats(): CapabilityStats {
    return {
      tokensRemaining: this.tokensRemaining,
      totalDropped: this.totalDropped,
    };
  }

  resetPerTickState(): void {
    // Refill tokens at the start of each tick
    this.tokensRemaining = this.lastTier * 20;
  }
}

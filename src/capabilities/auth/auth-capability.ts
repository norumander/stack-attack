import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * INTERCEPT-phase capability for authentication/authorization.
 * Handles auth_required requests efficiently at the edge.
 * Non-auth requests pass through immediately.
 * Tier 1: API key validation. Tier 2: JWT/OAuth (faster).
 */
export class AuthCapability implements Capability {
  readonly phase = "INTERCEPT" as const;

  private authProcessed = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    // Non-auth requests pass through
    if (request.type !== "auth_required") {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    const tier = context.effectiveTiers.get(this.id) ?? 1;
    this.authProcessed += 1;

    // Auth validated — continue to processing
    // Tier 2 has zero overhead (local JWT validation vs tier 1 remote API key check)
    const latency = tier >= 2 ? 0 : 1;

    return {
      outcome: { kind: "PASS" },
      sideEffects: [],
      events: latency > 0
        ? [{
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "PROCESSED" as const,
            latencyAdded: latency,
          }]
        : [],
    };
  }

  getUpkeepCost(tier: number): number {
    return tier * 2;
  }

  getStats(): CapabilityStats {
    return { authProcessed: this.authProcessed };
  }

  resetPerTickState(): void {
    this.authProcessed = 0;
  }
}

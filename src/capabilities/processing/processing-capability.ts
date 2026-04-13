import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * Production ProcessingCapability — handles api_read requests, returns RESPOND.
 * Emits a PROCESSED RequestEvent so the integration test helper can count
 * reads handled per component. (The engine does NOT emit PROCESSED events
 * itself — they're capability-level accounting.)
 * Declares getThroughputPerTick so componentThroughputPerTick returns a bounded
 * number (required for Stage 3a's Wave 3 lone-server failure mode).
 *
 * Replaces the Stage 1 test stub. Tests that need FORWARD/RESPOND-on-any-type
 * behavior should use TestForwardingCapability/RespondingCapability from the
 * test harness instead.
 */
export class ProcessingCapability implements Capability {
  readonly phase = "PROCESS" as const;
  private processedCount = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "api_read";
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    this.processedCount += 1;
    return {
      outcome: { kind: "RESPOND" },
      sideEffects: [],
      events: [
        {
          tick: context.currentTick,
          componentId: context.componentId,
          capabilityId: this.id,
          connectionId: null,
          type: "PROCESSED",
          latencyAdded: 1,
        },
      ],
    };
  }

  getThroughputPerTick(tier: number): number {
    // Tuning target: lone Server at T1 must fail Wave 3 (50 req/tick mixed),
    // AND Wave 3 cache rescue must have condition-decay headroom so a
    // transient cache miss-rate spike doesn't cascade. Server =
    // Processing(20) + Forwarding(12) = 32 budget. Lone-server Wave 3:
    // 32 vs 50 → 36% drops → loses. Cache rescue Wave 3: ~27 effective
    // demand (12 missed reads + 15 writes) vs 32 budget → 5/tick headroom.
    const table: Record<number, number> = { 1: 20, 2: 35, 3: 60 };
    return table[tier] ?? 20;
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 2, 2: 5, 3: 10 };
    return table[tier] ?? 2;
  }

  getStats(): CapabilityStats {
    return { processedCount: this.processedCount };
  }
}

import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

export interface ForwardingCapabilityOptions {
  readonly handledTypes: readonly string[];
  /**
   * Per-tier throughput contribution. Configurable per-instance so that
   * e.g. Server's Forwarding (writes only) can be small (12) while LB's
   * Forwarding (all traffic) can be large (60). Default: 20 per tier.
   */
  readonly throughputPerTier?: number;
}

/**
 * Production capability that produces a FORWARD outcome for requests whose
 * type is in the configured handledTypes list. Used by Server (writes),
 * Cache (read misses), and LoadBalancer (all traffic) to move requests
 * to egress connections.
 *
 * Emits a FORWARDED RequestEvent at the source component (with the
 * capability's own `capabilityId` attached). The engine ALSO emits a
 * FORWARDED event at the target component when it delivers the request —
 * that one has `capabilityId: null`. Integration tests distinguish the
 * two: source-side forwards are events where `capabilityId !== null`.
 *
 * The engine does not auto-forward when a component's PROCESS phase produces
 * PASS (no matching capability); requests in that state are silently dropped
 * by deliverStaged. ForwardingCapability is the explicit primitive for
 * producing the FORWARD outcome.
 */
export class ForwardingCapability implements Capability {
  readonly phase = "PROCESS" as const;
  private forwardedCount = 0;
  private readonly handledTypes: ReadonlySet<string>;
  private readonly throughputPerTier: number;

  constructor(
    readonly id: CapabilityId,
    options: ForwardingCapabilityOptions,
  ) {
    this.handledTypes = new Set(options.handledTypes);
    this.throughputPerTier = options.throughputPerTier ?? 20;
  }

  canHandle(requestType: string): boolean {
    return this.handledTypes.has(requestType);
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    this.forwardedCount += 1;
    return {
      outcome: { kind: "FORWARD" },
      sideEffects: [],
      events: [
        {
          tick: context.currentTick,
          componentId: context.componentId,
          capabilityId: this.id,
          connectionId: null,
          type: "FORWARDED",
          latencyAdded: 0,
        },
      ],
    };
  }

  getThroughputPerTick(tier: number): number {
    return this.throughputPerTier * tier;
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 1, 2: 2, 3: 4 };
    return table[tier] ?? 1;
  }

  getStats(): CapabilityStats {
    return { forwardedCount: this.forwardedCount };
  }
}

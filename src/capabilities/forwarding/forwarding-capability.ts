import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

export interface ForwardingCapabilityOptions {
  /**
   * Optional list of request types this instance handles. When omitted,
   * the capability accepts every request type — the default used by the
   * sandbox dashboard and intermediary components (LB, API Gateway, CDN,
   * Circuit Breaker, DNS/GTM, Client).
   */
  readonly handledTypes?: readonly string[];
  /**
   * When set, enables a per-tier throughput cap of `throughputPerTier * tier`.
   * When omitted, `getThroughputPerTick` is undefined and the capability
   * contributes no bound (unbounded throughput — the intermediary default).
   * TD mode's Server uses `12` for writes; Cache and LoadBalancer use `55`
   * so they can handle Wave 3's 50 req/tick.
   */
  readonly throughputPerTier?: number;
  /**
   * When true, emits a source-side FORWARDED RequestEvent with
   * `capabilityId: this.id` so integration tests can distinguish it from
   * the engine's target-side FORWARDED event (which has `capabilityId: null`).
   * Default: false.
   */
  readonly emitForwardedEvent?: boolean;
}

/**
 * PROCESS-phase capability that forwards requests to an egress connection.
 *
 * Default behavior (no options): unconditional forwarder, unbounded
 * throughput, no event emission, zero upkeep. Intermediary components
 * (LB, API Gateway, CDN, Circuit Breaker, DNS/GTM, Client) use this
 * default for pass-through.
 *
 * Optional behavior (with options): restrict handled types, cap
 * throughput per tier, or emit source-side FORWARDED events. Used by
 * TD mode's Server (writes only, bounded), Cache (all traffic, bounded),
 * and LoadBalancer (all traffic, bounded) to shape wave-level behavior.
 *
 * Note: the engine does not auto-forward when a component's PROCESS
 * phase produces PASS (no matching capability). ForwardingCapability is
 * the explicit primitive for producing the FORWARD outcome.
 */
export class ForwardingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  private forwardedCount = 0;
  private readonly handledTypes: ReadonlySet<string> | null;
  private readonly throughputPerTier: number | null;
  private readonly emitForwardedEvent: boolean;

  constructor(
    readonly id: CapabilityId,
    options: ForwardingCapabilityOptions = {},
  ) {
    this.handledTypes = options.handledTypes
      ? new Set(options.handledTypes)
      : null;
    this.throughputPerTier = options.throughputPerTier ?? null;
    this.emitForwardedEvent = options.emitForwardedEvent ?? false;
    if (this.throughputPerTier !== null) {
      const perTier = this.throughputPerTier;
      this.getThroughputPerTick = (tier: number) => tier * perTier;
    }
  }

  /**
   * Optional; only defined when `throughputPerTier` is configured. Matches
   * the `Capability.getThroughputPerTick?` contract — omitting it signals
   * unbounded throughput to `componentThroughputPerTick`.
   */
  getThroughputPerTick?: (tier: number) => number;

  canHandle(requestType: string): boolean {
    if (this.handledTypes === null) return true;
    return this.handledTypes.has(requestType);
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    this.forwardedCount += 1;
    const events = this.emitForwardedEvent
      ? [
          {
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "FORWARDED" as const,
            latencyAdded: 0,
          },
        ]
      : [];
    return { outcome: { kind: "FORWARD" }, sideEffects: [], events };
  }

  getUpkeepCost(_tier: number): number {
    return 0;
  }

  getStats(): CapabilityStats {
    return { forwardedCount: this.forwardedCount };
  }
}

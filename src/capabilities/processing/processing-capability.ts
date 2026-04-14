import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

export interface ProcessingCapabilityOptions {
  /**
   * When set, restricts `canHandle` to only the listed request types.
   * Used by TD mode's Server to handle reads only (writes fall through
   * to `ForwardingCapability`). Default: undefined → accept all types.
   */
  handledTypes?: readonly string[];
  /**
   * When set, overrides the default `tier * 25` throughput. TD mode's
   * Server uses `throughputPerTier: 20` so total Server budget
   * (Processing + Forwarding) stays below Wave 3's 50 req/tick demand.
   */
  throughputPerTier?: number;
  /**
   * When true, emits a PROCESSED RequestEvent on every process() call
   * so integration tests can count reads handled per component. The
   * engine does not emit PROCESSED events itself — capabilities do.
   * Default: false.
   */
  emitProcessedEvent?: boolean;
  /**
   * Per-type latency penalty in ticks, added on top of the base latency 1
   * when emitting PROCESSED events. Used by TD mode's Server to make
   * `auth_required` expensive — the player feels "Server can serve auth,
   * but it's so slow my SLA fails." Default: empty (no penalties).
   */
  typeLatencyPenalty?: Readonly<Record<string, number>>;
}

/**
 * PROCESS-phase capability for general-purpose request processing.
 * The workhorse capability on Server components.
 *
 * Default behavior is `RESPOND` on every handled request. `handledTypes`
 * narrows which types `canHandle` accepts; `throughputPerTier` overrides
 * the default `tier * 25` cap; `emitProcessedEvent` opts into per-process
 * PROCESSED events so integration tests can count handled requests.
 */
export class ProcessingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  private processedThisTick = 0;
  private readonly handledTypes: ReadonlySet<string> | null;
  private readonly throughputPerTier: number;
  private readonly emitProcessedEvent: boolean;
  private readonly typeLatencyPenalty: Readonly<Record<string, number>>;

  constructor(
    readonly id: CapabilityId,
    options: ProcessingCapabilityOptions = {},
  ) {
    this.handledTypes = options.handledTypes
      ? new Set(options.handledTypes)
      : null;
    this.throughputPerTier = options.throughputPerTier ?? 25;
    this.emitProcessedEvent = options.emitProcessedEvent ?? false;
    this.typeLatencyPenalty = options.typeLatencyPenalty ?? {};
  }

  canHandle(requestType: string): boolean {
    if (this.handledTypes === null) return true;
    return this.handledTypes.has(requestType);
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    this.processedThisTick += 1;

    const penalty = this.typeLatencyPenalty[request.type] ?? 0;
    const events = this.emitProcessedEvent
      ? [
          {
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "PROCESSED" as const,
            latencyAdded: 1 + penalty,
          },
        ]
      : [];

    return { outcome: { kind: "RESPOND" }, sideEffects: [], events };
  }

  getThroughputPerTick(tier: number): number {
    return tier * this.throughputPerTier;
  }

  getUpkeepCost(tier: number): number {
    return tier * 3;
  }

  getStats(): CapabilityStats {
    return { processedThisTick: this.processedThisTick };
  }

  resetPerTickState(): void {
    this.processedThisTick = 0;
  }
}

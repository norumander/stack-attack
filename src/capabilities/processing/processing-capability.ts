import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult, PrimaryOutcome } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

export interface ProcessingCapabilityOptions {
  /**
   * Test-only override. When set, process() always returns this outcome
   * regardless of request type, preserving backward compatibility with
   * all Stage 1/2 tests and the dashboard topologies.
   */
  outcomeKind?: "PASS" | "RESPOND" | "FORWARD";
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
}

/**
 * PROCESS-phase capability for general-purpose request processing.
 * The workhorse capability on Server components.
 *
 * Stage 3 upgrade: adds getThroughputPerTick (tier * 25 default) and
 * request-type-aware processing. Backward compatible with the
 * outcomeKind test override.
 *
 * Stage 3a extension: optional `handledTypes`, `throughputPerTier`, and
 * `emitProcessedEvent` options so the TD-mode Server can run reads only
 * at a specific throughput cap and emit events for integration tests
 * that count "who handled this request."
 */
export class ProcessingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  private processedThisTick = 0;
  private readonly handledTypes: ReadonlySet<string> | null;
  private readonly throughputPerTier: number;
  private readonly emitProcessedEvent: boolean;

  constructor(
    readonly id: CapabilityId,
    private readonly options: ProcessingCapabilityOptions = {},
  ) {
    this.handledTypes = options.handledTypes
      ? new Set(options.handledTypes)
      : null;
    this.throughputPerTier = options.throughputPerTier ?? 25;
    this.emitProcessedEvent = options.emitProcessedEvent ?? false;
  }

  canHandle(requestType: string): boolean {
    if (this.handledTypes === null) return true;
    return this.handledTypes.has(requestType);
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    this.processedThisTick += 1;

    // Backward-compatible override for tests
    if (this.options.outcomeKind !== undefined) {
      const kind = this.options.outcomeKind;
      const outcome: PrimaryOutcome =
        kind === "RESPOND"
          ? { kind: "RESPOND" }
          : kind === "FORWARD"
            ? { kind: "FORWARD" }
            : { kind: "PASS" };
      return { outcome, sideEffects: [], events: [] };
    }

    const events = this.emitProcessedEvent
      ? [
          {
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "PROCESSED" as const,
            latencyAdded: 1,
          },
        ]
      : [];

    // Stage 3: default behavior — RESPOND for handled requests
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

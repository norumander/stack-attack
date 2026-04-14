import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

export interface StorageCapabilityOptions {
  /**
   * Per-tier throughput contribution. Default: 5 (general-purpose capability
   * library's base for the sandbox dashboard). TD integration tests override
   * this to 25 via `buildDatabase` so Wave 3's 15 writes/tick do not make
   * Database the bottleneck — the Server must be the bottleneck to preserve
   * the learning arc.
   */
  throughputPerTier?: number;
  /**
   * When true, emits a PROCESSED RequestEvent on every process() call so
   * integration tests can count writes handled per component. The engine
   * does not emit PROCESSED events — capabilities do. Default: false.
   */
  emitProcessedEvent?: boolean;
  /**
   * Which request types this storage accepts. Default: both `api_read` and
   * `api_write` (sandbox/legacy). TD mode passes `["api_write"]` so a naked
   * Database wired directly under a Client cannot bypass the Server tier
   * and trivially win Wave 1 — the Server is the sole api_read primitive in
   * the TD learning arc.
   */
  handledTypes?: readonly string[];
}

/**
 * PROCESS-phase capability for structured data persistence.
 * Handles api_write and api_read. Slower throughput than ProcessingCapability
 * but required for write operations.
 */
export class StorageCapability implements Capability {
  readonly phase = "PROCESS" as const;

  private writesProcessed = 0;
  private readsProcessed = 0;
  private readonly throughputPerTier: number;
  private readonly emitProcessedEvent: boolean;
  private readonly handledTypes: ReadonlySet<string>;

  constructor(
    readonly id: CapabilityId,
    options: StorageCapabilityOptions = {},
  ) {
    this.throughputPerTier = options.throughputPerTier ?? 5;
    this.emitProcessedEvent = options.emitProcessedEvent ?? false;
    this.handledTypes = new Set(
      options.handledTypes ?? ["api_write", "api_read"],
    );
  }

  canHandle(requestType: string): boolean {
    return this.handledTypes.has(requestType);
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    if (request.type === "api_write") {
      this.writesProcessed += 1;
    } else {
      this.readsProcessed += 1;
    }
    const events = this.emitProcessedEvent
      ? [
          {
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "PROCESSED" as const,
            latencyAdded: 2,
          },
        ]
      : [];
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events };
  }

  getThroughputPerTick(tier: number): number {
    return tier * this.throughputPerTier;
  }

  getUpkeepCost(tier: number): number {
    return tier * 5;
  }

  getStats(): CapabilityStats {
    return {
      writesProcessed: this.writesProcessed,
      readsProcessed: this.readsProcessed,
    };
  }

  resetPerTickState(): void {
    this.writesProcessed = 0;
    this.readsProcessed = 0;
  }
}

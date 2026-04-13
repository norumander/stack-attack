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
}

/**
 * PROCESS-phase capability for general-purpose request processing.
 * The workhorse capability on Server components.
 *
 * Stage 3 upgrade: adds getThroughputPerTick (tier * 10) and
 * request-type-aware processing. Backward compatible with the
 * outcomeKind test override.
 */
export class ProcessingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  private processedThisTick = 0;

  constructor(
    readonly id: CapabilityId,
    private readonly options: ProcessingCapabilityOptions = {},
  ) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
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

    // Stage 3: default behavior — RESPOND for handled requests
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
  }

  getThroughputPerTick(tier: number): number {
    return tier * 25;
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

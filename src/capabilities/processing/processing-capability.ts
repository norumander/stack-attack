import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult, PrimaryOutcome } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

export interface ProcessingCapabilityOptions {
  // Test-only override for Stage 1 fixtures. Removed when the real capability
  // lands in a later stage.
  outcomeKind?: "PASS" | "RESPOND" | "FORWARD";
}

export class ProcessingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(
    readonly id: CapabilityId,
    private readonly options: ProcessingCapabilityOptions = {},
  ) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    const kind = this.options.outcomeKind ?? "PASS";
    const outcome: PrimaryOutcome =
      kind === "RESPOND"
        ? { kind: "RESPOND" }
        : kind === "FORWARD"
          ? { kind: "FORWARD" }
          : { kind: "PASS" };
    return { outcome, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier;
  }

  getStats(): CapabilityStats {
    return {};
  }
}

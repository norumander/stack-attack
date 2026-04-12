import type { Capability, CapabilityStats } from "@core/capability/capability.js";
import type { Request } from "@core/types/request.js";
import type { ProcessResult } from "@core/types/result.js";
import type { ProcessContext } from "@core/capability/process-context.js";
import type { CapabilityId } from "@core/types/ids.js";

/**
 * Test-only PROCESS-phase capability that emits a SCALE side effect on
 * every request. Used to exercise the engine's SCALE processing without
 * building a real AutoScaleCapability (Stage 3 concern).
 */
export class TestScalingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(
    readonly id: CapabilityId,
    private readonly targetInstanceCount: number,
  ) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return {
      outcome: { kind: "RESPOND" },
      sideEffects: [{ kind: "SCALE", targetInstanceCount: this.targetInstanceCount }],
      events: [],
    };
  }

  getUpkeepCost(_tier: number): number {
    return 1;
  }

  getStats(): CapabilityStats {
    return {};
  }
}

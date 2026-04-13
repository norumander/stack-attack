import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * PROCESS-phase capability for full-text search.
 * CPU-heavy with low throughput. Expensive upkeep.
 */
export class SearchCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "search";
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    return {
      outcome: { kind: "RESPOND" },
      sideEffects: [],
      events: [{
        tick: context.currentTick,
        componentId: context.componentId,
        capabilityId: this.id,
        connectionId: null,
        type: "PROCESSED" as const,
        latencyAdded: 3,
      }],
    };
  }

  getThroughputPerTick(tier: number): number {
    return tier * 3;
  }

  getUpkeepCost(tier: number): number {
    return tier * 8;
  }

  getStats(): CapabilityStats {
    return {};
  }
}

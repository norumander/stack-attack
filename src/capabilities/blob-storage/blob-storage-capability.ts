import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * PROCESS-phase capability for unstructured asset storage.
 * Handles static_asset requests. High capacity but high base latency.
 */
export class BlobStorageCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "static_asset";
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
        latencyAdded: 5,
      }],
    };
  }

  getThroughputPerTick(tier: number): number {
    return tier * 8;
  }

  getUpkeepCost(tier: number): number {
    return tier * 6;
  }

  getStats(): CapabilityStats {
    return {};
  }
}

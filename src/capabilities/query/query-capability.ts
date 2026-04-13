import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * PROCESS-phase capability for optimized query execution.
 * Handles api_read with high throughput and low latency.
 */
export class QueryCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "api_read";
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
  }

  getThroughputPerTick(tier: number): number {
    return tier * 15;
  }

  getUpkeepCost(tier: number): number {
    return tier * 4;
  }

  getStats(): CapabilityStats {
    return {};
  }
}

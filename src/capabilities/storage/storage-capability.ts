import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * PROCESS-phase capability for structured data persistence.
 * Handles api_write and api_read. Slower throughput than ProcessingCapability
 * but required for write operations.
 */
export class StorageCapability implements Capability {
  readonly phase = "PROCESS" as const;

  private writesProcessed = 0;
  private readsProcessed = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "api_write" || requestType === "api_read";
  }

  process(request: Request, _context: ProcessContext): ProcessResult {
    if (request.type === "api_write") {
      this.writesProcessed += 1;
    } else {
      this.readsProcessed += 1;
    }
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
  }

  getThroughputPerTick(tier: number): number {
    return tier * 5;
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

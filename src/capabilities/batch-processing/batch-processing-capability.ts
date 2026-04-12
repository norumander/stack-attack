import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { EnginePullable } from "../../core/capability/engine-interfaces.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { PullContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * PROCESS-phase capability + EnginePullable for async batch processing.
 * Handles batch requests. Workers use this to pull items from queues.
 * Tier 1: process 1 item/tick. Tier 2: 5/tick. Tier 3: 10/tick.
 */
export class BatchProcessingCapability implements Capability, EnginePullable {
  readonly phase = "PROCESS" as const;

  private batchesProcessed = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "batch";
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    this.batchesProcessed += 1;
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
  }

  getThroughputPerTick(tier: number): number {
    return tier * 5;
  }

  getUpkeepCost(tier: number): number {
    return tier * 3;
  }

  getStats(): CapabilityStats {
    return { batchesProcessed: this.batchesProcessed };
  }

  resetPerTickState(): void {
    this.batchesProcessed = 0;
  }

  // --- EnginePullable ---

  pullPending(_context: PullContext): Request[] {
    // In a full implementation, this would pull from a connected
    // queue component. For now, returns empty — the engine routes
    // requests normally through connections.
    return [];
  }
}

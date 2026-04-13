import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * Production Storage — PROCESS phase, handles api_write, RESPOND outcome.
 * Emits a PROCESSED event so integration tests can count writes handled
 * per component. Stage 3a: no replication, no sharding, no query
 * capability. Just the minimum that lets writes reach a persistent
 * component.
 */
export class StorageCapability implements Capability {
  readonly phase = "PROCESS" as const;
  private writeCount = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "api_write";
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    this.writeCount += 1;
    return {
      outcome: { kind: "RESPOND" },
      sideEffects: [],
      events: [
        {
          tick: context.currentTick,
          componentId: context.componentId,
          capabilityId: this.id,
          connectionId: null,
          type: "PROCESSED",
          latencyAdded: 2,
        },
      ],
    };
  }

  getThroughputPerTick(tier: number): number {
    const table: Record<number, number> = { 1: 25, 2: 45, 3: 80 };
    return table[tier] ?? 25;
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 4, 2: 8, 3: 16 };
    return table[tier] ?? 4;
  }

  getStats(): CapabilityStats {
    return { writeCount: this.writeCount };
  }
}

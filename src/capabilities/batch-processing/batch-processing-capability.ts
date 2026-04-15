import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { EnginePullable } from "../../core/capability/engine-interfaces.js";
import { isEngineBufferable } from "../../core/capability/engine-interfaces.js";
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

  pullPending(context: PullContext): Request[] {
    const component = context.state.components.get(context.componentId);
    if (!component) return [];

    const tier = component.getPlayerTier(this.id);
    const capacity = this.getThroughputPerTick(tier);

    const pulled: Request[] = [];
    for (const conn of context.state.connections.values()) {
      if (conn.target.componentId !== context.componentId) continue;
      const upstream = context.state.components.get(conn.source.componentId);
      if (!upstream) continue;
      const bufferable = upstream.getCapabilityByInterface(isEngineBufferable);
      if (bufferable) {
        const batch = bufferable.dequeueBatch(capacity - pulled.length);
        pulled.push(...batch);
        if (pulled.length >= capacity) break;
      }
    }

    return pulled;
  }
}

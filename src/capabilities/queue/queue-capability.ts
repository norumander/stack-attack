import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { EngineBufferable } from "../../core/capability/engine-interfaces.js";
import type { Request } from "../../core/types/request.js";
import type { RequestId } from "../../core/types/ids.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

const CAPACITY_PER_TIER = [0, 32, 64, 128] as const;

/**
 * INTERCEPT-phase capability implementing a FIFO message queue.
 * Implements EngineBufferable for backpressure handling.
 *
 * When used as an INTERCEPT capability (canHandle returns false),
 * it doesn't intercept normal pipeline flow. Instead, the engine
 * routes backpressured requests to enqueueForRetry(), and step 2
 * (reEmitQueued) drains them on the next tick.
 *
 * Tier 1: 32 slots. Tier 2: 64 slots. Tier 3: 128 slots.
 */
export class QueueCapability implements Capability, EngineBufferable {
  readonly phase = "INTERCEPT" as const;

  private buffer: { request: Request; result: ProcessResult }[] = [];
  private totalEnqueued = 0;
  private totalDroppedFull = 0;
  private currentTier = 1;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    // Don't intercept normal pipeline flow — only buffer backpressured items
    return false;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    this.currentTier = tier;
    return tier * 4;
  }

  getStats(): CapabilityStats {
    return {
      queueDepth: this.buffer.length,
      capacity: CAPACITY_PER_TIER[this.currentTier] ?? 32,
      totalEnqueued: this.totalEnqueued,
      totalDroppedFull: this.totalDroppedFull,
    };
  }

  // --- EngineBufferable ---

  enqueueForRetry(request: Request, result: ProcessResult): boolean {
    const capacity = CAPACITY_PER_TIER[this.currentTier] ?? 32;
    if (this.buffer.length >= capacity) {
      this.totalDroppedFull += 1;
      return false;
    }
    this.buffer.push({ request, result });
    this.totalEnqueued += 1;
    return true;
  }

  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  } {
    const out = this.buffer.slice();
    this.buffer.length = 0;
    return { awaitingPipeline: [], awaitingDelivery: out };
  }

  dequeueBatch(n: number): Request[] {
    const out: Request[] = [];
    for (let i = 0; i < n && this.buffer.length > 0; i++) {
      const entry = this.buffer.shift();
      if (entry) out.push(entry.request);
    }
    return out;
  }

  peekBuffered(): ReadonlyArray<{ request: Request; result: ProcessResult }> {
    return this.buffer;
  }

  removeRequest(id: RequestId): boolean {
    const idx = this.buffer.findIndex((e) => e.request.id === id);
    if (idx === -1) return false;
    this.buffer.splice(idx, 1);
    return true;
  }
}

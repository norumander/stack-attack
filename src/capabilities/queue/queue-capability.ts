import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { EngineBufferable } from "../../core/capability/engine-interfaces.js";
import type { Request } from "../../core/types/request.js";
import type { RequestId } from "../../core/types/ids.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

const CAPACITY_PER_TIER = [0, 32, 64, 128] as const;

export interface QueueCapabilityOptions {
  readonly holdTypes?: ReadonlySet<string>;
}

/**
 * INTERCEPT-phase capability implementing a FIFO message queue.
 * Implements EngineBufferable for backpressure handling + job holding.
 *
 * Held types (default: "batch") are intercepted with QUEUE_HOLD outcome
 * and stored in heldBuffer. Worker pulls them via dequeueBatch().
 * Non-held types pass through to forwarding-pipe as before.
 * Backpressure overflow goes to overflowBuffer, drained by reEmitQueued.
 */
export class QueueCapability implements Capability, EngineBufferable {
  readonly phase = "INTERCEPT" as const;

  private readonly holdTypes: ReadonlySet<string>;
  private heldBuffer: { request: Request; result: ProcessResult }[] = [];
  private overflowBuffer: { request: Request; result: ProcessResult }[] = [];
  private totalEnqueued = 0;
  private totalDroppedFull = 0;
  private currentTier = 1;

  constructor(
    readonly id: CapabilityId,
    options?: QueueCapabilityOptions,
  ) {
    this.holdTypes = options?.holdTypes ?? new Set(["batch"]);
  }

  canHandle(requestType: string): boolean {
    return this.holdTypes.has(requestType);
  }

  process(request: Request, _context: ProcessContext): ProcessResult {
    if (this.holdTypes.has(request.type)) {
      return { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] };
    }
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    this.currentTier = tier;
    return tier * 4;
  }

  getStats(): CapabilityStats {
    return {
      queueDepth: this.heldBuffer.length + this.overflowBuffer.length,
      heldDepth: this.heldBuffer.length,
      overflowDepth: this.overflowBuffer.length,
      capacity: CAPACITY_PER_TIER[this.currentTier] ?? 32,
      totalEnqueued: this.totalEnqueued,
      totalDroppedFull: this.totalDroppedFull,
    };
  }

  // --- EngineBufferable ---

  enqueueForRetry(request: Request, result: ProcessResult): boolean {
    const capacity = CAPACITY_PER_TIER[this.currentTier] ?? 32;
    const totalSize = this.heldBuffer.length + this.overflowBuffer.length;
    if (totalSize >= capacity) {
      this.totalDroppedFull += 1;
      return false;
    }
    const isHeld = result.outcome.kind === "QUEUE_HOLD";
    const targetBuffer = isHeld ? this.heldBuffer : this.overflowBuffer;
    targetBuffer.push({ request, result });
    this.totalEnqueued += 1;
    return true;
  }

  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  } {
    const out = this.overflowBuffer.slice();
    this.overflowBuffer.length = 0;
    return { awaitingPipeline: [], awaitingDelivery: out };
  }

  dequeueBatch(n: number): Request[] {
    const out: Request[] = [];
    for (let i = 0; i < n && this.heldBuffer.length > 0; i++) {
      const entry = this.heldBuffer.shift();
      if (entry) out.push(entry.request);
    }
    return out;
  }

  peekBuffered(): ReadonlyArray<{ request: Request; result: ProcessResult }> {
    return [...this.heldBuffer, ...this.overflowBuffer];
  }

  removeRequest(id: RequestId): boolean {
    let idx = this.heldBuffer.findIndex((e) => e.request.id === id);
    if (idx !== -1) {
      this.heldBuffer.splice(idx, 1);
      return true;
    }
    idx = this.overflowBuffer.findIndex((e) => e.request.id === id);
    if (idx !== -1) {
      this.overflowBuffer.splice(idx, 1);
      return true;
    }
    return false;
  }
}

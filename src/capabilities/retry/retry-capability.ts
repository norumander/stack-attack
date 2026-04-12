import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { EngineBufferable } from "../../core/capability/engine-interfaces.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId, RequestId } from "../../core/types/ids.js";

interface RetryEntry {
  request: Request;
  result: ProcessResult;
  retryAtTick: number;
  attempt: number;
}

/**
 * INTERCEPT-phase capability + EngineBufferable for automatic retry.
 * Buffers failed requests with exponential backoff.
 * Max retries: tier * 2. Backoff: 2^attempt ticks.
 */
export class RetryCapability implements Capability, EngineBufferable {
  readonly phase = "INTERCEPT" as const;

  private buffer = new Map<RequestId, RetryEntry>();
  private currentTick = 0;
  private totalRetries = 0;
  private totalExhausted = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    // Don't intercept normal pipeline flow
    return false;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier * 2;
  }

  getStats(): CapabilityStats {
    return {
      buffered: this.buffer.size,
      totalRetries: this.totalRetries,
      totalExhausted: this.totalExhausted,
    };
  }

  // --- EngineBufferable ---

  enqueueForRetry(request: Request, result: ProcessResult): boolean {
    const existing = this.buffer.get(request.id);
    const attempt = existing ? existing.attempt + 1 : 1;
    const maxRetries = 4; // could be tier-dependent in full implementation

    if (attempt > maxRetries) {
      this.totalExhausted += 1;
      return false;
    }

    const backoff = Math.pow(2, attempt);
    this.buffer.set(request.id, {
      request,
      result,
      retryAtTick: this.currentTick + backoff,
      attempt,
    });
    this.totalRetries += 1;
    return true;
  }

  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  } {
    const ready: { request: Request; result: ProcessResult }[] = [];

    for (const [id, entry] of this.buffer) {
      if (entry.retryAtTick <= this.currentTick) {
        ready.push({ request: entry.request, result: entry.result });
        this.buffer.delete(id);
      }
    }

    return { awaitingPipeline: [], awaitingDelivery: ready };
  }

  dequeueBatch(_n: number): Request[] {
    return [];
  }

  peekBuffered(): ReadonlyArray<{ request: Request; result: ProcessResult }> {
    return [...this.buffer.values()].map((e) => ({
      request: e.request,
      result: e.result,
    }));
  }

  removeRequest(id: RequestId): boolean {
    return this.buffer.delete(id);
  }

  /** Called by the engine to keep the capability aware of the current tick. */
  resetPerTickState(): void {
    // currentTick is set externally — we track it via the last process() context.
    // For now, increment based on emitReady() calls.
  }

  /** Allow external tick update for retry timing. */
  setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }
}

import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { EngineConsultable } from "../../core/capability/engine-interfaces.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { Connection } from "../../core/types/connection.js";
import type { CapabilityId, ConnectionId } from "../../core/types/ids.js";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * INTERCEPT-phase capability + EngineConsultable implementing a circuit breaker.
 *
 * CLOSED: requests pass through normally. Failures increment counter.
 * OPEN: requests are fast-failed (DROPped) to prevent cascading failure.
 * HALF_OPEN: one probe request passes; if it succeeds, circuit closes.
 *
 * Tier 1: threshold 5, cooldown 10 ticks.
 * Tier 2: threshold 5, cooldown 5 ticks.
 * Tier 3: threshold 3, cooldown 3 ticks.
 */
export class CircuitBreakerCapability implements Capability, EngineConsultable {
  readonly phase = "INTERCEPT" as const;

  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastOpenedTick = -Infinity;
  private requestsBlocked = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    const tier = context.effectiveTiers.get(this.id) ?? 1;
    const cooldown = tier >= 3 ? 3 : tier >= 2 ? 5 : 10;
    const threshold = tier >= 3 ? 3 : 5;

    switch (this.state) {
      case "CLOSED":
        return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };

      case "OPEN": {
        // Check if cooldown has elapsed
        if (context.currentTick - this.lastOpenedTick >= cooldown) {
          this.state = "HALF_OPEN";
          // Allow one probe request
          return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
        }
        // Fast-fail
        this.requestsBlocked += 1;
        return {
          outcome: { kind: "DROP", reason: "circuit_open" },
          sideEffects: [],
          events: [],
        };
      }

      case "HALF_OPEN":
        // Probe request — pass through, result determines next state
        return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }
  }

  /**
   * Called externally to report downstream failure.
   * In a full implementation, this would be triggered by observing
   * DROP/TIMED_OUT events on downstream components.
   */
  reportFailure(tick: number, context?: { tier?: number }): void {
    const tier = context?.tier ?? 1;
    const threshold = tier >= 3 ? 3 : 5;

    this.failureCount += 1;
    if (this.failureCount >= threshold) {
      this.state = "OPEN";
      this.lastOpenedTick = tick;
    }
  }

  reportSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.state = "CLOSED";
      this.failureCount = 0;
    }
  }

  getCircuitState(): CircuitState {
    return this.state;
  }

  getUpkeepCost(tier: number): number {
    return tier * 2;
  }

  getStats(): CapabilityStats {
    return {
      circuitState: this.state === "CLOSED" ? 0 : this.state === "OPEN" ? 1 : 2,
      failureCount: this.failureCount,
      requestsBlocked: this.requestsBlocked,
    };
  }

  resetPerTickState(): void {
    this.requestsBlocked = 0;
  }

  // --- EngineConsultable ---

  selectConnection(
    _request: Request,
    egressConnections: Connection[],
    _context: ProcessContext,
  ): ConnectionId {
    // Circuit breaker passes through to first available connection.
    // In a full implementation, it would track per-connection circuit state.
    return egressConnections[0]!.id;
  }
}

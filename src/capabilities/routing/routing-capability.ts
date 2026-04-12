import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { EngineConsultable } from "@core/capability/engine-interfaces";
import type { Request } from "@core/types/request";
import type { Connection } from "@core/types/connection";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId, ConnectionId } from "@core/types/ids";

/**
 * RoutingCapability — T1/T2/T3 connection-selection strategies.
 *
 * Phase is INTERCEPT but `canHandle` always returns false, so the capability
 * is invisible in the processing pipeline. The engine discovers it solely
 * via `isEngineConsultable()` in `egress-selection.ts`.
 *
 * Tier progression:
 *   T1 — round-robin: cycle through connections in order.
 *   T2 — least-load: pick the connection with lowest currentLoad / bandwidth.
 *   T3 — condition-weighted: score = targetCondition * max(0, 1 - load/bw);
 *        if all connections are saturated, falls back to round-robin.
 */
export class RoutingCapability implements Capability, EngineConsultable {
  readonly phase = "INTERCEPT" as const;
  private cursor = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return false;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    if (tier <= 1) return 0;
    if (tier === 2) return 2;
    return 5;
  }

  getStats(): CapabilityStats {
    return {};
  }

  resetPerTickState(): void {
    // Round-robin cursor persists across ticks intentionally — it's a
    // long-running load-balancer state, not per-tick scratch.
  }

  selectConnection(
    _request: Request,
    egressConnections: Connection[],
    context: ProcessContext,
  ): ConnectionId {
    if (egressConnections.length === 0) {
      throw new Error("selectConnection called with no egress connections");
    }

    const tier =
      context.effectiveTier || context.effectiveTiers.get(this.id) || 0;

    if (tier <= 1) {
      return this.roundRobin(egressConnections);
    }

    if (tier === 2) {
      return this.leastLoad(egressConnections);
    }

    return this.conditionWeighted(egressConnections, context);
  }

  private roundRobin(connections: Connection[]): ConnectionId {
    const chosen = connections[this.cursor % connections.length]!;
    this.cursor += 1;
    return chosen.id;
  }

  private leastLoad(connections: Connection[]): ConnectionId {
    let best = connections[0]!;
    let bestRatio = best.currentLoad / Math.max(best.bandwidth, 1);

    for (let i = 1; i < connections.length; i++) {
      const c = connections[i]!;
      const ratio = c.currentLoad / Math.max(c.bandwidth, 1);
      if (ratio < bestRatio) {
        best = c;
        bestRatio = ratio;
      }
    }
    return best.id;
  }

  private conditionWeighted(
    connections: Connection[],
    context: ProcessContext,
  ): ConnectionId {
    let bestId = connections[0]!.id;
    let bestScore = -1;

    for (const conn of connections) {
      const targetId = conn.target.componentId;
      const target = context.state.components.get(targetId);
      const condition = target?.condition ?? 1.0;
      const availableCapacity =
        1 - conn.currentLoad / Math.max(conn.bandwidth, 1);
      const score = condition * Math.max(0, availableCapacity);

      if (score > bestScore) {
        bestScore = score;
        bestId = conn.id;
      }
    }

    if (bestScore <= 0) {
      return this.roundRobin(connections);
    }

    return bestId;
  }
}

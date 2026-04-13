import type { SimulationState } from "../state/simulation-state.js";
import type { TickMetrics } from "../types/metrics.js";
import type { ComponentId, ConnectionId } from "../types/ids.js";

type PerComponentReader = TickMetrics["perComponent"] extends ReadonlyMap<ComponentId, infer V>
  ? V
  : never;

export function recordMetrics(state: SimulationState): void {
  // First pass: compute avgLatency and requestsResolved from RESPONDED events this tick.
  let totalForwardLatency = 0;
  let resolvedCount = 0;
  for (const log of state.requestLog.values()) {
    for (const ev of log) {
      if (ev.tick !== state.currentTick) continue;
      if (ev.type !== "RESPONDED") continue;
      const forward =
        ev.metadata && typeof (ev.metadata as Record<string, unknown>)["forwardLatency"] === "number"
          ? (ev.metadata as Record<string, number>)["forwardLatency"]!
          : 0;
      totalForwardLatency += forward;
      resolvedCount += 1;
      break; // one RESPONDED per request log
    }
  }
  const avgLatency = resolvedCount > 0 ? totalForwardLatency / resolvedCount : 0;

  // Second pass: count blocked parents by origin component.
  const blockedByComponent = new Map<ComponentId, number>();
  for (const entry of state.blockedParents.values()) {
    const id = entry.originComponentId;
    blockedByComponent.set(id, (blockedByComponent.get(id) ?? 0) + 1);
  }

  // Build per-component snapshot + top-level sums.
  const perComponent = new Map<ComponentId, PerComponentReader>();
  let sumProcessed = 0;
  let sumDropped = 0;
  let sumTimedOut = 0;
  let sumOverloaded = 0;
  let sumBackpressured = 0;

  for (const [id] of state.components) {
    const raw = state.perComponentThisTick.get(id) ?? {
      processed: 0,
      drops: 0,
      timeouts: 0,
      overloaded: 0,
      backpressured: 0,
    };
    const pending = state.pending.get(id)?.length ?? 0;
    const blocked = blockedByComponent.get(id) ?? 0;

    perComponent.set(id, {
      processed: raw.processed,
      dropped: raw.drops,
      overloaded: raw.overloaded,
      backpressured: raw.backpressured,
      timedOut: raw.timeouts,
      pendingAtEndOfTick: pending,
      blockedAtEndOfTick: blocked,
      condition: state.components.get(id)?.condition ?? 1.0,
      instanceCount: state.components.get(id)?.instanceCount ?? 1,
    });

    sumProcessed += raw.processed;
    sumDropped += raw.drops;
    sumTimedOut += raw.timeouts;
    sumOverloaded += raw.overloaded;
    sumBackpressured += raw.backpressured;
  }

  // Snapshot per-connection load BEFORE step 9 clears connectionLoadThisTick.
  const perConnection = new Map<
    ConnectionId,
    { readonly loadThisTick: number }
  >();
  for (const [connId, load] of state.connectionLoadThisTick) {
    perConnection.set(connId, { loadThisTick: load });
  }

  const snapshot: TickMetrics = {
    tick: state.currentTick,
    requestsProcessed: sumProcessed,
    requestsResolved: resolvedCount,
    requestsDropped: sumDropped,
    requestsOverloaded: sumOverloaded,
    requestsBackpressured: sumBackpressured,
    requestsTimedOut: sumTimedOut,
    revenueEarned: state.revenueEarnedThisTick,
    upkeepPaid: state.upkeepPaidThisTick,
    avgLatency,
    perComponent,
    perConnection,
  };

  state.metricsHistory.push(snapshot);
}

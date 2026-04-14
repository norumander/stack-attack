import type { TopologyRenderer, SpawnRequestDotArgs } from "./topology-renderer.js";
import type { SimulationState } from "@core/state/simulation-state.js";
import type { TickMetrics } from "@core/types/metrics.js";
import type { RequestId } from "@core/types/ids.js";
import { componentThroughputPerTick } from "@core/engine/throughput.js";
import {
  getEffectiveBandwidth,
  getEffectiveLatency,
} from "@core/engine/effective-bandwidth.js";

/**
 * Feeds the Pixi renderer from engine state after each tick.
 *
 * Invoked from SimLoop.onTick, AFTER engine.tick() returns. At that point:
 * - state.metricsHistory[last] holds this tick's TickMetrics.
 * - state.lastTickEvents holds every RequestEvent emitted this tick.
 * - Per-tick counters (connectionLoadThisTick, etc.) are already zeroed;
 *   read per-connection load out of TickMetrics.perConnection instead.
 */
export function applyTickToRenderer(
  state: SimulationState,
  renderer: TopologyRenderer,
  tickIntervalMs: number,
): void {
  const metrics: TickMetrics | undefined =
    state.metricsHistory[state.metricsHistory.length - 1];
  if (!metrics) return;

  for (const [id, comp] of state.components) {
    const m = metrics.perComponent.get(id);
    if (!m) continue;
    const throughput = componentThroughputPerTick(comp);
    const utilization = throughput > 0 ? m.processed / throughput : 0;
    renderer.updateComponent(id, {
      utilization: Math.min(1, utilization),
      condition: m.condition,
      pendingCount: m.pendingAtEndOfTick,
    });
  }

  if (metrics.perConnection) {
    for (const [connId, connMetrics] of metrics.perConnection) {
      const bandwidth = getEffectiveBandwidth(state, connId);
      const loadUtilization =
        bandwidth > 0 ? connMetrics.loadThisTick / bandwidth : 0;
      renderer.updateConnection(connId, {
        loadUtilization: Math.min(1, loadUtilization),
      });
    }
  }

  // Aggregate dots per (connection, requestType) per tick so each visible
  // dot represents a FLOW of that tick's traffic on that edge, not one
  // literal engine request. Wave 1 (10 reads/tick on Client→Server) shows
  // 1 cyan dot; Wave 2 (17 reads + 8 writes/tick) shows 1 cyan + 1 orange
  // on Client→Server plus 1 orange on Server→Database. Without this,
  // every literal request spawned its own dot and 25/tick on a single
  // edge looked like a stampede.
  //
  // The first FORWARDED event in each group picks the representative
  // requestId that actually spawns the dot. `idToRep` maps every other
  // requestId in that group to the representative so the SERVED/DROPPED/
  // OVERLOADED flashes below can re-key onto the representative and fire
  // when its single dot retires at the target.
  //
  // We also count how many engine events mapped to each group and pass
  // that count to spawnRequestDot so the renderer can show a numeric
  // label on the dot (e.g. "50" for 50 reads aggregated into one cyan dot).
  const groupRep = new Map<string, RequestId>();
  const idToRep = new Map<RequestId, RequestId>();
  const pendingDots = new Map<string, { args: SpawnRequestDotArgs; count: number }>();

  for (const ev of state.lastTickEvents) {
    if (ev.type !== "FORWARDED") continue;
    if (ev.connectionId === null) continue;
    const requestType =
      (ev.metadata && (ev.metadata as { requestType?: string }).requestType) ??
      "default";
    const groupKey = `${ev.connectionId}|${requestType}`;
    const existingRep = groupRep.get(groupKey);
    if (existingRep !== undefined) {
      idToRep.set(ev.requestId, existingRep);
      const pending = pendingDots.get(groupKey)!;
      pending.count += 1;
      continue;
    }
    groupRep.set(groupKey, ev.requestId);
    idToRep.set(ev.requestId, ev.requestId);
    const latencyTicks = getEffectiveLatency(state, ev.connectionId);
    const durationMs = Math.max(50, latencyTicks * tickIntervalMs);
    pendingDots.set(groupKey, {
      count: 1,
      args: {
        connectionId: ev.connectionId,
        requestId: ev.requestId,
        requestType,
        durationMs,
      },
    });
  }

  for (const { args, count } of pendingDots.values()) {
    renderer.spawnRequestDot({ ...args, count });
  }

  // Queue per-request feedback flashes so they fire when the dot carrying
  // that request arrives visually. Because we aggregate one dot per
  // (connection, requestType) per tick, every flash must be re-keyed to
  // the group's representative requestId — otherwise only the rep's own
  // flash would match its retirement and the other N-1 flashes would
  // fall through to timeout, firing at a delayed (and wrong-location)
  // moment. Events whose requestId isn't in `idToRep` (e.g. a request
  // that didn't forward this tick, or one already resident at its
  // terminal component) fall back to their own requestId, which the
  // timeout fallback covers.
  //
  // SERVED: "work was done here" — fires at the component that produced
  //   the RESPOND outcome, not at the origin (see deliver-staged.ts).
  // DROPPED: fires at the component where the drop happened.
  // OVERLOADED: fires at the component that shed work this tick.
  for (const ev of state.lastTickEvents) {
    if (ev.type !== "DROPPED" && ev.type !== "OVERLOADED" && ev.type !== "SERVED") continue;
    const flashKey = idToRep.get(ev.requestId) ?? ev.requestId;
    const kind = ev.type === "DROPPED" ? "drop" : ev.type === "OVERLOADED" ? "overload" : "served";
    renderer.queueFlashOnRequestArrival(flashKey, ev.componentId, kind);
  }
}

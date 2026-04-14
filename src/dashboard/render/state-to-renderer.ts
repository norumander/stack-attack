import type { TopologyRenderer } from "./topology-renderer.js";
import type { SimulationState } from "@core/state/simulation-state.js";
import type { TickMetrics } from "@core/types/metrics.js";
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

  for (const ev of state.lastTickEvents) {
    if (ev.type !== "FORWARDED") continue;
    if (ev.connectionId === null) continue;
    const requestType =
      (ev.metadata && (ev.metadata as { requestType?: string }).requestType) ??
      "default";
    const latencyTicks = getEffectiveLatency(state, ev.connectionId);
    const durationMs = Math.max(50, latencyTicks * tickIntervalMs);
    renderer.spawnRequestDot({
      connectionId: ev.connectionId,
      requestType,
      durationMs,
    });
  }

  for (const ev of state.lastTickEvents) {
    if (ev.type === "DROPPED") renderer.flashDrop(ev.componentId);
    else if (ev.type === "OVERLOADED") renderer.flashOverload(ev.componentId);
    // SERVED fires at the component that produced the RESPOND outcome —
    // this is the "work was done here" signal. We intentionally do NOT pulse
    // on RESPONDED because that event fires at the request's origin (the
    // return path's final destination), which is the Client in typical
    // topologies — not where the work happened.
    else if (ev.type === "SERVED") renderer.flashResponded(ev.componentId);
  }
}

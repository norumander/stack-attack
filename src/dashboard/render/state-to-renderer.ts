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

  // Stagger dots spawning on the same connection in the same tick so they
  // form a visible train instead of stacking into one composite sprite.
  // Without this, a Wave-2 tick with 17 reads + 8 writes spawns 25 dots at
  // the exact same (x,y) at t=0 on Client→Server, and the larger orange
  // write squares render directly around the smaller cyan read circles —
  // looking like "orange-edged cyan dots." Per-connection counter resets
  // every call (every tick), so stagger is bounded to this tick's events.
  const STAGGER_MS_PER_SLOT = 10;
  const staggerCounter = new Map<string, number>();
  for (const ev of state.lastTickEvents) {
    if (ev.type !== "FORWARDED") continue;
    if (ev.connectionId === null) continue;
    const requestType =
      (ev.metadata && (ev.metadata as { requestType?: string }).requestType) ??
      "default";
    const latencyTicks = getEffectiveLatency(state, ev.connectionId);
    const durationMs = Math.max(50, latencyTicks * tickIntervalMs);
    const slot = staggerCounter.get(ev.connectionId) ?? 0;
    staggerCounter.set(ev.connectionId, slot + 1);
    renderer.spawnRequestDot({
      connectionId: ev.connectionId,
      requestId: ev.requestId,
      requestType,
      durationMs,
      spawnOffsetMs: slot * STAGGER_MS_PER_SLOT,
    });
  }

  // Queue per-request feedback flashes so they fire when the dot carrying
  // that request arrives visually — not at tick-start while the dot is
  // still mid-flight. The renderer matches each pending flash against
  // retiring dots by (requestId, componentId); any unmatched flash fires
  // via timeout (see PENDING_FLASH_TIMEOUT_MS).
  //
  // SERVED: "work was done here" — fires at the component that produced
  //   the RESPOND outcome, not at the origin (see deliver-staged.ts).
  // DROPPED: fires at the component where the drop happened.
  // OVERLOADED: fires at the component that shed work this tick.
  for (const ev of state.lastTickEvents) {
    if (ev.type === "DROPPED") {
      renderer.queueFlashOnRequestArrival(ev.requestId, ev.componentId, "drop");
    } else if (ev.type === "OVERLOADED") {
      renderer.queueFlashOnRequestArrival(ev.requestId, ev.componentId, "overload");
    } else if (ev.type === "SERVED") {
      renderer.queueFlashOnRequestArrival(ev.requestId, ev.componentId, "served");
    }
  }
}

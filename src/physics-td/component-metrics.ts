import type { ComponentId } from "@core/types/ids";
import type { Sim } from "@sim/sim";
import type { SimEvent } from "@sim/types";

/**
 * Per-component live observability for the diagnose-mode HUD.
 *
 * Built on the client side — NOT in sim. Listens to `SimEvent`s emitted per
 * step and maintains rolling per-component windows (1s) plus cumulative
 * wave totals. Also samples utilization from each component's capacity
 * bucket on every update call.
 *
 * `update(sim, events, simTime)` is called once per frame from
 * `physics-td.ts` after the sim step.
 *
 * Stress thresholds are encoded here (utilization >= 0.8 = stressed,
 * recent-drop count >= 1 in the last 1s = dropping) so both the info panel
 * and the sprite-layer stress indicator read from the same source of truth.
 */

/** Rolling window length for "last 1s" drop counts. */
export const ROLLING_WINDOW_SECONDS = 1;

/** Utilization at/above which a component is considered "stressed". */
export const STRESS_UTILIZATION = 0.8;

/** Drops in the rolling window at/above which we flag "dropping". */
export const DROPPING_RECENT_THRESHOLD = 1;

export interface ComponentMetrics {
  /** Current utilization in 0..1 (derived from bucket.available vs effective capacity). */
  readonly utilization: number;
  /** Total drops this wave (since last reset). */
  readonly dropsTotal: number;
  /** Drops within the rolling 1s window. */
  readonly dropsLastSecond: number;
  /** Requests responded + terminated this wave (cumulative). */
  readonly processedTotal: number;
  /** Average response latency (seconds) across respond-delivered + terminate events. */
  readonly avgResponseSeconds: number;
  /** True when utilization crosses STRESS_UTILIZATION. */
  readonly stressed: boolean;
  /** True when dropsLastSecond >= DROPPING_RECENT_THRESHOLD. */
  readonly dropping: boolean;
}

interface PerCompState {
  dropsTotal: number;
  dropEventTimes: number[]; // sim-time seconds — only drop events in rolling window
  processedTotal: number;
  latencySum: number;
  latencyCount: number;
  utilization: number;
}

function emptyState(): PerCompState {
  return {
    dropsTotal: 0,
    dropEventTimes: [],
    processedTotal: 0,
    latencySum: 0,
    latencyCount: 0,
    utilization: 0,
  };
}

function snapshot(s: PerCompState): ComponentMetrics {
  const dropsLastSecond = s.dropEventTimes.length;
  const avg = s.latencyCount > 0 ? s.latencySum / s.latencyCount : 0;
  return {
    utilization: s.utilization,
    dropsTotal: s.dropsTotal,
    dropsLastSecond,
    processedTotal: s.processedTotal,
    avgResponseSeconds: avg,
    stressed: s.utilization >= STRESS_UTILIZATION,
    dropping: dropsLastSecond >= DROPPING_RECENT_THRESHOLD,
  };
}

export class ComponentMetricsAggregator {
  private readonly states = new Map<ComponentId, PerCompState>();

  /**
   * Ingest sim events from this tick and resample utilization for every
   * known component. `simTime` is the sim's current time in seconds (the
   * time at which these events occurred).
   */
  update(sim: Sim, events: readonly SimEvent[], simTime: number): void {
    for (const ev of events) {
      if (ev.kind === "drop") {
        const s = this.ensure(ev.componentId);
        s.dropsTotal += ev.count;
        // Push one timestamp per dropped request for accurate rolling counts.
        for (let i = 0; i < ev.count; i += 1) s.dropEventTimes.push(simTime);
      } else if (ev.kind === "terminate" || ev.kind === "respond-delivered") {
        const s = this.ensure(ev.componentId);
        s.processedTotal += ev.count;
        s.latencySum += ev.latencySeconds;
        s.latencyCount += 1;
      }
    }

    const cutoff = simTime - ROLLING_WINDOW_SECONDS;
    for (const [id, comp] of sim.components.entries()) {
      const s = this.ensure(id);
      // Roll the drop window.
      while (s.dropEventTimes.length > 0 && s.dropEventTimes[0]! < cutoff) {
        s.dropEventTimes.shift();
      }
      // Utilization sample: use bucket available vs effective capacity
      // (1 - available/effective). Mirrors the info-panel's existing math.
      if (comp.bucket && comp.capacityPerSecond !== null && comp.capacityPerSecond > 0) {
        const eff = comp.getEffectiveCapacity();
        const u = eff > 0 ? 1 - comp.bucket.available() / eff : 0;
        s.utilization = Math.max(0, Math.min(1, u));
      } else {
        s.utilization = 0;
      }
    }
  }

  /** Get the current snapshot for a component. Returns a zeroed snapshot
   *  if the component has never been seen. */
  getMetricsFor(componentId: ComponentId): ComponentMetrics {
    const s = this.states.get(componentId);
    if (!s) return snapshot(emptyState());
    return snapshot(s);
  }

  /** Clear all per-component state. Called at the start of each wave. */
  reset(): void {
    this.states.clear();
  }

  private ensure(id: ComponentId): PerCompState {
    let s = this.states.get(id);
    if (!s) {
      s = emptyState();
      this.states.set(id, s);
    }
    return s;
  }
}

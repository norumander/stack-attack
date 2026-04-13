import type { ModeController } from "../../core/mode/mode-controller.js";
import type { ComponentReader } from "../../core/component/component-reader.js";
import type { CapabilityId, ComponentId } from "../../core/types/ids.js";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "../../core/types/build-constraints.js";
import type { TickMetrics } from "../../core/types/metrics.js";
import type { OutcomeReport } from "../../core/types/outcome.js";
import type { ChaosEvent } from "../../core/types/chaos.js";
import { type ZoneTopology, zonePairKey } from "../../core/types/zone.js";
import type { Position } from "../../core/types/position.js";
import type { SimulationState } from "../../core/state/simulation-state.js";
import type { SimulationStateReader } from "../../core/state/state-reader.js";
import { CompositeTrafficSource } from "../../core/mode/composite-traffic-source.js";
import { SandboxEconomy } from "./sandbox-economy.js";
import {
  SandboxTrafficSource,
  type SandboxTrafficConfig,
} from "./sandbox-traffic-source.js";
import {
  resolvePreset,
  type TrafficPresetName,
} from "./sandbox-traffic-presets.js";

interface ScheduledChaos {
  readonly event: ChaosEvent;
  readonly atTick: number;
}

export interface MetricsSnapshot {
  readonly ticks: number;
  readonly totalProcessed: number;
  readonly totalResolved: number;
  readonly totalDropped: number;
  readonly totalTimedOut: number;
  readonly totalBackpressured: number;
  readonly totalOverloaded: number;
  readonly avgLatency: number;
  readonly reliability: number;
  readonly perTickHistory: readonly TickMetrics[];
}

/**
 * ModeController for Sandbox mode.
 *
 * All capabilities unlocked, no tier caps, no budget pressure.
 * Player configures traffic sources and schedules chaos events manually.
 */
export class SandboxModeController implements ModeController {
  readonly economy = new SandboxEconomy();

  private phase: "build" | "simulate" | "assess" = "build";
  private readonly trafficSources: SandboxTrafficSource[] = [];
  private readonly chaosQueue: ScheduledChaos[] = [];
  private readonly _zones: string[] = ["default"];
  private readonly _pairLatency: Map<string, number> = new Map();

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId> {
    // Tier 0 means "locked / not yet unlocked" in the registry.
    // Exclude tier-0 capabilities so locked ones (e.g. rate-limit at
    // defaultTier 0 on Load Balancer) don't activate with zero-config
    // and cause unexpected behavior.
    const active = new Set<CapabilityId>();
    for (const id of component.getCapabilityIds()) {
      if (component.getPlayerTier(id) > 0) {
        active.add(id);
      }
    }
    return active;
  }

  getTierCap(_component: ComponentReader, _capabilityId: CapabilityId): number {
    return Infinity;
  }

  getBuildConstraints(): BuildConstraints {
    return { availableComponentTypes: [] };
  }

  getTrafficSource(): CompositeTrafficSource {
    return new CompositeTrafficSource(this.trafficSources);
  }

  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport {
    if (metrics.length === 0) {
      return {
        verdict: "neutral",
        score: { cost: 0, performance: 0, reliability: 0, composite: 0 },
        notes: [],
      };
    }

    let totalProcessed = 0;
    let totalResolved = 0;
    let totalDropped = 0;
    let totalRevenue = 0;
    let totalUpkeep = 0;
    let latencySum = 0;

    for (const m of metrics) {
      totalProcessed += m.requestsProcessed;
      totalResolved += m.requestsResolved;
      totalDropped += m.requestsDropped;
      totalRevenue += m.revenueEarned;
      totalUpkeep += m.upkeepPaid;
      latencySum += m.avgLatency;
    }

    const totalAttempted = totalResolved + totalDropped;
    const reliability = totalAttempted > 0 ? totalResolved / totalAttempted : 1;
    const performance = metrics.length > 0 ? 1 / (1 + latencySum / metrics.length) : 1;
    const cost = totalRevenue > 0 ? Math.max(0, 1 - totalUpkeep / totalRevenue) : 1;
    const composite = (cost + performance + reliability) / 3;

    return {
      verdict: "neutral",
      score: { cost, performance, reliability, composite },
      notes: [],
    };
  }

  getPhase(): "build" | "simulate" | "assess" {
    return this.phase;
  }

  advancePhase(): void {
    this.phase =
      this.phase === "build"
        ? "simulate"
        : this.phase === "simulate"
          ? "assess"
          : "build";
  }

  getInitialZoneTopology(): ZoneTopology {
    return { zones: this._zones, pairLatency: this._pairLatency };
  }

  tryPlace(
    _state: SimulationState,
    _type: string,
    _position: Position,
    _zone: string | null,
  ): PlacementResult {
    // Sandbox placement is not yet implemented. The previous stub returned
    // fabricated component ids without mutating state, which any future UI
    // code that trusted the result would silently desync against. Throw
    // loudly until a real impl lands (Stage 3c).
    throw new Error(
      "SandboxModeController.tryPlace is not implemented yet — sandbox topologies place via state.placeComponent() directly",
    );
  }

  tryUpgrade(
    _state: SimulationState,
    _componentId: ComponentId,
    _capabilityId: CapabilityId,
  ): UpgradeResult {
    // Sandbox upgrade is not yet implemented. The previous stub returned a
    // bumped playerTier without actually calling component.upgrade() or
    // touching state. Throw until a real impl lands (Stage 3c).
    throw new Error(
      "SandboxModeController.tryUpgrade is not implemented yet",
    );
  }

  getScheduledChaos(currentTick: number): readonly ChaosEvent[] {
    return this.chaosQueue
      .filter((entry) => entry.atTick === currentTick)
      .map((entry) => entry.event);
  }

  // --- Sandbox-specific methods (not on ModeController interface) ---

  scheduleChaos(event: ChaosEvent, atTick: number): void {
    this.chaosQueue.push({ event, atTick });
  }

  addTrafficSource(config: SandboxTrafficConfig): number {
    const source = new SandboxTrafficSource(config);
    this.trafficSources.push(source);
    return this.trafficSources.length - 1;
  }

  addTrafficSourceFromPreset(
    presetName: TrafficPresetName,
    targetEntryPointId: ComponentId,
  ): number {
    const config = resolvePreset(presetName, targetEntryPointId);
    return this.addTrafficSource(config);
  }

  removeTrafficSource(index: number): boolean {
    if (index < 0 || index >= this.trafficSources.length) return false;
    this.trafficSources.splice(index, 1);
    return true;
  }

  getTrafficSources(): readonly SandboxTrafficSource[] {
    return this.trafficSources;
  }

  // --- Zone management ---

  addZone(name: string): boolean {
    if (this._zones.includes(name)) return false;
    this._zones.push(name);
    return true;
  }

  removeZone(name: string): boolean {
    if (this._zones.length <= 1) return false;
    const idx = this._zones.indexOf(name);
    if (idx === -1) return false;
    this._zones.splice(idx, 1);
    // Remove all pair latencies involving this zone
    for (const key of [...this._pairLatency.keys()]) {
      const [a, b] = key.split("|");
      if (a === name || b === name) {
        this._pairLatency.delete(key);
      }
    }
    return true;
  }

  setZonePairLatency(zoneA: string, zoneB: string, latency: number): boolean {
    if (!this._zones.includes(zoneA) || !this._zones.includes(zoneB)) return false;
    if (zoneA === zoneB) return false;
    this._pairLatency.set(zonePairKey(zoneA, zoneB), latency);
    return true;
  }

  removeZonePairLatency(zoneA: string, zoneB: string): boolean {
    const key = zonePairKey(zoneA, zoneB);
    return this._pairLatency.delete(key);
  }

  getZones(): readonly string[] {
    return this._zones;
  }

  getZonePairLatencies(): ReadonlyMap<string, number> {
    return this._pairLatency;
  }

  // --- Scenario support ---

  getChaosQueue(): readonly { event: ChaosEvent; atTick: number }[] {
    return this.chaosQueue;
  }

  clearTrafficSources(): void {
    this.trafficSources.length = 0;
  }

  clearChaosQueue(): void {
    this.chaosQueue.length = 0;
  }

  setZones(zones: readonly string[], pairLatencies: ReadonlyMap<string, number>): void {
    this._zones.length = 0;
    for (const z of zones) this._zones.push(z);
    this._pairLatency.clear();
    for (const [key, val] of pairLatencies) this._pairLatency.set(key, val);
  }

  getMetricsSnapshot(state: SimulationState): MetricsSnapshot {
    const history = state.metricsHistory;
    if (history.length === 0) {
      return {
        ticks: 0,
        totalProcessed: 0,
        totalResolved: 0,
        totalDropped: 0,
        totalTimedOut: 0,
        totalBackpressured: 0,
        totalOverloaded: 0,
        avgLatency: 0,
        reliability: 1,
        perTickHistory: history,
      };
    }

    let totalProcessed = 0;
    let totalResolved = 0;
    let totalDropped = 0;
    let totalTimedOut = 0;
    let totalBackpressured = 0;
    let totalOverloaded = 0;
    let weightedLatencySum = 0;
    let totalResolvedForLatency = 0;

    for (const m of history) {
      totalProcessed += m.requestsProcessed;
      totalResolved += m.requestsResolved;
      totalDropped += m.requestsDropped;
      totalTimedOut += m.requestsTimedOut;
      totalBackpressured += m.requestsBackpressured;
      totalOverloaded += m.requestsOverloaded;
      weightedLatencySum += m.avgLatency * m.requestsResolved;
      totalResolvedForLatency += m.requestsResolved;
    }

    const totalTerminal = totalResolved + totalDropped + totalTimedOut;
    const reliability = totalTerminal > 0 ? totalResolved / totalTerminal : 1;
    const avgLatency = totalResolvedForLatency > 0
      ? weightedLatencySum / totalResolvedForLatency
      : 0;

    return {
      ticks: history.length,
      totalProcessed,
      totalResolved,
      totalDropped,
      totalTimedOut,
      totalBackpressured,
      totalOverloaded,
      avgLatency,
      reliability,
      perTickHistory: history,
    };
  }

  onTick(_state: SimulationStateReader): void {
    /* no-op for now */
  }
}

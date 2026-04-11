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
import type { ZoneTopology } from "../../core/types/zone.js";
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
  private placementCounter = 0;

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId> {
    return new Set(component.getCapabilityIds());
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
    return { zones: ["default"], pairLatency: new Map() };
  }

  tryPlace(
    _state: SimulationState,
    _type: string,
    _position: Position,
    _zone: string | null,
  ): PlacementResult {
    this.placementCounter += 1;
    return {
      ok: true,
      componentId: `sandbox-placed-${this.placementCounter}` as ComponentId,
    };
  }

  tryUpgrade(
    state: SimulationState,
    componentId: ComponentId,
    capabilityId: CapabilityId,
  ): UpgradeResult {
    const component = state.components.get(componentId);
    if (!component) {
      return { ok: false, reason: "capability_not_found", detail: "Component not found" };
    }
    const ids = component.getCapabilityIds();
    if (!ids.includes(capabilityId)) {
      return { ok: false, reason: "capability_not_found" };
    }
    return { ok: true, newPlayerTier: component.getPlayerTier(capabilityId) + 1 };
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

  onTick(_state: SimulationStateReader): void {
    /* no-op for now */
  }
}

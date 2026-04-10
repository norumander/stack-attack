import type { ModeController } from "@core/mode/mode-controller";
import type { TrafficSource } from "@core/mode/traffic-source";
import type { ComponentReader } from "@core/component/component-reader";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { Position } from "@core/types/position";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "@core/types/build-constraints";
import type { TickMetrics } from "@core/types/metrics";
import type { OutcomeReport } from "@core/types/outcome";
import type { ChaosEvent } from "@core/types/chaos";
import type { ZoneTopology } from "@core/types/zone";
import type { SimulationState } from "@core/state/simulation-state";
import { NoOpEconomy } from "./noop-economy.js";
import {
  FixedIntensityTrafficSource,
  type FixedIntensityConfig,
} from "./fixed-intensity-traffic-source.js";

export class NoOpModeController implements ModeController {
  readonly economy = new NoOpEconomy();
  private readonly traffic: TrafficSource;
  private phase: "build" | "simulate" | "assess" = "simulate";

  constructor(trafficConfig: FixedIntensityConfig) {
    this.traffic = new FixedIntensityTrafficSource(trafficConfig);
  }

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId> {
    return new Set(component.getCapabilityIds());
  }

  getTierCap(_component: ComponentReader, _capabilityId: CapabilityId): number {
    return Infinity;
  }

  getBuildConstraints(): BuildConstraints {
    return { availableComponentTypes: [] };
  }

  getTrafficSource(): TrafficSource {
    return this.traffic;
  }

  evaluateOutcome(_metrics: readonly TickMetrics[]): OutcomeReport {
    return {
      verdict: "neutral",
      score: { cost: 0, performance: 0, reliability: 0, composite: 0 },
      notes: [],
    };
  }

  getPhase(): "build" | "simulate" | "assess" {
    return this.phase;
  }

  advancePhase(): void {
    this.phase =
      this.phase === "build" ? "simulate" : this.phase === "simulate" ? "assess" : "build";
  }

  getInitialZoneTopology(): ZoneTopology {
    return { zones: [], pairLatency: new Map() };
  }

  tryPlace(
    _state: SimulationState,
    _type: string,
    _position: Position,
    _zone: string | null,
  ): PlacementResult {
    return {
      ok: false,
      reason: "disallowed_by_mode",
      detail: "NoOpModeController does not accept placements",
    };
  }

  tryUpgrade(
    _state: SimulationState,
    _componentId: ComponentId,
    _capabilityId: CapabilityId,
  ): UpgradeResult {
    return { ok: false, reason: "disallowed_by_mode" };
  }

  getScheduledChaos(_currentTick: number): readonly ChaosEvent[] {
    return [];
  }
}

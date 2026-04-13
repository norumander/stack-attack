import type { ModeController } from "@core/mode/mode-controller.js";
import type { ComponentReader } from "@core/component/component-reader.js";
import type { CapabilityId, ComponentId } from "@core/types/ids.js";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "@core/types/build-constraints.js";
import type { TickMetrics } from "@core/types/metrics.js";
import type { OutcomeReport } from "@core/types/outcome.js";
import type { ZoneTopology } from "@core/types/zone.js";
import type { ChaosEvent } from "@core/types/chaos.js";
import type { Position } from "@core/types/position.js";
import type { SimulationState } from "@core/state/simulation-state.js";
import type { TrafficSource } from "@core/mode/traffic-source.js";
import type { TDEconomy } from "./td-economy.js";
import type { TDWaveDefinition } from "./td-waves.js";
import { TDTrafficSource } from "./td-traffic-source.js";

export interface TDModeControllerOptions {
  readonly wave: TDWaveDefinition;
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
}

export class TDModeController implements ModeController {
  readonly economy: TDEconomy;
  private readonly wave: TDWaveDefinition;
  private readonly trafficSource: TDTrafficSource;
  private phase: "build" | "simulate" | "assess" = "build";
  private placementCounter = 0;

  constructor(options: TDModeControllerOptions) {
    this.wave = options.wave;
    this.economy = options.economy;
    this.trafficSource = new TDTrafficSource({
      wave: options.wave,
      targetEntryPointId: options.entryPointId,
      rng: options.rng,
    });
  }

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId> {
    return new Set(component.getCapabilityIds() as CapabilityId[]);
  }

  getTierCap(_component: ComponentReader, _capabilityId: CapabilityId): number {
    return 1;
  }

  getBuildConstraints(): BuildConstraints {
    // exactOptionalPropertyTypes: only include maxPlacements if set.
    return this.wave.maxPlacements !== undefined
      ? {
          availableComponentTypes: this.wave.availableComponents,
          maxPlacements: this.wave.maxPlacements,
        }
      : {
          availableComponentTypes: this.wave.availableComponents,
        };
  }

  getTrafficSource(): TrafficSource {
    return this.trafficSource;
  }

  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport {
    let dropped = 0;
    let timedOut = 0;
    let resolved = 0;
    for (const m of metrics) {
      dropped += m.requestsDropped;
      timedOut += m.requestsTimedOut;
      resolved += m.requestsResolved;
    }
    const total = dropped + timedOut + resolved;
    const dropRate = total > 0 ? (dropped + timedOut) / total : 0;
    const budget = this.economy.getBudget();
    const verdict: "win" | "lose" | "neutral" =
      dropRate < this.wave.dropThreshold ? "win" : "lose";

    const performance = 1 - dropRate;
    const reliability = 1 - (dropped + timedOut) / Math.max(total, 1);
    const cost = budget;
    const composite =
      0.4 * performance + 0.4 * reliability + 0.2 * (cost / this.wave.startingBudget);

    return {
      verdict,
      score: { cost, performance, reliability, composite },
      notes: [
        `drop rate: ${(dropRate * 100).toFixed(2)}%`,
        `budget: ${budget}`,
        `total requests: ${total}`,
      ],
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
    // Stage 3a stub — mirrors SandboxModeController.tryPlace. Integration
    // tests build topology via harness fixtures and never call this.
    this.placementCounter += 1;
    return {
      ok: true,
      componentId: `td-placed-${this.placementCounter}` as ComponentId,
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

  getScheduledChaos(_currentTick: number): readonly ChaosEvent[] {
    return [];
  }
}

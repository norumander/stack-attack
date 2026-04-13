import type { ModeController } from "@core/mode/mode-controller.js";
import type { ComponentReader } from "@core/component/component-reader.js";
import type {
  CapabilityId,
  ComponentId,
  ConnectionId,
  PortId,
} from "@core/types/ids.js";
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
import type { Connection } from "@core/types/connection.js";
import type { ComponentRegistry } from "@core/registry/component-registry.js";
import { isEngineBufferable } from "@core/capability/engine-interfaces.js";
import type { TDEconomy } from "./td-economy.js";
import type { TDWaveDefinition } from "./td-waves.js";
import { TDTrafficSource } from "./td-traffic-source.js";

// Task 8 will use these; keep referenced here so the imports don't get
// dropped by tools that prune unused imports.
type _ReservedForTask8 = PortId | ConnectionId | Connection;

// Stub registry used by the single-wave back-compat shim. tryPlace throws
// if the back-compat-constructed controller is asked to place — Stage 3a
// tests never call tryPlace, so this is unreachable in practice.
const STUB_REGISTRY: ComponentRegistry = {
  tryCreate: () => {
    throw new Error(
      "TDModeController: tryPlace not supported on single-wave back-compat controller",
    );
  },
} as unknown as ComponentRegistry;

export interface TDMultiWaveOptions {
  readonly waves: readonly TDWaveDefinition[];
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
  readonly componentRegistry: ComponentRegistry;
}

export interface TDSingleWaveOptions {
  readonly wave: TDWaveDefinition;
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
}

export type TDModeControllerOptions =
  | TDMultiWaveOptions
  | TDSingleWaveOptions;

export type ConnectResult =
  | { ok: true; connectionId: ConnectionId }
  | {
      ok: false;
      reason:
        | "wrong_phase"
        | "unknown_source"
        | "unknown_target"
        | "no_egress_port"
        | "no_ingress_port"
        | "duplicate_connection"
        | "port_capacity_exceeded";
      detail?: string;
    };

export class TDModeController implements ModeController {
  // economy is mutable so the dashboard can swap in a fresh per-wave economy
  economy: TDEconomy;

  private readonly waves: readonly TDWaveDefinition[];
  private currentWaveIndex = 0;
  private trafficSource: TDTrafficSource;
  private phase: "build" | "simulate" | "assess" = "build";
  private waveStartMetricsIndex = 0;
  private placementSerial = 0;
  private readonly componentRegistry: ComponentRegistry;
  private readonly entryPointId: ComponentId;
  private readonly rng: () => number;

  constructor(options: TDModeControllerOptions) {
    if ("waves" in options) {
      if (options.waves.length === 0) {
        throw new Error("TDModeController: waves array must be non-empty");
      }
      this.waves = options.waves;
      this.componentRegistry = options.componentRegistry;
    } else {
      this.waves = [options.wave];
      this.componentRegistry = STUB_REGISTRY;
    }
    this.economy = options.economy;
    this.entryPointId = options.entryPointId;
    this.rng = options.rng;
    this.trafficSource = new TDTrafficSource({
      wave: this.waves[0]!,
      targetEntryPointId: options.entryPointId,
      rng: options.rng,
    });
  }

  /** Dashboard calls this on assess→build to swap in the next wave's economy. */
  setEconomy(economy: TDEconomy): void {
    this.economy = economy;
  }

  // === New multi-wave getters ===

  getCurrentWaveIndex(): number {
    return this.currentWaveIndex;
  }

  getCurrentWave(): TDWaveDefinition {
    if (this.isCampaignComplete()) {
      throw new Error("TDModeController: campaign complete; no current wave");
    }
    return this.waves[this.currentWaveIndex]!;
  }

  isCampaignComplete(): boolean {
    return this.currentWaveIndex >= this.waves.length;
  }

  getWaveCount(): number {
    return this.waves.length;
  }

  // === Existing methods, updated to read this.getCurrentWave() ===

  getActiveCapabilities(
    component: ComponentReader,
  ): ReadonlySet<CapabilityId> {
    return new Set(component.getCapabilityIds() as CapabilityId[]);
  }

  getTierCap(
    _component: ComponentReader,
    _capabilityId: CapabilityId,
  ): number {
    return 1;
  }

  getBuildConstraints(): BuildConstraints {
    const wave = this.getCurrentWave();
    return wave.maxPlacements !== undefined
      ? {
          availableComponentTypes: wave.availableComponents,
          maxPlacements: wave.maxPlacements,
        }
      : {
          availableComponentTypes: wave.availableComponents,
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
    const wave = this.getCurrentWave();
    const verdict: "win" | "lose" | "neutral" =
      dropRate < wave.dropThreshold ? "win" : "lose";

    const performance = 1 - dropRate;
    const reliability = 1 - (dropped + timedOut) / Math.max(total, 1);
    const cost = budget;
    const composite =
      0.4 * performance +
      0.4 * reliability +
      0.2 * (cost / wave.startingBudget);

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

  getCurrentWaveMetrics(state: SimulationState): readonly TickMetrics[] {
    return state.metricsHistory.slice(this.waveStartMetricsIndex);
  }

  getPhase(): "build" | "simulate" | "assess" {
    return this.phase;
  }

  /**
   * Advance the phase machine. Optional `state` parameter is used by the
   * dashboard to snapshot the metrics index at build→simulate and to
   * reconstruct trafficSource at assess→build.
   *
   * Stage 3a's runWave calls advancePhase() with no args (single-wave path).
   */
  advancePhase(state?: SimulationState): void {
    switch (this.phase) {
      case "build":
        if (state !== undefined) {
          this.waveStartMetricsIndex = state.metricsHistory.length;
        }
        this.phase = "simulate";
        break;
      case "simulate":
        this.phase = "assess";
        break;
      case "assess":
        this.currentWaveIndex += 1;
        if (this.currentWaveIndex < this.waves.length) {
          this.trafficSource = new TDTrafficSource({
            wave: this.waves[this.currentWaveIndex]!,
            targetEntryPointId: this.entryPointId,
            rng: this.rng,
          });
        }
        this.phase = "build";
        break;
    }
  }

  /**
   * Walks every place a request can live between ticks: pending queues,
   * blocked-parent pool, active streams, and EngineBufferable partitions.
   */
  isWaveDrained(state: SimulationState): boolean {
    if (!this.trafficSource.isExhausted()) return false;
    for (const arr of state.pending.values()) {
      if (arr.length > 0) return false;
    }
    if (state.blockedParents.size > 0) return false;
    if (state.activeStreams.size > 0) return false;
    for (const componentId of state.visitOrder) {
      const component = state.components.get(componentId);
      if (!component) continue;
      for (const cap of component.capabilities.values()) {
        if (isEngineBufferable(cap) && cap.peekBuffered().length > 0)
          return false;
      }
    }
    return true;
  }

  getInitialZoneTopology(): ZoneTopology {
    return { zones: ["default"], pairLatency: new Map() };
  }

  // === Stage 3b: real tryPlace + new tryConnect ===
  // (Filled in by Tasks 7 and 8 — leave as stubs for now)

  tryPlace(
    state: SimulationState,
    type: string,
    position: Position,
    zone: string | null,
  ): PlacementResult {
    // 1. Phase check
    if (this.phase !== "build") {
      return { ok: false, reason: "disallowed_by_mode", detail: "wrong phase" };
    }
    // 2. Allowlist check
    const wave = this.getCurrentWave();
    if (!wave.availableComponents.includes(type)) {
      return {
        ok: false,
        reason: "disallowed_by_mode",
        detail: "type not in current wave's allowlist",
      };
    }
    // 3. Registry mint
    const component = this.componentRegistry.tryCreate(type, position, zone);
    if (!component) {
      return { ok: false, reason: "registry_unknown_type", detail: type };
    }
    // 4. Budget check
    if (!this.economy.canAfford(component.placementCost)) {
      return { ok: false, reason: "insufficient_budget" };
    }
    // 5. Debit + place
    this.economy.debitPlacement(component);
    state.placeComponent(component);
    this.placementSerial += 1;
    // 6. Return
    return { ok: true, componentId: component.id };
  }

  tryConnect(
    state: SimulationState,
    sourceComponentId: ComponentId,
    targetComponentId: ComponentId,
  ): ConnectResult {
    void state;
    void sourceComponentId;
    void targetComponentId;
    throw new Error("tryConnect not yet implemented (Task 8)");
  }

  tryUpgrade(
    state: SimulationState,
    componentId: ComponentId,
    capabilityId: CapabilityId,
  ): UpgradeResult {
    const component = state.components.get(componentId);
    if (!component) {
      return {
        ok: false,
        reason: "capability_not_found",
        detail: "Component not found",
      };
    }
    const ids = component.getCapabilityIds();
    if (!ids.includes(capabilityId)) {
      return { ok: false, reason: "capability_not_found" };
    }
    return {
      ok: true,
      newPlayerTier: component.getPlayerTier(capabilityId) + 1,
    };
  }

  getScheduledChaos(_currentTick: number): readonly ChaosEvent[] {
    return [];
  }
}

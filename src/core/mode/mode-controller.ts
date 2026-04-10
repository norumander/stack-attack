import type { ComponentReader } from "../component/component-reader.js";
import type { CapabilityId, ComponentId } from "../types/ids.js";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "../types/build-constraints.js";
import type { TickMetrics } from "../types/metrics.js";
import type { OutcomeReport } from "../types/outcome.js";
import type { ZoneTopology } from "../types/zone.js";
import type { ChaosEvent } from "../types/chaos.js";
import type { Position } from "../types/position.js";
import type { SimulationState } from "../state/simulation-state.js";
import type { SimulationStateReader } from "../state/state-reader.js";
import type { EconomyStrategy } from "./economy-strategy.js";
import type { TrafficSource } from "./traffic-source.js";

export interface ModeController {
  readonly economy: EconomyStrategy;

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId>;
  getTierCap(component: ComponentReader, capabilityId: CapabilityId): number;

  getBuildConstraints(): BuildConstraints;
  getTrafficSource(): TrafficSource;
  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport;
  getPhase(): "build" | "simulate" | "assess";
  advancePhase(): void;
  getInitialZoneTopology(): ZoneTopology;

  tryPlace(
    state: SimulationState,
    type: string,
    position: Position,
    zone: string | null,
  ): PlacementResult;
  tryUpgrade(
    state: SimulationState,
    componentId: ComponentId,
    capabilityId: CapabilityId,
  ): UpgradeResult;

  getScheduledChaos(currentTick: number): readonly ChaosEvent[];

  onTick?(state: SimulationStateReader): void;
}

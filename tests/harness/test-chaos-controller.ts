import type { ChaosEvent } from "@core/types/chaos";
import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { ComponentId, CapabilityId } from "@core/types/ids";
import type { ComponentReader } from "@core/component/component-reader";
import type { Position } from "@core/types/position";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "@core/types/build-constraints";
import type { TickMetrics } from "@core/types/metrics";
import type { OutcomeReport } from "@core/types/outcome";
import type { ZoneTopology } from "@core/types/zone";
import type { SimulationState } from "@core/state/simulation-state";
import type { ModeController } from "@core/mode/mode-controller";
import type { TrafficSource } from "@core/mode/traffic-source";
import { NoOpModeController } from "./noop-mode-controller.js";
import type { FixedIntensityConfig } from "./fixed-intensity-traffic-source.js";

export interface TestChaosOpts {
  schedule?: Map<number, readonly ChaosEvent[]>;
  economy?: EconomyStrategy;
  traffic?: FixedIntensityConfig;
}

export class TestChaosController implements ModeController {
  private readonly inner: NoOpModeController;
  private readonly schedule: Map<number, readonly ChaosEvent[]>;
  readonly economy: EconomyStrategy;

  constructor(opts: TestChaosOpts = {}) {
    this.inner = new NoOpModeController(
      opts.traffic ?? {
        targetEntryPointId: "x" as ComponentId,
        intensity: 0,
        requestType: "api_read",
      },
    );
    this.schedule = opts.schedule ?? new Map();
    this.economy = opts.economy ?? this.inner.economy;
  }

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId> {
    return this.inner.getActiveCapabilities(component);
  }

  getTierCap(component: ComponentReader, capabilityId: CapabilityId): number {
    return this.inner.getTierCap(component, capabilityId);
  }

  getBuildConstraints(): BuildConstraints {
    return this.inner.getBuildConstraints();
  }

  getTrafficSource(): TrafficSource {
    return this.inner.getTrafficSource();
  }

  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport {
    return this.inner.evaluateOutcome(metrics);
  }

  getPhase(): "build" | "simulate" | "assess" {
    return this.inner.getPhase();
  }

  advancePhase(): void {
    this.inner.advancePhase();
  }

  getInitialZoneTopology(): ZoneTopology {
    return this.inner.getInitialZoneTopology();
  }

  tryPlace(
    state: SimulationState,
    type: string,
    position: Position,
    zone: string | null,
  ): PlacementResult {
    return this.inner.tryPlace(state, type, position, zone);
  }

  tryUpgrade(
    state: SimulationState,
    componentId: ComponentId,
    capabilityId: CapabilityId,
  ): UpgradeResult {
    return this.inner.tryUpgrade(state, componentId, capabilityId);
  }

  getScheduledChaos(tick: number): readonly ChaosEvent[] {
    return this.schedule.get(tick) ?? [];
  }
}

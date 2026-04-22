import { BaseController, type BaseCallbacks } from "../physics-td/base-controller";
import { COMPONENT_COSTS } from "../physics-td/component-factory";
import type { WaveRevenue } from "@sim/wave";

export type SandboxPhase = "build" | "simulate";

const INFINITE_BUDGET = 999_999;
const SANDBOX_REVENUE: WaveRevenue = {
  perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3,
};

export class SandboxController extends BaseController {
  phase: SandboxPhase = "build";

  constructor(callbacks: BaseCallbacks) {
    super(COMPONENT_COSTS, callbacks, INFINITE_BUDGET);
  }

  protected override isBuildPhase(): boolean {
    return this.phase === "build";
  }

  protected override deleteRefundRate(): number {
    return 1;
  }

  currentWaveRevenue(): WaveRevenue {
    return SANDBOX_REVENUE;
  }

  startSimulate(): void {
    this.phase = "simulate";
  }

  stopSimulate(): void {
    this.phase = "build";
  }
}

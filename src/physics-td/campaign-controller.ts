import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { WaveRevenue } from "@sim/wave";
import type { Sim } from "@sim/sim";
import { applyChaosEvent, type ChaosEvent } from "./chaos";
import {
  BaseController,
  type BaseCallbacks,
  type PlaceResult,
  type ConnectResult,
} from "./base-controller";

export type Phase = "build" | "simulate" | "won" | "campaign-complete";

export type WaveSlot = {
  readonly id: string;
  readonly startBudget: number;
  readonly revenue: WaveRevenue;
  /** Optional chaos schedule for this wave, fired during simulate phase. */
  readonly chaosSchedule?: ReadonlyArray<ChaosEvent>;
};

// Re-exported for callers that import from this module.
export type { PlaceResult, ConnectResult };

export type CampaignCallbacks = BaseCallbacks & {
  onPhaseChange(phase: Phase, waveIndex: number): void;
};

export type CampaignOptions = {
  readonly waves: ReadonlyArray<WaveSlot>;
  readonly componentCosts: ReadonlyMap<string, number>;
  readonly callbacks: CampaignCallbacks;
};

/**
 * Campaign mode: player builds from scratch, budgets chain across waves,
 * deletion refunds 100% of cost.
 */
export class PhysicsCampaignController extends BaseController {
  phase: Phase = "build";
  currentWaveIndex = 0;
  /** Seconds elapsed in the current simulate phase — reset on each wave start. */
  private waveElapsedSeconds = 0;
  /** Indices (into currentWave.chaosSchedule) that have already fired. */
  private readonly firedChaosIndices: Set<number> = new Set();

  private readonly campaignCallbacks: CampaignCallbacks;
  private readonly waves: ReadonlyArray<WaveSlot>;

  constructor(opts: CampaignOptions) {
    super(opts.componentCosts, opts.callbacks, opts.waves[0]?.startBudget ?? 0);
    this.campaignCallbacks = opts.callbacks;
    this.waves = opts.waves;
  }

  protected override isBuildPhase(): boolean {
    return this.phase === "build";
  }

  protected override deleteRefundRate(): number {
    return 1;
  }

  ready(): void {
    if (this.phase !== "build") return;
    this.phase = "simulate";
    this.waveElapsedSeconds = 0;
    this.firedChaosIndices.clear();
    this.campaignCallbacks.onPhaseChange(this.phase, this.currentWaveIndex);
  }

  tickChaos(dtSeconds: number, sim: Sim): void {
    if (this.phase !== "simulate") return;
    this.waveElapsedSeconds += dtSeconds;
    const schedule = this.waves[this.currentWaveIndex]?.chaosSchedule;
    if (!schedule || schedule.length === 0) return;
    for (let i = 0; i < schedule.length; i += 1) {
      if (this.firedChaosIndices.has(i)) continue;
      const event = schedule[i]!;
      if (event.atSeconds <= this.waveElapsedSeconds) {
        applyChaosEvent(event, sim);
        this.firedChaosIndices.add(i);
      }
    }
  }

  currentWaveRevenue(): WaveRevenue {
    return this.waves[this.currentWaveIndex]!.revenue;
  }

  onWaveEnd(): void {
    if (this.phase !== "simulate") return;
    this.phase = "won";
    this.campaignCallbacks.onPhaseChange(this.phase, this.currentWaveIndex);
  }

  /** Deduct the SLA financial penalty at wave end (can push budget negative). */
  applyPenalty(dollars: number): void {
    if (dollars <= 0) return;
    this.budget -= dollars;
    this.campaignCallbacks.onBudgetChange(this.budget);
  }

  nextWave(): void {
    if (this.phase !== "won") return;
    this.currentWaveIndex += 1;
    if (this.currentWaveIndex >= this.waves.length) {
      this.phase = "campaign-complete";
      this.campaignCallbacks.onPhaseChange(this.phase, this.currentWaveIndex - 1);
      return;
    }
    this.budget += this.waves[this.currentWaveIndex]!.startBudget;
    this.phase = "build";
    this.campaignCallbacks.onPhaseChange(this.phase, this.currentWaveIndex);
    this.campaignCallbacks.onBudgetChange(this.budget);
  }

  jumpToWave(index: number): void {
    const clamped = Math.max(0, Math.min(this.waves.length - 1, index));
    this.currentWaveIndex = clamped;
    this.budget = this.waves[clamped]!.startBudget;
    this.placedComponents.clear();
    this.placedTypes.clear();
    this.placedConnections.clear();
    this.phase = "build";
    this.waveElapsedSeconds = 0;
    this.firedChaosIndices.clear();
    this.campaignCallbacks.onPhaseChange(this.phase, this.currentWaveIndex);
    this.campaignCallbacks.onBudgetChange(this.budget);
  }
}

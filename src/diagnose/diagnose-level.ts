import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { TopologyDef } from "../playtest/topology-builder";
import type { ChaosEvent } from "../physics-td/chaos";
import { INSTAGRAM_LEVELS } from "./instagram-levels";
import { NETFLIX_LEVELS } from "./netflix-levels";

/**
 * A Diagnose Mode level: the player inherits a pre-built 15–20 component
 * system with subtle flaws and must observe symptoms + fix the architecture
 * to meet SLA under a single revealing wave.
 */
export interface DiagnoseLevel {
  readonly id: string;
  readonly title: string;
  readonly briefing: string;
  readonly narrative?: string;
  /** Pre-placed topology the player inherits. Built by the framework before the player takes control. */
  readonly startingTopology: TopologyDef;
  /** Remediation budget — smaller than campaign; represents what ops has available to fix. */
  readonly remediationBudget: number;
  /** The wave that reveals the flaw(s). */
  readonly wave: WaveDef;
  readonly sla: SLAThresholds;
  /** Partial refund rate on delete, 0..1. Default 0.7 (real-world sunk cost). */
  readonly deleteRefundRate?: number;
  /**
   * Optional chaos schedule. Campaign puts this on `CampaignWave`, not on
   * `WaveDef` — so for diagnose we hang it off the level. The bootstrap /
   * playtest layer threads this through `simulatePlaytest`'s chaosSchedule
   * option at run time. Keeping it here (rather than on the bare WaveDef)
   * also matches how `CampaignWave.chaosSchedule` works and keeps the sim
   * core unaware of "chaos" as a concept.
   */
  readonly chaosSchedule?: ReadonlyArray<ChaosEvent>;
}

/**
 * Live catalogue of diagnose levels. Populated with the Instagram 5-level
 * arc followed by the Netflix 5-level arc. A placeholder level is exported
 * separately from `./placeholder-level.ts` purely for wiring verification
 * and is NOT part of the shipped catalogue.
 */
export const DIAGNOSE_LEVELS: ReadonlyArray<DiagnoseLevel> = [
  ...INSTAGRAM_LEVELS,
  ...NETFLIX_LEVELS,
];

export { INSTAGRAM_LEVELS } from "./instagram-levels";
export { NETFLIX_LEVELS } from "./netflix-levels";

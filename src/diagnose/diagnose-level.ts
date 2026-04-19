import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { TopologyDef } from "../playtest/topology-builder";

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
}

/**
 * Live catalogue of diagnose levels. Kept empty in the framework lane; the
 * content lane (Instagram Level 1, etc.) populates it. A placeholder level
 * is exported separately from `./placeholder-level.ts` purely for wiring
 * verification and is NOT part of the shipped catalogue.
 */
export const DIAGNOSE_LEVELS: ReadonlyArray<DiagnoseLevel> = [];

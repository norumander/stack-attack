import type { ComponentId } from "@core/types/ids";
import {
  BaseController,
  mintComponentId,
  type BaseCallbacks,
} from "../physics-td/base-controller";
import type { DiagnoseLevel } from "./diagnose-level";

export type DiagnosePhase = "build" | "simulate" | "won" | "lost";

export const DEFAULT_DELETE_REFUND_RATE = 0.7;

export type DiagnoseCallbacks = BaseCallbacks & {
  onPhaseChange(phase: DiagnosePhase): void;
};

export type DiagnoseOptions = {
  readonly level: DiagnoseLevel;
  readonly componentCosts: ReadonlyMap<string, number>;
  readonly callbacks: DiagnoseCallbacks;
};

/**
 * Diagnose Mode controller: variant of PhysicsCampaignController that
 * pre-places a starting topology and uses a partial refund rate on delete.
 *
 * Differences vs campaign:
 *  - Startup pre-places every component + connection in the level's
 *    starting topology via the same callbacks the renderer already
 *    consumes (`onPlaced`, `onConnected`).
 *  - Budget is the level's `remediationBudget` (not cumulative).
 *  - `tryDeleteComponent` refunds `deleteRefundRate × cost`
 *    (default 0.7) instead of the full cost.
 *  - `won` vs `lost` is determined by the SLA evaluator at wave end, not
 *    by the player "completing" a wave.
 */
export class PhysicsDiagnoseController extends BaseController {
  phase: DiagnosePhase = "build";

  private readonly diagnoseCallbacks: DiagnoseCallbacks;
  private readonly refundRate: number;
  readonly level: DiagnoseLevel;

  /**
   * Map from topology builder id (e.g. "s1") to minted ComponentId. Exposed
   * so bootstrap can translate topology `connect(from, to)` pairs into
   * real id-to-id connections after pre-placement.
   */
  readonly topologyIdMap: Map<string, ComponentId> = new Map();

  constructor(opts: DiagnoseOptions) {
    super(opts.componentCosts, opts.callbacks, opts.level.remediationBudget);
    this.diagnoseCallbacks = opts.callbacks;
    this.level = opts.level;
    this.refundRate = opts.level.deleteRefundRate ?? DEFAULT_DELETE_REFUND_RATE;
  }

  protected override isBuildPhase(): boolean {
    return this.phase === "build";
  }

  protected override deleteRefundRate(): number {
    return this.refundRate;
  }

  /**
   * Pre-place the starting topology. Must be called exactly once, before
   * the player takes control. Emits `onPlaced` + `onConnected` through the
   * usual callback surface so the renderer and sim stay in sync.
   *
   * Placement positions are derived by laying components out in a grid —
   * the content lane can override by baking positions into the
   * TopologyDef later if needed, but the builder shape doesn't carry them
   * today so we compute a deterministic fallback here.
   *
   * Pre-placement does NOT deduct budget — these are components the
   * player inherits, not buys.
   */
  preplace(positionFor?: (topologyId: string, index: number) => { x: number; y: number }): void {
    if (this.topologyIdMap.size > 0) return; // idempotent guard
    const topo = this.level.startingTopology;

    // 1) Place every component, recording its minted id keyed by topology id.
    //    Register the topology→minted mapping BEFORE firing onPlaced so the
    //    callback can resolve the topology label via topologyIdMap.
    topo.components.forEach((comp, i) => {
      const pos = positionFor ? positionFor(comp.id, i) : defaultLayout(i);
      const id = mintComponentId();
      this.topologyIdMap.set(comp.id, id);
      this.placedComponents.add(id);
      this.placedTypes.set(id, comp.type);
      this.diagnoseCallbacks.onPlaced(comp.type, id, pos);
    });

    // 2) Wire every connection. Skip (with a console warn) any edge that
    //    references an unknown topology id rather than throwing — content
    //    authors should see the topology render and then fix their DSL.
    for (const edge of topo.connections) {
      const fromId = this.topologyIdMap.get(edge.from);
      const toId = this.topologyIdMap.get(edge.to);
      if (!fromId || !toId) {
        // eslint-disable-next-line no-console
        console.warn(`[diagnose] skipping edge with unknown endpoint: ${edge.from} → ${edge.to}`);
        continue;
      }
      this.tryConnect(fromId, toId);
    }
  }


  ready(): void {
    if (this.phase !== "build") return;
    this.phase = "simulate";
    this.diagnoseCallbacks.onPhaseChange(this.phase);
  }

  /** Called by bootstrap when the wave ends with SLA-pass → won / SLA-fail → lost. */
  onWaveEnd(slaPassed: boolean): void {
    if (this.phase !== "simulate") return;
    this.phase = slaPassed ? "won" : "lost";
    this.diagnoseCallbacks.onPhaseChange(this.phase);
  }
}

function defaultLayout(index: number): { x: number; y: number } {
  // Simple 4-wide grid for now. Content lane can supply better positions
  // via the optional `positionFor` hook.
  const cols = 4;
  return { x: index % cols, y: Math.floor(index / cols) };
}

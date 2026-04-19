import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { WaveRevenue } from "@sim/wave";
import type { TopologyError } from "./validate-topology";

export type Phase = "build" | "simulate" | "won" | "campaign-complete";

export type WaveSlot = {
  readonly id: string;
  readonly startBudget: number;
  readonly revenue: WaveRevenue;
};

export type PlaceResult =
  | { readonly ok: true; readonly componentId: ComponentId }
  | { readonly ok: false; readonly reason: "insufficient_budget" | "unknown_type" };

export type ConnectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "self_connect" | "already_connected" };

export type CampaignCallbacks = {
  onPlaced(type: string, componentId: ComponentId, gridPos: { x: number; y: number }): void;
  onConnected(sourceId: ComponentId, targetId: ComponentId, forwardId: ConnectionId, backId: ConnectionId): void;
  onComponentDeleted(componentId: ComponentId): void;
  onConnectionDeleted(forwardId: ConnectionId): void;
  onPhaseChange(phase: Phase, waveIndex: number): void;
  onBudgetChange(budget: number): void;
};

export type CampaignOptions = {
  readonly waves: ReadonlyArray<WaveSlot>;
  readonly componentCosts: ReadonlyMap<string, number>;
  readonly callbacks: CampaignCallbacks;
};

let nextComponentIdCounter = 0;
let nextConnectionIdCounter = 0;

function mintComponentId(): ComponentId {
  nextComponentIdCounter += 1;
  return `c${String(nextComponentIdCounter).padStart(6, "0")}` as ComponentId;
}

function mintConnectionId(): ConnectionId {
  nextConnectionIdCounter += 1;
  return `conn${String(nextConnectionIdCounter).padStart(6, "0")}` as ConnectionId;
}

export class PhysicsCampaignController {
  phase: Phase = "build";
  currentWaveIndex = 0;
  budget: number;
  readonly placedComponents: Set<ComponentId> = new Set();
  readonly placedTypes: Map<ComponentId, string> = new Map();
  /** key = sourceId + ":" + targetId → forward connection id (so deletion can find it) */
  readonly placedConnections: Map<string, ConnectionId> = new Map();

  /**
   * Most recent pre-sim topology validation result. Populated by the
   * bootstrap on READY before `phase = "simulate"`. Does not block
   * simulation — surfaced as a warning in the HUD.
   * TODO: wire to a HUD warning UI so players see unreachable request
   * types before the wave starts.
   */
  lastTopologyErrors: readonly TopologyError[] = [];

  constructor(private readonly opts: CampaignOptions) {
    this.budget = opts.waves[0]?.startBudget ?? 0;
  }

  tryPlace(type: string, gridPos: { x: number; y: number }): PlaceResult {
    if (this.phase !== "build") return { ok: false, reason: "insufficient_budget" };
    const cost = this.opts.componentCosts.get(type);
    if (cost === undefined) return { ok: false, reason: "unknown_type" };
    if (this.budget < cost) return { ok: false, reason: "insufficient_budget" };
    this.budget -= cost;
    const id = mintComponentId();
    this.placedComponents.add(id);
    this.placedTypes.set(id, type);
    this.opts.callbacks.onPlaced(type, id, gridPos);
    this.opts.callbacks.onBudgetChange(this.budget);
    return { ok: true, componentId: id };
  }

  tryConnect(sourceId: ComponentId, targetId: ComponentId): ConnectResult {
    if (this.phase !== "build") return { ok: false, reason: "self_connect" };
    if (sourceId === targetId) return { ok: false, reason: "self_connect" };
    const key = `${sourceId as unknown as string}:${targetId as unknown as string}`;
    if (this.placedConnections.has(key)) return { ok: false, reason: "already_connected" };
    const forwardId = mintConnectionId();
    const backId = mintConnectionId();
    this.placedConnections.set(key, forwardId);
    this.opts.callbacks.onConnected(sourceId, targetId, forwardId, backId);
    return { ok: true };
  }

  /** Refunds the component's cost, deletes any connection touching it, and fires onComponentDeleted. */
  tryDeleteComponent(componentId: ComponentId): boolean {
    if (this.phase !== "build") return false;
    if (!this.placedComponents.has(componentId)) return false;
    const type = this.placedTypes.get(componentId);
    const refund = type ? (this.opts.componentCosts.get(type) ?? 0) : 0;
    // Delete every connection touching this component
    const idStr = componentId as unknown as string;
    for (const [key, fwdId] of [...this.placedConnections.entries()]) {
      const [src, tgt] = key.split(":");
      if (src === idStr || tgt === idStr) {
        this.placedConnections.delete(key);
        this.opts.callbacks.onConnectionDeleted(fwdId);
      }
    }
    this.placedComponents.delete(componentId);
    this.placedTypes.delete(componentId);
    this.budget += refund;
    this.opts.callbacks.onComponentDeleted(componentId);
    this.opts.callbacks.onBudgetChange(this.budget);
    return true;
  }

  /** Deletes the connection identified by its forward id (twin-pair deleted together by bootstrap). */
  tryDeleteConnection(forwardId: ConnectionId): boolean {
    if (this.phase !== "build") return false;
    for (const [key, fwdId] of this.placedConnections.entries()) {
      if (fwdId === forwardId) {
        this.placedConnections.delete(key);
        this.opts.callbacks.onConnectionDeleted(forwardId);
        return true;
      }
    }
    return false;
  }

  ready(): void {
    if (this.phase !== "build") return;
    this.phase = "simulate";
    this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex);
  }

  currentWaveRevenue(): WaveRevenue {
    return this.opts.waves[this.currentWaveIndex]!.revenue;
  }

  /** Dev affordance — grant cash for playtesting. Remove before ship. */
  devGrant(dollars: number): void {
    this.budget += dollars;
    this.opts.callbacks.onBudgetChange(this.budget);
  }

  onWaveEnd(): void {
    if (this.phase !== "simulate") return;
    this.phase = "won";
    this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex);
  }

  /** Deduct the SLA financial penalty at wave end (can push budget negative). */
  applyPenalty(dollars: number): void {
    if (dollars <= 0) return;
    this.budget -= dollars;
    this.opts.callbacks.onBudgetChange(this.budget);
  }

  nextWave(): void {
    if (this.phase !== "won") return;
    this.currentWaveIndex += 1;
    if (this.currentWaveIndex >= this.opts.waves.length) {
      this.phase = "campaign-complete";
      this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex - 1);
      return;
    }
    // Budget carries forward from prior wave end, plus the next wave's startBudget grant.
    this.budget += this.opts.waves[this.currentWaveIndex]!.startBudget;
    this.phase = "build";
    this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex);
    this.opts.callbacks.onBudgetChange(this.budget);
  }

  /**
   * Dev affordance: jump to an arbitrary wave, clearing prior placements
   * and re-seeding budget to that wave's startBudget. Bootstrap is
   * responsible for clearing the visuals via clearWaveWorld().
   */
  jumpToWave(index: number): void {
    const clamped = Math.max(0, Math.min(this.opts.waves.length - 1, index));
    this.currentWaveIndex = clamped;
    this.budget = this.opts.waves[clamped]!.startBudget;
    this.placedComponents.clear();
    this.placedTypes.clear();
    this.placedConnections.clear();
    this.phase = "build";
    this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex);
    this.opts.callbacks.onBudgetChange(this.budget);
  }
}

import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { TopologyError } from "./validate-topology";

/**
 * Shared callback shape used by both campaign and diagnose controllers.
 * Keeping it in a single file so the two modes stay binary-compatible with
 * the renderer/hud wiring in physics-td.ts and diagnose-boot.ts.
 */
export type BaseCallbacks = {
  onPlaced(type: string, componentId: ComponentId, gridPos: { x: number; y: number }): void;
  onConnected(sourceId: ComponentId, targetId: ComponentId, forwardId: ConnectionId, backId: ConnectionId): void;
  onComponentDeleted(componentId: ComponentId): void;
  onConnectionDeleted(forwardId: ConnectionId): void;
  onBudgetChange(budget: number): void;
};

export type PlaceResult =
  | { readonly ok: true; readonly componentId: ComponentId }
  | { readonly ok: false; readonly reason: "insufficient_budget" | "unknown_type" };

export type ConnectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "self_connect" | "already_connected" };

/**
 * Both controllers share a single monotonic id pool so component/connection
 * ids never collide across mode switches within the same page load.
 */
let nextComponentIdCounter = 0;
let nextConnectionIdCounter = 0;

export function mintComponentId(): ComponentId {
  nextComponentIdCounter += 1;
  return `c${String(nextComponentIdCounter).padStart(6, "0")}` as ComponentId;
}

export function mintConnectionId(): ConnectionId {
  nextConnectionIdCounter += 1;
  return `conn${String(nextConnectionIdCounter).padStart(6, "0")}` as ConnectionId;
}

/**
 * Abstract base that factors out placement, connection, and deletion logic
 * shared between campaign mode (build-from-scratch) and diagnose mode
 * (inherit-a-system). Subclasses own phase machinery and wave lifecycle.
 *
 * The only knob that varies per mode is `deleteRefundRate` — campaign
 * refunds 100%, diagnose refunds partial (~70%) to model sunk cost.
 */
export abstract class BaseController {
  budget: number;
  readonly placedComponents: Set<ComponentId> = new Set();
  readonly placedTypes: Map<ComponentId, string> = new Map();
  /** key = sourceId + ":" + targetId → forward connection id (so deletion can find it) */
  readonly placedConnections: Map<string, ConnectionId> = new Map();

  /** Most recent pre-sim topology validation result. */
  lastTopologyErrors: readonly TopologyError[] = [];

  protected constructor(
    protected readonly componentCosts: ReadonlyMap<string, number>,
    protected readonly baseCallbacks: BaseCallbacks,
    initialBudget: number,
  ) {
    this.budget = initialBudget;
  }

  /** Subclass reports whether placement/connection/deletion is currently allowed. */
  protected abstract isBuildPhase(): boolean;

  /** Subclass knob: fraction of cost returned on delete. Campaign=1, diagnose=~0.7. */
  protected abstract deleteRefundRate(): number;

  tryPlace(type: string, gridPos: { x: number; y: number }): PlaceResult {
    if (!this.isBuildPhase()) return { ok: false, reason: "insufficient_budget" };
    const cost = this.componentCosts.get(type);
    if (cost === undefined) return { ok: false, reason: "unknown_type" };
    if (this.budget < cost) return { ok: false, reason: "insufficient_budget" };
    this.budget -= cost;
    const id = mintComponentId();
    this.placedComponents.add(id);
    this.placedTypes.set(id, type);
    this.baseCallbacks.onPlaced(type, id, gridPos);
    this.baseCallbacks.onBudgetChange(this.budget);
    return { ok: true, componentId: id };
  }

  tryConnect(sourceId: ComponentId, targetId: ComponentId): ConnectResult {
    if (!this.isBuildPhase()) return { ok: false, reason: "self_connect" };
    if (sourceId === targetId) return { ok: false, reason: "self_connect" };
    const key = `${sourceId as unknown as string}:${targetId as unknown as string}`;
    if (this.placedConnections.has(key)) return { ok: false, reason: "already_connected" };
    const forwardId = mintConnectionId();
    const backId = mintConnectionId();
    this.placedConnections.set(key, forwardId);
    this.baseCallbacks.onConnected(sourceId, targetId, forwardId, backId);
    return { ok: true };
  }

  tryDeleteComponent(componentId: ComponentId): boolean {
    if (!this.isBuildPhase()) return false;
    if (!this.placedComponents.has(componentId)) return false;
    const type = this.placedTypes.get(componentId);
    const fullCost = type ? (this.componentCosts.get(type) ?? 0) : 0;
    const refund = Math.round(fullCost * this.deleteRefundRate());
    const idStr = componentId as unknown as string;
    for (const [key, fwdId] of [...this.placedConnections.entries()]) {
      const [src, tgt] = key.split(":");
      if (src === idStr || tgt === idStr) {
        this.placedConnections.delete(key);
        this.baseCallbacks.onConnectionDeleted(fwdId);
      }
    }
    this.placedComponents.delete(componentId);
    this.placedTypes.delete(componentId);
    this.budget += refund;
    this.baseCallbacks.onComponentDeleted(componentId);
    this.baseCallbacks.onBudgetChange(this.budget);
    return true;
  }

  tryDeleteConnection(forwardId: ConnectionId): boolean {
    if (!this.isBuildPhase()) return false;
    for (const [key, fwdId] of this.placedConnections.entries()) {
      if (fwdId === forwardId) {
        this.placedConnections.delete(key);
        this.baseCallbacks.onConnectionDeleted(forwardId);
        return true;
      }
    }
    return false;
  }

  /** Dev affordance — grant cash for playtesting. */
  devGrant(dollars: number): void {
    this.budget += dollars;
    this.baseCallbacks.onBudgetChange(this.budget);
  }
}

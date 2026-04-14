import type { ComponentId, ConnectionId } from "@core/types/ids.js";

/**
 * Stage 3c renderer interface. The dashboard depends on this — NOT on pixi.js
 * directly. The only file that imports pixi is pixi-topology-renderer.ts.
 *
 * Future components and mechanics extend the dashboard's use of this interface;
 * Pixi v8 (or any future renderer swap) is a single-file change.
 */
export interface TopologyRenderer {
  // ─ Lifecycle ──────────────────────────────────────────────────────────
  mount(container: HTMLElement): void;
  destroy(): void;
  resize(width: number, height: number): void;

  // ─ Components ─────────────────────────────────────────────────────────
  addComponent(id: ComponentId, visual: ComponentVisual): void;
  removeComponent(id: ComponentId): void;
  updateComponent(id: ComponentId, update: ComponentUpdate): void;

  // ─ Connections ────────────────────────────────────────────────────────
  addConnection(id: ConnectionId, sourceId: ComponentId, targetId: ComponentId): void;
  removeConnection(id: ConnectionId): void;
  updateConnection(id: ConnectionId, update: ConnectionUpdate): void;

  // ─ Requests (fire-and-forget animations) ──────────────────────────────
  spawnRequestDot(args: SpawnRequestDotArgs): void;

  // ─ One-shot feedback ──────────────────────────────────────────────────
  flashOverload(id: ComponentId): void;
  flashDrop(id: ComponentId): void;

  // ─ Selection + placement preview ──────────────────────────────────────
  setSelected(id: ComponentId | null): void;
  setPlacementGhost(type: string | null, screenPos: { x: number; y: number } | null): void;

  // ─ Input queries (screen-space ↔ world-space) ─────────────────────────
  hitTest(screenX: number, screenY: number): { componentId: ComponentId } | null;
  screenToGrid(screenX: number, screenY: number): { x: number; y: number };
  worldToScreen(gridPos: { x: number; y: number }): { x: number; y: number };

  // ─ Pointer events ─────────────────────────────────────────────────────
  onPointerDown(cb: (ev: RendererPointerEvent) => void): () => void;
  onPointerMove(cb: (ev: RendererPointerEvent) => void): () => void;
}

export interface ComponentVisual {
  type: string;                        // 'server' | 'database' | 'cache' | ...
  displayName: string;
  gridPosition: { x: number; y: number };
}

export interface ComponentUpdate {
  utilization?: number;   // 0..1 → color lerp (green → yellow → red)
  condition?: number;     // 0..1 → health ring arc length
  pendingCount?: number;  // displayed in the component label
  gridPosition?: { x: number; y: number };
}

export interface ConnectionUpdate {
  loadUtilization?: number; // 0..1 → line opacity / thickness
}

export interface SpawnRequestDotArgs {
  connectionId: ConnectionId;
  requestType: string;     // 'api_read' | 'api_write' | 'stream_init' | ...
  durationMs: number;      // travel time from source to target
}

export interface RendererPointerEvent {
  screenX: number;
  screenY: number;
  hit: { componentId: ComponentId } | null;
}

import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids.js";

/**
 * Stage 3c renderer interface. The dashboard depends on this — NOT on pixi.js
 * directly. The only file that imports pixi is pixi-topology-renderer.ts.
 *
 * Future components and mechanics extend the dashboard's use of this interface;
 * Pixi v8 (or any future renderer swap) is a single-file change.
 */
export interface TopologyRenderer {
  // ─ Lifecycle ──────────────────────────────────────────────────────────
  mount(container: HTMLElement): Promise<void>;
  destroy(): void;
  resize(width: number, height: number): void;

  // ─ Components ─────────────────────────────────────────────────────────
  addComponent(id: ComponentId, visual: ComponentVisual): void;
  removeComponent(id: ComponentId): void;
  updateComponent(id: ComponentId, update: ComponentUpdate): void;

  // ─ Connections ────────────────────────────────────────────────────────
  addConnection(
    id: ConnectionId,
    sourceId: ComponentId,
    targetId: ComponentId,
    options?: { direction?: "forward" | "back" },
  ): void;
  removeConnection(id: ConnectionId): void;
  updateConnection(id: ConnectionId, update: ConnectionUpdate): void;

  // ─ Requests (fire-and-forget animations) ──────────────────────────────
  spawnRequestDot(args: SpawnRequestDotArgs): void;

  /**
   * Update the visible "snake" of upcoming packets queued at a client.
   * Renderer displays up to the first 10 packets trailing behind the
   * client sprite (desaturated). Optional — renderers that don't support
   * snake rendering can omit this method.
   */
  updateClientSnake?(
    clientId: ComponentId,
    packets: ReadonlyArray<{ id: string; type: string; count: number }>,
    options?: { trailDirection?: { dx: number; dy: number } },
  ): void;

  // ─ One-shot feedback ──────────────────────────────────────────────────
  flashOverload(id: ComponentId): void;
  flashDrop(id: ComponentId): void;
  flashResponded(id: ComponentId): void;

  /**
   * Queue a ring pulse that fires when the dot carrying `requestId` retires
   * at `componentId` (dot animation finishes and returns to pool). If no
   * in-flight dot matches within a timeout window (~2× tick interval), the
   * flash fires anyway at the target component. This lets per-tick engine
   * events (SERVED/DROPPED/OVERLOADED) synchronize with the renderer's
   * per-frame dot animation instead of firing at tick-start while dots are
   * still mid-flight.
   */
  queueFlashOnRequestArrival(
    requestId: RequestId,
    componentId: ComponentId,
    kind: "served" | "drop" | "overload",
  ): void;

  // ─ Selection + placement preview ──────────────────────────────────────
  setSelected(id: ComponentId | null): void;
  setPlacementGhost(type: string | null, screenPos: { x: number; y: number } | null): void;
  /**
   * Signal that the user is mid-"connect two components" interaction. The
   * renderer may use this to adjust the cursor and disable pan gestures.
   * Classic renderer may implement as a noop.
   */
  setConnectionMode(active: boolean): void;

  // ─ Input queries (screen-space ↔ world-space) ─────────────────────────
  hitTest(screenX: number, screenY: number): { componentId: ComponentId } | null;
  /** Nearest connection (forward or back lane) within a ~10px threshold, else null. */
  hitTestConnection(screenX: number, screenY: number): ConnectionId | null;
  screenToGrid(screenX: number, screenY: number): { x: number; y: number };
  worldToScreen(gridPos: { x: number; y: number }): { x: number; y: number };

  // ─ Pointer events ─────────────────────────────────────────────────────
  onPointerDown(cb: (ev: RendererPointerEvent) => void): () => void;
  onPointerMove(cb: (ev: RendererPointerEvent) => void): () => void;
  /**
   * Subscribe to pointer-down events on a connection line. Fires when the
   * user clicks a rendered connection. Returns an unsubscribe function.
   */
  onConnectionPointerDown(cb: (connectionId: ConnectionId) => void): () => void;
  /**
   * Fires when the user releases a component drag. The renderer has already
   * moved the component visually to `gridPosition`; the game layer should
   * decide whether to commit (mutate game state) or revert (call
   * updateComponent with the original position).
   */
  onComponentDragEnd(
    cb: (args: {
      componentId: ComponentId;
      gridPosition: { x: number; y: number };
    }) => void,
  ): () => void;
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
  cacheKeys?: ReadonlyArray<string>;
  /**
   * Diagnose-mode "at-a-glance" stress indicator for per-component live
   * metrics. `stressed` tints the sprite orange; `dropping` adds a
   * pulsing red outline. Both may be true — dropping wins visually.
   */
  stress?: { stressed: boolean; dropping: boolean };
}

export interface ConnectionUpdate {
  loadUtilization?: number; // 0..1 → line opacity / thickness
}

export interface SpawnRequestDotArgs {
  connectionId: ConnectionId;
  requestId: RequestId;    // used to correlate with queued flashes
  requestType: string;     // 'api_read' | 'api_write' | 'stream_init' | ...
  durationMs: number;      // travel time from source to target
  /**
   * Delay (ms) before the dot starts moving. The dot is added immediately
   * but pinned at the source position until `startMs + spawnOffsetMs`
   * elapses. Used by the adapter to stagger dots that spawn on the same
   * connection in the same tick so they form a visible train instead of
   * stacking into one composite sprite.
   */
  spawnOffsetMs?: number;
  /**
   * How many engine requests this dot represents (per aggregated
   * `(connection, requestType)` group for the tick). Rendered as a small
   * numeric label on the dot so players can see flow weights on each edge.
   * Omitted or <=1 means no label is shown.
   */
  count?: number;
}

export interface RendererPointerEvent {
  screenX: number;
  screenY: number;
  hit: { componentId: ComponentId } | null;
}

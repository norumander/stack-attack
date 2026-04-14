import { Application, Container, Graphics, Text } from "pixi.js";
import type {
  TopologyRenderer,
  ComponentVisual,
  ComponentUpdate,
  ConnectionUpdate,
  SpawnRequestDotArgs,
  RendererPointerEvent,
} from "./topology-renderer.js";
import { utilizationColor } from "./utilization-color.js";
import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids.js";

/** Pixels per grid cell. Matches the old DOM renderer's 40px scale. */
const GRID_CELL_PX = 40;
/** Half-width of a component sprite in pixels. */
const COMPONENT_HALF = 18;

/**
 * Color palette for request dots by request type. Chosen for high
 * hue-contrast between read (cool cyan) and write (warm orange) so they
 * read as clearly different at a glance — previously magenta writes and
 * cyan reads were too similar in motion at high density.
 */
const REQUEST_TYPE_COLORS: Record<string, number> = {
  api_read: 0x22d3ee,    // bright cyan
  api_write: 0xf97316,   // bright orange
  stream_init: 0xfde047, // yellow
  default: 0x94a3b8,     // slate
};

interface ComponentRenderState {
  id: ComponentId;
  gridPosition: { x: number; y: number };
  displayName: string;
  sprite: Graphics;
  label: Text;
  ring: Graphics;
  container: Container;
  utilization: number;
  condition: number;
  pendingCount: number;
}

interface ConnectionRenderState {
  id: ConnectionId;
  sourceId: ComponentId;
  targetId: ComponentId;
  line: Graphics;
  loadUtilization: number;
}

interface ActiveDot {
  graphic: Graphics;
  connectionId: ConnectionId;
  requestId: RequestId;
  targetComponentId: ComponentId;
  startMs: number;
  durationMs: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface PendingFlash {
  requestId: RequestId;
  componentId: ComponentId;
  color: number;
  queuedAtMs: number;
}

const FLASH_COLORS = {
  served: 0x22c55e,
  drop: 0xef4444,
  overload: 0xfbbf24,
} as const;

/**
 * A pending flash that never gets matched to a retiring dot fires anyway
 * after this many milliseconds. Covers edge cases where the flash's
 * originating event has no corresponding FORWARDED dot (e.g. a request
 * dropped by condition drop-probability inside processPending, or an
 * OVERLOADED sweep hitting requests that were already in pending from a
 * previous tick with no new forward leg).
 */
const PENDING_FLASH_TIMEOUT_MS = 1000;

export class PixiTopologyRenderer implements TopologyRenderer {
  private app: Application | null = null;
  private world: Container | null = null;
  private connectionsLayer: Container | null = null;
  private dotsLayer: Container | null = null;
  private componentsLayer: Container | null = null;
  private selectionLayer: Container | null = null;
  private ghostLayer: Container | null = null;

  private readonly components = new Map<ComponentId, ComponentRenderState>();
  private readonly connections = new Map<ConnectionId, ConnectionRenderState>();

  private readonly activeDots: ActiveDot[] = [];
  private readonly pendingFlashes: PendingFlash[] = [];
  /**
   * The currently-animating dot for each request. Used to chain multi-hop
   * dots so a single request animates Client → Server → Database as a
   * continuous thread instead of spawning both hops' dots in parallel.
   */
  private readonly activeDotByRequest = new Map<RequestId, ActiveDot>();
  /**
   * Per-request queue of dots waiting for their predecessor to retire.
   * On retirement, the first queued dot for that request spawns immediately.
   */
  private readonly queuedDotsByRequest = new Map<RequestId, SpawnRequestDotArgs[]>();

  private selectedId: ComponentId | null = null;
  private ghostType: string | null = null;
  private ghostScreenPos: { x: number; y: number } | null = null;
  private selectionRing: Graphics | null = null;
  private ghostSprite: Graphics | null = null;

  private pointerDownCallbacks: Array<(ev: RendererPointerEvent) => void> = [];
  private pointerMoveCallbacks: Array<(ev: RendererPointerEvent) => void> = [];
  private mountedContainer: HTMLElement | null = null;

  async mount(container: HTMLElement): Promise<void> {
    this.mountedContainer = container;
    const app = new Application();
    await app.init({
      resizeTo: container,
      background: 0x1a1d29,
      antialias: true,
    });
    container.appendChild(app.canvas);
    this.app = app;

    const world = new Container();
    app.stage.addChild(world);
    this.world = world;

    this.connectionsLayer = new Container();
    this.dotsLayer = new Container();
    this.componentsLayer = new Container();
    this.selectionLayer = new Container();
    this.ghostLayer = new Container();

    world.addChild(this.connectionsLayer);
    world.addChild(this.dotsLayer);
    world.addChild(this.componentsLayer);
    world.addChild(this.selectionLayer);
    world.addChild(this.ghostLayer);

    app.ticker.add(() => this.tickFrame());

    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointerdown", (ev) => {
      const hit = this.hitTest(ev.global.x, ev.global.y);
      const pe: RendererPointerEvent = {
        screenX: ev.global.x,
        screenY: ev.global.y,
        hit,
      };
      for (const cb of this.pointerDownCallbacks) cb(pe);
    });
    app.stage.on("pointermove", (ev) => {
      const hit = this.hitTest(ev.global.x, ev.global.y);
      const pe: RendererPointerEvent = {
        screenX: ev.global.x,
        screenY: ev.global.y,
        hit,
      };
      for (const cb of this.pointerMoveCallbacks) cb(pe);
    });
  }

  destroy(): void {
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
    this.mountedContainer = null;
    this.components.clear();
    this.connections.clear();
    this.activeDots.length = 0;
    this.pendingFlashes.length = 0;
    this.activeDotByRequest.clear();
    this.queuedDotsByRequest.clear();
  }

  resize(width: number, height: number): void {
    this.app?.renderer.resize(width, height);
  }

  addComponent(id: ComponentId, visual: ComponentVisual): void {
    if (!this.componentsLayer) return;
    const container = new Container();
    const sprite = new Graphics();
    sprite.roundRect(-COMPONENT_HALF, -COMPONENT_HALF, COMPONENT_HALF * 2, COMPONENT_HALF * 2, 6);
    sprite.fill(0x22c55e);
    container.addChild(sprite);

    const label = new Text({
      text: visual.displayName,
      style: {
        fill: 0xffffff,
        fontSize: 11,
        fontFamily: "system-ui, sans-serif",
      },
    });
    label.anchor.set(0.5, 0.5);
    label.x = 0;
    label.y = COMPONENT_HALF + 8;
    container.addChild(label);

    const ring = new Graphics();
    container.addChild(ring);

    container.x = visual.gridPosition.x * GRID_CELL_PX;
    container.y = visual.gridPosition.y * GRID_CELL_PX;
    this.componentsLayer.addChild(container);

    this.components.set(id, {
      id,
      gridPosition: visual.gridPosition,
      displayName: visual.displayName,
      sprite,
      label,
      ring,
      container,
      utilization: 0,
      condition: 1,
      pendingCount: 0,
    });
  }

  removeComponent(id: ComponentId): void {
    const state = this.components.get(id);
    if (!state) return;
    state.container.destroy({ children: true });
    this.components.delete(id);
  }

  updateComponent(id: ComponentId, update: ComponentUpdate): void {
    const state = this.components.get(id);
    if (!state) return;
    if (update.gridPosition) {
      state.gridPosition = update.gridPosition;
      state.container.x = update.gridPosition.x * GRID_CELL_PX;
      state.container.y = update.gridPosition.y * GRID_CELL_PX;
    }
    if (update.utilization !== undefined) {
      state.utilization = update.utilization;
      const color = utilizationColor(update.utilization);
      state.sprite.clear();
      state.sprite.roundRect(
        -COMPONENT_HALF, -COMPONENT_HALF, COMPONENT_HALF * 2, COMPONENT_HALF * 2, 6,
      );
      state.sprite.fill(color);
    }
    if (update.condition !== undefined) {
      state.condition = update.condition;
      state.ring.clear();
      const arcSpan = Math.max(0, Math.min(1, update.condition)) * Math.PI * 2;
      state.ring.arc(0, 0, COMPONENT_HALF + 4, -Math.PI / 2, -Math.PI / 2 + arcSpan);
      state.ring.stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
    }
    if (update.pendingCount !== undefined) {
      state.pendingCount = update.pendingCount;
      if (update.pendingCount > 0) {
        state.label.text = `${state.displayName} · ${update.pendingCount}`;
      } else {
        state.label.text = state.displayName;
      }
    }
  }

  addConnection(id: ConnectionId, sourceId: ComponentId, targetId: ComponentId): void {
    if (!this.connectionsLayer) return;
    const line = new Graphics();
    this.connectionsLayer.addChild(line);
    this.connections.set(id, { id, sourceId, targetId, line, loadUtilization: 0 });
    this.redrawConnection(id);
  }

  removeConnection(id: ConnectionId): void {
    const state = this.connections.get(id);
    if (!state) return;
    state.line.destroy();
    this.connections.delete(id);
  }

  updateConnection(id: ConnectionId, update: ConnectionUpdate): void {
    const state = this.connections.get(id);
    if (!state) return;
    if (update.loadUtilization !== undefined) {
      state.loadUtilization = Math.max(0, Math.min(1, update.loadUtilization));
      this.redrawConnection(id);
    }
  }

  private redrawConnection(id: ConnectionId): void {
    const state = this.connections.get(id);
    if (!state) return;
    const source = this.components.get(state.sourceId);
    const target = this.components.get(state.targetId);
    if (!source || !target) return;
    const x1 = source.gridPosition.x * GRID_CELL_PX;
    const y1 = source.gridPosition.y * GRID_CELL_PX;
    const x2 = target.gridPosition.x * GRID_CELL_PX;
    const y2 = target.gridPosition.y * GRID_CELL_PX;
    const alpha = 0.3 + 0.7 * state.loadUtilization;
    const width = 2 + 2 * state.loadUtilization;
    state.line.clear();
    state.line.moveTo(x1, y1);
    state.line.lineTo(x2, y2);
    state.line.stroke({ color: 0x22c55e, width, alpha });
  }

  spawnRequestDot(args: SpawnRequestDotArgs): void {
    // If a dot for this request is already animating (earlier hop in the
    // same tick), queue this hop to fire when the predecessor retires.
    // The chain preserves event-order because the adapter feeds dots in
    // FORWARDED-event order, which matches the engine's processing order.
    if (this.activeDotByRequest.has(args.requestId)) {
      const queue = this.queuedDotsByRequest.get(args.requestId) ?? [];
      queue.push(args);
      this.queuedDotsByRequest.set(args.requestId, queue);
      return;
    }
    this.spawnDotImmediate(args);
  }

  private spawnDotImmediate(args: SpawnRequestDotArgs): void {
    const conn = this.connections.get(args.connectionId);
    if (!conn || !this.dotsLayer) return;
    const source = this.components.get(conn.sourceId);
    const target = this.components.get(conn.targetId);
    if (!source || !target) return;

    // Fresh Graphics per dot — no pooling. The previous pool-based
    // approach appeared to leak fill/stroke style across clear() in
    // Pixi v8, causing cross-request visual bleed (orange edges on
    // cyan reads that had been drawn into a previously-used graphic).
    // At current wave rates (≤25 req/tick), GC pressure is trivial.
    const graphic = new Graphics();
    const color = REQUEST_TYPE_COLORS[args.requestType] ?? REQUEST_TYPE_COLORS["default"]!;
    this.drawDotShape(graphic, args.requestType, color);
    this.dotsLayer.addChild(graphic);

    const startX = source.gridPosition.x * GRID_CELL_PX;
    const startY = source.gridPosition.y * GRID_CELL_PX;
    const endX = target.gridPosition.x * GRID_CELL_PX;
    const endY = target.gridPosition.y * GRID_CELL_PX;
    graphic.x = startX;
    graphic.y = startY;

    const dot: ActiveDot = {
      graphic,
      connectionId: args.connectionId,
      requestId: args.requestId,
      targetComponentId: conn.targetId,
      startMs: performance.now(),
      durationMs: Math.max(50, args.durationMs),
      startX,
      startY,
      endX,
      endY,
    };
    this.activeDots.push(dot);
    this.activeDotByRequest.set(args.requestId, dot);
  }

  private drawDotShape(g: Graphics, requestType: string, color: number): void {
    // Writes are larger + orange squares so they read as obviously
    // different from cyan read-circles in a dense mixed-traffic wave.
    // NO stroke — in Pixi v8, stroke style state appears to survive a
    // Graphics.clear() across pool reuses, so a write square's orange
    // stroke was bleeding onto the next read circle that recycled the
    // same graphic. Solid-fill shapes avoid the issue entirely.
    if (requestType === "api_write") {
      g.rect(-5, -5, 10, 10).fill(color);
    } else if (requestType === "stream_init") {
      g.poly([0, -5, 5, 4, -5, 4]).fill(color);
    } else {
      g.circle(0, 0, 4).fill(color);
    }
  }

  flashDrop(id: ComponentId): void {
    this.ringPulse(id, FLASH_COLORS.drop);
  }

  flashOverload(id: ComponentId): void {
    this.ringPulse(id, FLASH_COLORS.overload);
  }

  flashResponded(id: ComponentId): void {
    this.ringPulse(id, FLASH_COLORS.served);
  }

  queueFlashOnRequestArrival(
    requestId: RequestId,
    componentId: ComponentId,
    kind: "served" | "drop" | "overload",
  ): void {
    this.pendingFlashes.push({
      requestId,
      componentId,
      color: FLASH_COLORS[kind],
      queuedAtMs: performance.now(),
    });
  }

  /**
   * Shockwave-style feedback: a stroked circle centered on the component
   * that expands outward while fading to zero alpha. Legible regardless of
   * the component's current utilization-color fill, because it lives OUTSIDE
   * the sprite's bounding box. Each event emits its own ring.
   */
  private ringPulse(id: ComponentId, color: number): void {
    const state = this.components.get(id);
    if (!state) return;
    const ring = new Graphics();
    state.container.addChild(ring);

    const startMs = performance.now();
    const DURATION_MS = 350;
    const START_RADIUS = COMPONENT_HALF + 2;
    const END_RADIUS = COMPONENT_HALF + 22;
    const PEAK_ALPHA = 0.9;

    const step = () => {
      const elapsed = performance.now() - startMs;
      if (elapsed >= DURATION_MS) {
        ring.destroy();
        this.app?.ticker.remove(step);
        return;
      }
      const t = elapsed / DURATION_MS;
      const radius = START_RADIUS + (END_RADIUS - START_RADIUS) * t;
      const alpha = PEAK_ALPHA * (1 - t);
      ring.clear();
      ring.circle(0, 0, radius);
      ring.stroke({ color, width: 2, alpha });
    };
    this.app?.ticker.add(step);
  }

  setSelected(id: ComponentId | null): void {
    this.selectedId = id;
    if (this.selectionRing) {
      this.selectionRing.destroy();
      this.selectionRing = null;
    }
    if (id === null || !this.selectionLayer) return;
    const state = this.components.get(id);
    if (!state) return;
    const ring = new Graphics();
    ring.circle(0, 0, COMPONENT_HALF + 8);
    ring.stroke({ color: 0x60a5fa, width: 3, alpha: 0.9 });
    ring.x = state.container.x;
    ring.y = state.container.y;
    this.selectionLayer.addChild(ring);
    this.selectionRing = ring;
  }

  setPlacementGhost(type: string | null, screenPos: { x: number; y: number } | null): void {
    this.ghostType = type;
    this.ghostScreenPos = screenPos;
    if (this.ghostSprite) {
      this.ghostSprite.destroy();
      this.ghostSprite = null;
    }
    if (!type || !screenPos || !this.ghostLayer) return;
    const ghost = new Graphics();
    ghost.roundRect(-COMPONENT_HALF, -COMPONENT_HALF, COMPONENT_HALF * 2, COMPONENT_HALF * 2, 6);
    ghost.fill({ color: 0x60a5fa, alpha: 0.35 });
    const grid = this.screenToGrid(screenPos.x, screenPos.y);
    ghost.x = grid.x * GRID_CELL_PX;
    ghost.y = grid.y * GRID_CELL_PX;
    this.ghostLayer.addChild(ghost);
    this.ghostSprite = ghost;
  }

  hitTest(screenX: number, screenY: number): { componentId: ComponentId } | null {
    for (const [id, state] of this.components) {
      const cx = state.container.x;
      const cy = state.container.y;
      if (
        screenX >= cx - COMPONENT_HALF &&
        screenX <= cx + COMPONENT_HALF &&
        screenY >= cy - COMPONENT_HALF &&
        screenY <= cy + COMPONENT_HALF
      ) {
        return { componentId: id };
      }
    }
    return null;
  }

  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: Math.round(screenX / GRID_CELL_PX),
      y: Math.round(screenY / GRID_CELL_PX),
    };
  }

  worldToScreen(gridPos: { x: number; y: number }): { x: number; y: number } {
    return {
      x: gridPos.x * GRID_CELL_PX,
      y: gridPos.y * GRID_CELL_PX,
    };
  }

  onPointerDown(cb: (ev: RendererPointerEvent) => void): () => void {
    this.pointerDownCallbacks.push(cb);
    return () => {
      const i = this.pointerDownCallbacks.indexOf(cb);
      if (i >= 0) this.pointerDownCallbacks.splice(i, 1);
    };
  }

  onPointerMove(cb: (ev: RendererPointerEvent) => void): () => void {
    this.pointerMoveCallbacks.push(cb);
    return () => {
      const i = this.pointerMoveCallbacks.indexOf(cb);
      if (i >= 0) this.pointerMoveCallbacks.splice(i, 1);
    };
  }

  private tickFrame(): void {
    const now = performance.now();
    for (let i = this.activeDots.length - 1; i >= 0; i--) {
      const dot = this.activeDots[i]!;
      const t = (now - dot.startMs) / dot.durationMs;
      if (t >= 1) {
        this.dotsLayer?.removeChild(dot.graphic);
        dot.graphic.destroy();
        this.activeDots.splice(i, 1);
        this.activeDotByRequest.delete(dot.requestId);

        // Dot arrived at its target. Fire any pending flashes for this
        // request+component combo — this is the primary synchronization
        // point between engine events and visible feedback.
        this.firePendingFlashesForArrival(dot.requestId, dot.targetComponentId);

        // Start the next hop's dot for this request, if any.
        const queued = this.queuedDotsByRequest.get(dot.requestId);
        if (queued && queued.length > 0) {
          const nextArgs = queued.shift()!;
          if (queued.length === 0) this.queuedDotsByRequest.delete(dot.requestId);
          this.spawnDotImmediate(nextArgs);
        }
        continue;
      }
      dot.graphic.x = dot.startX + (dot.endX - dot.startX) * t;
      dot.graphic.y = dot.startY + (dot.endY - dot.startY) * t;
    }

    // Timeout sweep: any pending flash that never got matched by a
    // retiring dot fires anyway once it's been waiting too long. Handles
    // edge cases like condition-drop-probability (request drops before
    // forwarding → no dot) or OVERLOADED sweeps on requests that carried
    // over from a previous tick.
    for (let i = this.pendingFlashes.length - 1; i >= 0; i--) {
      const pf = this.pendingFlashes[i]!;
      if (now - pf.queuedAtMs > PENDING_FLASH_TIMEOUT_MS) {
        this.ringPulse(pf.componentId, pf.color);
        this.pendingFlashes.splice(i, 1);
      }
    }
  }

  private firePendingFlashesForArrival(
    requestId: RequestId,
    componentId: ComponentId,
  ): void {
    for (let i = this.pendingFlashes.length - 1; i >= 0; i--) {
      const pf = this.pendingFlashes[i]!;
      if (pf.requestId === requestId && pf.componentId === componentId) {
        this.ringPulse(pf.componentId, pf.color);
        this.pendingFlashes.splice(i, 1);
      }
    }
  }
}

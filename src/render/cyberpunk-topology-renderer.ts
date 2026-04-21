import { Application, Container } from "pixi.js";
import type {
  TopologyRenderer,
  ComponentVisual,
  ComponentUpdate,
  ConnectionUpdate,
  SpawnRequestDotArgs,
  RendererPointerEvent,
} from "./topology-renderer.js";
import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids.js";
import { gridToWorld, worldToGrid } from "./cyberpunk/iso-projection.js";

/**
 * Game-view zoom factor. Applied to the world container so the iso board
 * and all sprites scale together; HUD (DOM overlay) is unaffected. All
 * screen→world conversions must divide by this to invert the scale.
 */
const GAME_VIEW_ZOOM = 1.2;
import { CYBERPUNK_TOKENS } from "./cyberpunk/tokens.js";
import { createBoard, loadBoardTextures, type BoardTextures } from "./cyberpunk/board.js";
import {
  createComponentLayer,
  loadComponentTextures,
  type ComponentLayer,
  type ComponentTextureMap,
} from "./cyberpunk/component-layer.js";
import {
  createConnectionLayer,
  type ConnectionLayer,
} from "./cyberpunk/connection-layer.js";
import {
  createPacketLayer,
  loadPacketTextures,
  type PacketLayer,
  type PacketTextureMap,
} from "./cyberpunk/packet-layer.js";
import { createFlashFx, type FlashFx } from "./cyberpunk/flash-fx.js";
import { createPlacementGhost, type PlacementGhost } from "./cyberpunk/placement-ghost.js";
import { createSelectionRing, type SelectionRing } from "./cyberpunk/selection-ring.js";
import { SnakeLayer } from "./cyberpunk/snake-layer.js";

/**
 * Cyberpunk isometric renderer. Implements TopologyRenderer as a drop-in
 * replacement for PixiTopologyRenderer. Phase 1A: scene only, no HUD changes.
 *
 * All sub-layer logic lives in focused modules under ./cyberpunk/; this class
 * is the facade that wires them together and implements the interface.
 */
export class CyberpunkTopologyRenderer implements TopologyRenderer {
  private app: Application | null = null;
  private world: Container | null = null;
  private worldCenterX = 0;
  private worldCenterY = 0;
  private mountedContainer: HTMLElement | null = null;

  private boardLayer: Container | null = null;
  private board: { rebuild: () => void } | null = null;
  private boardTextures: BoardTextures | null = null;

  private componentLayer: ComponentLayer | null = null;
  private componentTextures: ComponentTextureMap | null = null;
  private connectionLayer: ConnectionLayer | null = null;
  private packetLayer: PacketLayer | null = null;
  private packetTextures: PacketTextureMap | null = null;
  private flashFx: FlashFx | null = null;
  private placementGhost: PlacementGhost | null = null;
  private selectionRing: SelectionRing | null = null;
  private snakeLayer: SnakeLayer | null = null;

  private pointerDownCallbacks: Array<(ev: RendererPointerEvent) => void> = [];
  private pointerMoveCallbacks: Array<(ev: RendererPointerEvent) => void> = [];
  private connectionPointerDownCallbacks: Array<(id: ConnectionId) => void> = [];

  // Pan state
  private readonly PAN_THRESHOLD_PX = 5;
  private potentialPan = false;
  private isPanning = false;
  private panDownX = 0;
  private panDownY = 0;
  private panLastX = 0;
  private panLastY = 0;
  private placingActive = false;
  private connectingActive = false;

  // Component drag state
  private potentialDragComponent: ComponentId | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private isDraggingComponent = false;
  private dragOriginalGrid: { x: number; y: number } | null = null;
  private componentDragEndCallbacks: Array<
    (args: { componentId: ComponentId; gridPosition: { x: number; y: number } }) => void
  > = [];

  // Custom SVG cursor for deleting a connection — small red X in a dark circle.
  private static readonly ERASER_CURSOR =
    `url('data:image/svg+xml;utf8,` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">` +
    `<circle cx="11" cy="11" r="9" fill="%23050816" stroke="%23ff4d6a" stroke-width="1.5"/>` +
    `<line x1="7" y1="7" x2="15" y2="15" stroke="%23ff4d6a" stroke-width="2"/>` +
    `<line x1="15" y1="7" x2="7" y2="15" stroke="%23ff4d6a" stroke-width="2"/>` +
    `</svg>') 11 11, not-allowed`;

  async mount(container: HTMLElement): Promise<void> {
    this.mountedContainer = container;
    const app = new Application();
    await app.init({
      resizeTo: container,
      background: CYBERPUNK_TOKENS.palette.bg,
      antialias: false,
      resolution: window.devicePixelRatio ?? 1,
      autoDensity: true,
      roundPixels: true,
    });
    container.appendChild(app.canvas);
    this.app = app;

    const world = new Container();
    world.scale.set(GAME_VIEW_ZOOM);
    app.stage.addChild(world);
    this.world = world;

    // Load all textures before constructing layers.
    this.boardTextures = await loadBoardTextures();
    this.componentTextures = await loadComponentTextures();
    this.packetTextures = await loadPacketTextures();

    // Board
    const boardLayer = new Container();
    world.addChild(boardLayer);
    this.boardLayer = boardLayer;
    this.board = createBoard(boardLayer, this.boardTextures);
    this.board.rebuild();

    // Components + connections + packets + flash FX + selection + ghost.
    // Insert order = paint order: connections behind components behind
    // packets behind flash effects behind selection behind ghost.
    this.componentLayer = createComponentLayer(this.componentTextures);
    this.connectionLayer = createConnectionLayer(this.componentLayer);
    world.addChild(this.connectionLayer.container);
    world.addChild(this.componentLayer.container);

    this.packetLayer = createPacketLayer(this.connectionLayer, this.packetTextures);
    world.addChild(this.packetLayer.container);

    this.snakeLayer = new SnakeLayer(this.componentLayer, this.packetTextures);
    world.addChild(this.snakeLayer.container);

    this.flashFx = createFlashFx(this.componentLayer, this.packetLayer);
    world.addChild(this.flashFx.container);

    this.selectionRing = createSelectionRing(this.componentLayer);
    world.addChild(this.selectionRing.container);

    this.placementGhost = createPlacementGhost(this.componentTextures);
    world.addChild(this.placementGhost.container);

    this.recomputeWorldCenter();

    // Ticker: packets + flashes + snake slide-in animation.
    app.ticker.add((ticker) => {
      const deltaMs = ticker.deltaMS;
      this.packetLayer?.tick(deltaMs);
      this.flashFx?.tick(deltaMs);
      this.snakeLayer?.tick(deltaMs);
      this.componentLayer?.tick(deltaMs);
    });

    // Pointer events with pan support.
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.canvas.style.cursor = "grab";

    const emitPointer = (
      callbacks: Array<(ev: RendererPointerEvent) => void>,
      screenX: number,
      screenY: number,
    ): void => {
      const hit = this.hitTest(screenX, screenY);
      const ev: RendererPointerEvent = { screenX, screenY, hit };
      for (const cb of callbacks) cb(ev);
    };

    app.stage.on("pointerdown", (ev) => {
      const sx = ev.global.x;
      const sy = ev.global.y;

      // Component click — either potential drag (idle) or immediate click
      // (while placing or connecting, so those interactions still commit fast).
      const hit = this.hitTest(sx, sy);
      if (hit !== null) {
        if (this.placingActive || this.connectingActive) {
          emitPointer(this.pointerDownCallbacks, sx, sy);
          return;
        }
        const compState = this.componentLayer?.get(hit.componentId);
        if (compState) {
          this.potentialDragComponent = hit.componentId;
          this.dragStartX = sx;
          this.dragStartY = sy;
          this.dragOriginalGrid = { x: compState.gridX, y: compState.gridY };
        } else {
          emitPointer(this.pointerDownCallbacks, sx, sy);
        }
        return;
      }

      // Connection click — emit immediately.
      const connId = this.hitTestConnection(sx, sy);
      if (connId !== null) {
        for (const cb of this.connectionPointerDownCallbacks) cb(connId);
        return;
      }

      // Empty space while placing — emit immediately (component plant).
      if (this.placingActive) {
        emitPointer(this.pointerDownCallbacks, sx, sy);
        return;
      }

      // Empty space while connecting — emit immediately (cancels the connect).
      if (this.connectingActive) {
        emitPointer(this.pointerDownCallbacks, sx, sy);
        return;
      }

      // Empty space, no mode active — this is a potential pan. Defer emitting
      // the click until pointerup (so we can cancel it if the user drags).
      this.potentialPan = true;
      this.panDownX = sx;
      this.panDownY = sy;
      this.panLastX = sx;
      this.panLastY = sy;
    });

    app.stage.on("pointermove", (ev) => {
      const sx = ev.global.x;
      const sy = ev.global.y;

      // Always emit pointermove so placement ghost tracking works.
      emitPointer(this.pointerMoveCallbacks, sx, sy);

      // Promote potential component drag to active drag when threshold crossed.
      if (this.potentialDragComponent && !this.isDraggingComponent) {
        const dx = sx - this.dragStartX;
        const dy = sy - this.dragStartY;
        if (Math.hypot(dx, dy) > this.PAN_THRESHOLD_PX) {
          this.isDraggingComponent = true;
        }
      }

      // Active component drag — snap to the grid cell under the cursor.
      if (this.isDraggingComponent && this.potentialDragComponent) {
        const w = this.screenToWorld(sx, sy);
        const grid = worldToGrid(w.x, w.y);
        this.updateComponent(this.potentialDragComponent, { gridPosition: grid });
      }

      // Promote potential pan to active pan when we cross the threshold.
      if (this.potentialPan) {
        const dx = sx - this.panDownX;
        const dy = sy - this.panDownY;
        if (Math.hypot(dx, dy) > this.PAN_THRESHOLD_PX) {
          this.potentialPan = false;
          this.isPanning = true;
        }
      }

      // Apply pan delta to the world container.
      if (this.isPanning) {
        const dx = sx - this.panLastX;
        const dy = sy - this.panLastY;
        this.panLastX = sx;
        this.panLastY = sy;
        this.worldCenterX += dx;
        this.worldCenterY += dy;
        if (this.world) {
          this.world.x = this.worldCenterX;
          this.world.y = this.worldCenterY;
        }
      }

      // Cursor follows what's under the pointer (or grabbing while panning/dragging).
      this.updateCursor(sx, sy);
    });

    const endInteraction = (ev: { global: { x: number; y: number } }): void => {
      // Component drag completion has priority.
      if (this.potentialDragComponent) {
        if (this.isDraggingComponent) {
          const compState = this.componentLayer?.get(this.potentialDragComponent);
          if (compState) {
            const currentGrid = { x: compState.gridX, y: compState.gridY };
            for (const cb of this.componentDragEndCallbacks) {
              cb({
                componentId: this.potentialDragComponent,
                gridPosition: currentGrid,
              });
            }
          }
        } else {
          // Never crossed threshold → plain component click.
          emitPointer(this.pointerDownCallbacks, ev.global.x, ev.global.y);
        }
        this.potentialDragComponent = null;
        this.isDraggingComponent = false;
        this.dragOriginalGrid = null;
        this.updateCursor(ev.global.x, ev.global.y);
        return;
      }

      if (this.potentialPan) {
        // Never crossed threshold → treat as a click on empty space.
        emitPointer(this.pointerDownCallbacks, ev.global.x, ev.global.y);
      }
      this.potentialPan = false;
      this.isPanning = false;
      // Refresh cursor now that interaction state is cleared.
      this.updateCursor(ev.global.x, ev.global.y);
    };
    app.stage.on("pointerup", endInteraction);
    app.stage.on("pointerupoutside", endInteraction);
  }

  destroy(): void {
    if (this.app) {
      this.app.destroy(true, { children: true, texture: false });
      this.app = null;
    }
    this.world = null;
    this.boardLayer = null;
    this.board = null;
    this.componentLayer = null;
    this.connectionLayer = null;
    this.packetLayer = null;
    this.flashFx = null;
    this.placementGhost = null;
    this.selectionRing = null;
    this.snakeLayer?.cleanup();
    this.snakeLayer = null;
    this.mountedContainer = null;
  }

  /** The Pixi canvas DOM element. Useful for binding native DOM events
   * (e.g. contextmenu) to the canvas instead of an outer wrapper. */
  getCanvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null;
  }

  resize(_width: number, _height: number): void {
    if (this.app) {
      this.app.stage.hitArea = this.app.screen;
    }
    this.recomputeWorldCenter();
    this.board?.rebuild();
    this.connectionLayer?.redraw();
    this.selectionRing?.refresh();
  }

  private recomputeWorldCenter(): void {
    if (!this.app || !this.world) return;
    this.worldCenterX = this.app.renderer.width / 2;
    this.worldCenterY = this.app.renderer.height / 2;
    this.world.x = this.worldCenterX;
    this.world.y = this.worldCenterY;
  }

  private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.worldCenterX) / GAME_VIEW_ZOOM,
      y: (screenY - this.worldCenterY) / GAME_VIEW_ZOOM,
    };
  }

  /**
   * Picks the appropriate cursor based on what's under the pointer, which
   * interaction mode is active, and whether we're currently panning.
   *
   * Priority: panning > placing > connecting > component hit > connection hit > empty
   */
  private updateCursor(screenX: number, screenY: number): void {
    if (!this.app) return;
    const canvas = this.app.canvas;

    if (this.isPanning || this.isDraggingComponent) {
      canvas.style.cursor = "grabbing";
      return;
    }
    if (this.placingActive) {
      canvas.style.cursor = "crosshair";
      return;
    }

    const overComponent = this.hitTest(screenX, screenY) !== null;

    if (this.connectingActive) {
      // In connection mode: hovering a component shows targeting cursor;
      // empty space shows an aiming crosshair.
      if (overComponent) {
        canvas.style.cursor = "alias";
      } else if (this.hitTestConnection(screenX, screenY) !== null) {
        canvas.style.cursor = CyberpunkTopologyRenderer.ERASER_CURSOR;
      } else {
        canvas.style.cursor = "crosshair";
      }
      return;
    }

    if (overComponent) {
      canvas.style.cursor = "pointer";
      return;
    }
    if (this.hitTestConnection(screenX, screenY) !== null) {
      canvas.style.cursor = CyberpunkTopologyRenderer.ERASER_CURSOR;
      return;
    }
    canvas.style.cursor = "grab";
  }

  hitTestConnection(screenX: number, screenY: number): ConnectionId | null {
    if (!this.connectionLayer) return null;
    const w = this.screenToWorld(screenX, screenY);
    // Threshold matches the outer cable width (12px) plus a forgiving margin.
    const THRESHOLD = 10;
    for (const [id] of this.connectionLayer.entries()) {
      const path = this.connectionLayer.pathFor(id);
      if (!path || path.length < 2) continue;
      // Walk each segment of the L-path and check distance to the point.
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const t = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.y - a.y) * dy) / len2));
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        if (Math.hypot(w.x - px, w.y - py) < THRESHOLD) return id;
      }
    }
    return null;
  }

  addComponent(id: ComponentId, visual: ComponentVisual): void {
    this.componentLayer?.add(id, visual);
  }
  removeComponent(id: ComponentId): void {
    this.componentLayer?.remove(id);
    this.connectionLayer?.redraw();
  }
  updateComponent(id: ComponentId, update: ComponentUpdate): void {
    this.componentLayer?.update(id, update);
    if (update.gridPosition) {
      this.connectionLayer?.redraw();
      this.selectionRing?.refresh();
    }
  }

  addConnection(
    id: ConnectionId,
    sourceId: ComponentId,
    targetId: ComponentId,
    options?: { direction?: "forward" | "back" },
  ): void {
    this.connectionLayer?.add(id, sourceId, targetId, options?.direction ?? "forward");
  }
  removeConnection(id: ConnectionId): void {
    this.connectionLayer?.remove(id);
    this.packetLayer?.cleanup();
  }
  updateConnection(id: ConnectionId, update: ConnectionUpdate): void {
    this.connectionLayer?.update(id, update);
  }

  spawnRequestDot(args: SpawnRequestDotArgs): void {
    this.packetLayer?.spawn(args);
  }
  updateClientSnake(
    clientId: ComponentId,
    packets: ReadonlyArray<{ id: string; type: string; count: number }>,
    options?: { trailDirection?: { dx: number; dy: number } },
  ): void {
    const dir = options?.trailDirection ?? { dx: -1, dy: 0 };
    this.snakeLayer?.update(clientId, packets, { trailDirection: dir });
  }
  queueFlashOnRequestArrival(
    requestId: RequestId,
    componentId: ComponentId,
    kind: "served" | "drop" | "overload",
  ): void {
    this.flashFx?.queueOnArrival(requestId, componentId, kind);
  }

  flashOverload(id: ComponentId): void {
    this.flashFx?.flashOverload(id);
  }
  flashDrop(id: ComponentId): void {
    this.flashFx?.flashDrop(id);
  }
  flashResponded(id: ComponentId): void {
    this.flashFx?.flashResponded(id);
  }

  /**
   * Nuke all transient visuals — packets, snakes, flash FX. Used by retry-wave
   * to reset the board without tearing down the component/connection layers.
   */
  resetTransientVisuals(): void {
    // Remove all packet sprites.
    if (this.packetLayer) {
      this.packetLayer.container.removeChildren();
      this.packetLayer.cleanup();
    }
    // Remove all snake trails.
    this.snakeLayer?.cleanup();
    // Clear flash FX queue.
    if (this.flashFx) {
      this.flashFx.container.removeChildren();
    }
  }

  setSelected(id: ComponentId | null): void {
    this.selectionRing?.set(id);
  }
  setPlacementGhost(type: string | null, screenPos: { x: number; y: number } | null): void {
    // Pre-convert screen pos into world coords (accounting for zoom) so
    // placement-ghost doesn't need to know about the world scale.
    const worldPos = screenPos
      ? { x: screenPos.x / GAME_VIEW_ZOOM, y: screenPos.y / GAME_VIEW_ZOOM }
      : null;
    const worldCenterScaled = { x: this.worldCenterX / GAME_VIEW_ZOOM, y: this.worldCenterY / GAME_VIEW_ZOOM };
    this.placementGhost?.set(type, worldPos, worldCenterScaled.x, worldCenterScaled.y);
    this.placingActive = type !== null;
  }
  setConnectionMode(active: boolean): void {
    this.connectingActive = active;
  }

  hitTest(screenX: number, screenY: number): { componentId: ComponentId } | null {
    if (!this.componentLayer) return null;
    const w = this.screenToWorld(screenX, screenY);
    // Iterate components in reverse depth order (front → back) so overlapping
    // sprites resolve correctly.
    const all = Array.from(this.componentLayer.all());
    all.sort((a, b) => (b[1].gridX + b[1].gridY) - (a[1].gridX + a[1].gridY));
    for (const [id, state] of all) {
      const local = {
        x: w.x - state.container.x,
        y: w.y - state.container.y,
      };
      // Sprite is anchored at (0.5, 0.75). Approx hit region: oval centered
      // around the tile base.
      const nx = local.x / 32;
      const ny = (local.y + 16) / 32;
      if (nx * nx + ny * ny < 1) {
        return { componentId: id };
      }
    }
    return null;
  }
  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    const w = this.screenToWorld(screenX, screenY);
    return worldToGrid(w.x, w.y);
  }
  worldToScreen(gridPos: { x: number; y: number }): { x: number; y: number } {
    const w = gridToWorld(gridPos.x, gridPos.y);
    return { x: w.x + this.worldCenterX, y: w.y + this.worldCenterY };
  }

  onPointerDown(cb: (ev: RendererPointerEvent) => void): () => void {
    this.pointerDownCallbacks.push(cb);
    return () => {
      this.pointerDownCallbacks = this.pointerDownCallbacks.filter((c) => c !== cb);
    };
  }
  onPointerMove(cb: (ev: RendererPointerEvent) => void): () => void {
    this.pointerMoveCallbacks.push(cb);
    return () => {
      this.pointerMoveCallbacks = this.pointerMoveCallbacks.filter((c) => c !== cb);
    };
  }
  onConnectionPointerDown(cb: (id: ConnectionId) => void): () => void {
    this.connectionPointerDownCallbacks.push(cb);
    return () => {
      this.connectionPointerDownCallbacks = this.connectionPointerDownCallbacks.filter(
        (c) => c !== cb,
      );
    };
  }
  onComponentDragEnd(
    cb: (args: { componentId: ComponentId; gridPosition: { x: number; y: number } }) => void,
  ): () => void {
    this.componentDragEndCallbacks.push(cb);
    return () => {
      this.componentDragEndCallbacks = this.componentDragEndCallbacks.filter((c) => c !== cb);
    };
  }
}

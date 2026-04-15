# Cyberpunk TD Renderer — Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `CyberpunkTopologyRenderer` — a drop-in replacement for the existing flat-grid `PixiTopologyRenderer` that renders the TD game on an isometric tile board with pixellab pixel-art sprites, thick cased cables, and box packets. Swappable via `?renderer=iso` URL param.

**Architecture:** New class in `src/dashboard/render/cyberpunk-topology-renderer.ts` implementing the existing `TopologyRenderer` interface. Internal work is delegated to small focused modules under `src/dashboard/render/cyberpunk/` — iso projection, board, component layer, connection layer, packet layer, placement ghost, flash FX. The single integration point is a factory function in `renderer-factory.ts` that replaces one line in `td-mode.ts`. The classic renderer stays intact as fallback.

**Tech Stack:** Pixi.js 8.17.1, TypeScript (strict). No new runtime dependencies.

**Project rules:**
- **No commits in this plan.** Project CLAUDE.md says "Never commit unless explicitly asked."
- **No new unit tests in Phase 1A.** Verification per task is `pnpm typecheck`; final task adds `pnpm test` regression + manual dev smoke.
- **Pixi v8 APIs.** `Application.init()` async, fluent `Graphics`, `Assets.load()`, string `scaleMode`.
- **Never break the existing 708 tests.** Every task ends with typecheck green; final task also runs the full test suite.

---

## Task 1: Scaffold — tokens, iso projection, factory, renderer stub, td-mode swap

**Files:**
- Create: `src/dashboard/render/cyberpunk/tokens.ts`
- Create: `src/dashboard/render/cyberpunk/iso-projection.ts`
- Create: `src/dashboard/render/cyberpunk/scene-context.ts`
- Create: `src/dashboard/render/cyberpunk-topology-renderer.ts`
- Create: `src/dashboard/render/renderer-factory.ts`
- Modify: `src/dashboard/td-mode.ts`

- [ ] **Step 1: Tokens module**

Create `src/dashboard/render/cyberpunk/tokens.ts`:

```ts
/**
 * Palette + numeric constants for the cyberpunk iso renderer.
 * Mirrors the showcase tokens so phase 1B HUD integration reuses the same values.
 */
export const CYBERPUNK_TOKENS = {
  palette: {
    bg: 0x050816,
    tileLine: 0x1a3060,
    connection: 0x5ef0ff,
    connectionDim: 0x3a8fa0,
    packet: 0xaef7ff,
    packetReturn: 0x5ef0ff,
    selectionRing: 0x5ef0ff,
    ghost: 0xaef7ff,
    flashOverload: 0xff4d4d,
    flashDrop: 0xff9c4d,
    flashResponded: 0x5ef0ff,
  },
  scale: {
    /** Integer pixel scale for 64px component sprites. */
    spriteScale: 1,
    /** Floor tile rendered at 1.25× the native 64px. */
    tileScale: 1.25,
    /** Iso lattice half-width — matches 64 × tileScale / 2 = 40. */
    isoHalfWidth: 40,
    /** Iso lattice half-height (classic 2:1). */
    isoHalfHeight: 20,
  },
  board: {
    /** Board extent in tiles (N×N). Even so the origin is on a tile corner. */
    size: 24,
  },
  timing: {
    /** Default packet traversal fallback if durationMs is missing or invalid. */
    defaultPacketTraversalMs: 1200,
    /** Pulse period for component breathing animation. */
    pulsePeriodFrames: 120,
    /** Pulse amplitude fraction. */
    pulseAmplitude: 0.08,
    /** Max age of a pending flash before firing anyway (ms). */
    maxPendingFlashAgeMs: 1500,
  },
  cable: {
    /** Outer casing stroke width. */
    outerWidth: 12,
    /** Core stroke width. */
    coreWidth: 8,
    /** Highlight stroke width. */
    highlightWidth: 2,
  },
} as const;
```

- [ ] **Step 2: Iso projection module**

Create `src/dashboard/render/cyberpunk/iso-projection.ts`:

```ts
import { CYBERPUNK_TOKENS } from "./tokens.js";

/** Forward projection: grid (x, y) → world (x, y) before world-center offset. */
export function gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: (gridX - gridY) * CYBERPUNK_TOKENS.scale.isoHalfWidth,
    y: (gridX + gridY) * CYBERPUNK_TOKENS.scale.isoHalfHeight,
  };
}

/** Inverse projection: world (x, y) relative to origin → grid (x, y). */
export function worldToGrid(worldX: number, worldY: number): { x: number; y: number } {
  const halfW = CYBERPUNK_TOKENS.scale.isoHalfWidth;
  const halfH = CYBERPUNK_TOKENS.scale.isoHalfHeight;
  return {
    x: Math.round((worldX / halfW + worldY / halfH) / 2),
    y: Math.round((worldY / halfH - worldX / halfW) / 2),
  };
}
```

- [ ] **Step 3: Scene context interface**

Create `src/dashboard/render/cyberpunk/scene-context.ts`:

```ts
/**
 * Shared state passed to each sub-layer. Allows sub-modules to query the
 * current world-center offset (which changes on resize) without owning it.
 */
export interface SceneContext {
  getWorldCenter(): { x: number; y: number };
  /** Forward: grid → screen = world + worldCenter. */
  gridToScreen(gridX: number, gridY: number): { x: number; y: number };
  /** Inverse: screen → grid. */
  screenToGrid(screenX: number, screenY: number): { x: number; y: number };
}
```

- [ ] **Step 4: Stub renderer**

Create `src/dashboard/render/cyberpunk-topology-renderer.ts`:

```ts
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
import { CYBERPUNK_TOKENS } from "./cyberpunk/tokens.js";
import type { SceneContext } from "./cyberpunk/scene-context.js";

/**
 * Cyberpunk isometric renderer. Implements TopologyRenderer as a drop-in
 * replacement for PixiTopologyRenderer. Phase 1A: scene only, no HUD changes.
 */
export class CyberpunkTopologyRenderer implements TopologyRenderer {
  private app: Application | null = null;
  private world: Container | null = null;
  private worldCenterX = 0;
  private worldCenterY = 0;
  private mountedContainer: HTMLElement | null = null;

  private pointerDownCallbacks: Array<(ev: RendererPointerEvent) => void> = [];
  private pointerMoveCallbacks: Array<(ev: RendererPointerEvent) => void> = [];
  private connectionPointerDownCallbacks: Array<(id: ConnectionId) => void> = [];

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
    app.stage.addChild(world);
    this.world = world;

    this.recomputeWorldCenter();
  }

  destroy(): void {
    if (this.app) {
      this.app.destroy(true, { children: true, texture: false });
      this.app = null;
    }
    this.world = null;
    this.mountedContainer = null;
  }

  resize(_width: number, _height: number): void {
    // Pixi's resizeTo handles canvas resize automatically. We still need to
    // re-center the world origin on the new canvas center.
    this.recomputeWorldCenter();
  }

  private recomputeWorldCenter(): void {
    if (!this.app || !this.world) return;
    this.worldCenterX = this.app.renderer.width / 2;
    this.worldCenterY = this.app.renderer.height / 2;
    this.world.x = this.worldCenterX;
    this.world.y = this.worldCenterY;
  }

  private sceneContext(): SceneContext {
    return {
      getWorldCenter: () => ({ x: this.worldCenterX, y: this.worldCenterY }),
      gridToScreen: (gx, gy) => {
        const w = gridToWorld(gx, gy);
        return { x: w.x + this.worldCenterX, y: w.y + this.worldCenterY };
      },
      screenToGrid: (sx, sy) => worldToGrid(sx - this.worldCenterX, sy - this.worldCenterY),
    };
  }

  // ─ Stubs for the remaining contract; filled in later tasks ──────────────
  addComponent(_id: ComponentId, _visual: ComponentVisual): void {}
  removeComponent(_id: ComponentId): void {}
  updateComponent(_id: ComponentId, _update: ComponentUpdate): void {}

  addConnection(_id: ConnectionId, _sourceId: ComponentId, _targetId: ComponentId): void {}
  removeConnection(_id: ConnectionId): void {}
  updateConnection(_id: ConnectionId, _update: ConnectionUpdate): void {}

  spawnRequestDot(_args: SpawnRequestDotArgs): void {}
  queueFlashOnRequestArrival(
    _requestId: RequestId,
    _componentId: ComponentId,
    _kind: "served" | "drop" | "overload",
  ): void {}

  flashOverload(_id: ComponentId): void {}
  flashDrop(_id: ComponentId): void {}
  flashResponded(_id: ComponentId): void {}

  setSelected(_id: ComponentId | null): void {}
  setPlacementGhost(_type: string | null, _screenPos: { x: number; y: number } | null): void {}

  hitTest(_screenX: number, _screenY: number): { componentId: ComponentId } | null {
    return null;
  }
  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    return this.sceneContext().screenToGrid(screenX, screenY);
  }
  worldToScreen(gridPos: { x: number; y: number }): { x: number; y: number } {
    return this.sceneContext().gridToScreen(gridPos.x, gridPos.y);
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
      this.connectionPointerDownCallbacks = this.connectionPointerDownCallbacks.filter((c) => c !== cb);
    };
  }
}
```

- [ ] **Step 5: Renderer factory**

Create `src/dashboard/render/renderer-factory.ts`:

```ts
import type { TopologyRenderer } from "./topology-renderer.js";
import { PixiTopologyRenderer } from "./pixi-topology-renderer.js";
import { CyberpunkTopologyRenderer } from "./cyberpunk-topology-renderer.js";

/**
 * Picks a renderer based on the URL query string.
 *
 * `?renderer=iso` → CyberpunkTopologyRenderer.
 * Anything else (including absent) → classic PixiTopologyRenderer.
 */
export function createRenderer(): TopologyRenderer {
  const params = new URLSearchParams(window.location.search);
  if (params.get("renderer") === "iso") {
    return new CyberpunkTopologyRenderer();
  }
  return new PixiTopologyRenderer();
}
```

- [ ] **Step 6: Swap td-mode.ts**

Modify `src/dashboard/td-mode.ts`. Replace the import and the single instantiation line:

BEFORE (around line 12):
```ts
import { PixiTopologyRenderer } from "./render/pixi-topology-renderer.js";
```
AFTER:
```ts
import { createRenderer } from "./render/renderer-factory.js";
```

BEFORE (line 89):
```ts
  const renderer: TopologyRenderer = new PixiTopologyRenderer();
```
AFTER:
```ts
  const renderer: TopologyRenderer = createRenderer();
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 8: Dev smoke boot the stub**

Run: `pnpm dev`
Open: `http://localhost:5173/?renderer=iso`
Expected: dark navy canvas, no components visible yet (stub), no console errors. Open `http://localhost:5173/` and confirm the classic TD loads unchanged. Stop dev server.

---

## Task 2: Board — iso tile floor

**Files:**
- Create: `src/dashboard/render/cyberpunk/board.ts`
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts`

- [ ] **Step 1: Board module**

Create `src/dashboard/render/cyberpunk/board.ts`:

```ts
import { Assets, Container, Sprite, Texture } from "pixi.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

const TILE_DARK_URL = new URL("../../assets/tile_dark.png", import.meta.url).href;
const TILE_LIGHT_URL = new URL("../../assets/tile_light.png", import.meta.url).href;

export interface BoardTextures {
  readonly dark: Texture;
  readonly light: Texture;
}

export async function loadBoardTextures(): Promise<BoardTextures> {
  const [dark, light] = await Promise.all([
    Assets.load<Texture>(TILE_DARK_URL),
    Assets.load<Texture>(TILE_LIGHT_URL),
  ]);
  dark.source.scaleMode = "nearest";
  light.source.scaleMode = "nearest";
  return { dark, light };
}

/**
 * Builds a finite N×N iso board into the given container. Grid (0, 0) is the
 * geometric center of the board. Call rebuild() to redraw (e.g. after resize).
 *
 * The container attaches to the renderer's `world` container, which is
 * already offset to canvas center — so tile positions are in pre-offset world
 * coords, and the origin (0, 0) sits at the world container's local origin.
 */
export function createBoard(container: Container, textures: BoardTextures): { rebuild: () => void } {
  const TILE_ANCHOR_X = 0.5;
  const TILE_ANCHOR_Y = 0.4;

  const rebuild = (): void => {
    container.removeChildren();

    const size = CYBERPUNK_TOKENS.board.size;
    const halfW = CYBERPUNK_TOKENS.scale.isoHalfWidth;
    const halfH = CYBERPUNK_TOKENS.scale.isoHalfHeight;
    const tileScale = CYBERPUNK_TOKENS.scale.tileScale;

    // Board is centered on grid (0, 0). Cells run from -size/2..+size/2 - 1.
    const halfSize = Math.floor(size / 2);
    const cells: { c: number; r: number }[] = [];
    for (let r = -halfSize; r < halfSize; r++) {
      for (let c = -halfSize; c < halfSize; c++) {
        cells.push({ c, r });
      }
    }
    // Depth-sort back-to-front for thickness layering.
    cells.sort((a, b) => (a.c + a.r) - (b.c + b.r));

    for (const { c, r } of cells) {
      const parity = ((c + r) & 1) === 0;
      const texture = parity ? textures.dark : textures.light;
      const tile = new Sprite(texture);
      tile.anchor.set(TILE_ANCHOR_X, TILE_ANCHOR_Y);
      tile.scale.set(tileScale);
      tile.x = (c - r) * halfW;
      tile.y = (c + r) * halfH;
      container.addChild(tile);
    }
  };

  return { rebuild };
}
```

- [ ] **Step 2: Wire the board into the renderer**

Modify `src/dashboard/render/cyberpunk-topology-renderer.ts`:

Add imports at the top:
```ts
import { createBoard, loadBoardTextures, type BoardTextures } from "./cyberpunk/board.js";
```

Add private fields to the class:
```ts
  private boardLayer: Container | null = null;
  private board: { rebuild: () => void } | null = null;
  private boardTextures: BoardTextures | null = null;
```

Replace the `mount()` method body (after `this.world = world;`) with:
```ts
    const boardLayer = new Container();
    world.addChild(boardLayer);
    this.boardLayer = boardLayer;

    this.boardTextures = await loadBoardTextures();
    this.board = createBoard(boardLayer, this.boardTextures);
    this.board.rebuild();

    this.recomputeWorldCenter();
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Dev smoke**

Run: `pnpm dev`
Open: `http://localhost:5173/?renderer=iso`
Expected: 24×24 iso tile board centered on the canvas with checkerboard alternation, dark navy background, visible tile thickness. Zero console errors. Stop dev server.

---

## Task 3: Component layer

**Files:**
- Create: `src/dashboard/render/cyberpunk/component-layer.ts`
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts`

- [ ] **Step 1: Component layer module**

Create `src/dashboard/render/cyberpunk/component-layer.ts`:

```ts
import { Assets, Container, Sprite, Text, Texture } from "pixi.js";
import type { ComponentId } from "@core/types/ids.js";
import type { ComponentVisual, ComponentUpdate } from "../topology-renderer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import { gridToWorld } from "./iso-projection.js";
import { utilizationColor } from "../utilization-color.js";

const SPRITE_URLS: Record<string, string> = {
  client: new URL("../../assets/client.png", import.meta.url).href,
  server: new URL("../../assets/server.png", import.meta.url).href,
  database: new URL("../../assets/database.png", import.meta.url).href,
  cache: new URL("../../assets/cache.png", import.meta.url).href,
  load_balancer: new URL("../../assets/load_balancer.png", import.meta.url).href,
  cdn: new URL("../../assets/cdn.png", import.meta.url).href,
  api_gateway: new URL("../../assets/api_gateway.png", import.meta.url).href,
};

const FALLBACK_BY_TYPE: Record<string, string> = {
  streaming_server: "server",
  blob_storage: "database",
};

export type ComponentTextureMap = Record<string, Texture>;

export async function loadComponentTextures(): Promise<ComponentTextureMap> {
  const entries = await Promise.all(
    Object.entries(SPRITE_URLS).map(async ([type, url]) => {
      const texture = await Assets.load<Texture>(url);
      texture.source.scaleMode = "nearest";
      return [type, texture] as const;
    }),
  );
  return Object.fromEntries(entries) as ComponentTextureMap;
}

function resolveTexture(textures: ComponentTextureMap, type: string): Texture {
  if (textures[type]) return textures[type]!;
  const fallback = FALLBACK_BY_TYPE[type];
  if (fallback && textures[fallback]) return textures[fallback]!;
  console.warn(`[cyberpunk-renderer] No sprite for component type "${type}", falling back to client`);
  return textures.client!;
}

export interface ComponentRenderState {
  readonly container: Container;
  readonly sprite: Sprite;
  readonly label: Text;
  readonly pendingLabel: Text;
  type: string;
  gridX: number;
  gridY: number;
}

export interface ComponentLayer {
  readonly container: Container;
  add(id: ComponentId, visual: ComponentVisual): void;
  remove(id: ComponentId): void;
  update(id: ComponentId, update: ComponentUpdate): void;
  get(id: ComponentId): ComponentRenderState | undefined;
  all(): IterableIterator<[ComponentId, ComponentRenderState]>;
}

export function createComponentLayer(textures: ComponentTextureMap): ComponentLayer {
  const container = new Container();
  container.sortableChildren = true;
  const states = new Map<ComponentId, ComponentRenderState>();

  const add = (id: ComponentId, visual: ComponentVisual): void => {
    const texture = resolveTexture(textures, visual.type);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.75);
    sprite.scale.set(CYBERPUNK_TOKENS.scale.spriteScale);

    const label = new Text({
      text: visual.displayName,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fill: 0x5ef0ff,
        align: "center",
      },
    });
    label.anchor.set(0.5, 0);
    label.y = 16;

    const pendingLabel = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 10,
        fill: 0xaef7ff,
        align: "center",
      },
    });
    pendingLabel.anchor.set(0.5, 1);
    pendingLabel.y = -34;
    pendingLabel.visible = false;

    const inner = new Container();
    inner.addChild(sprite);
    inner.addChild(label);
    inner.addChild(pendingLabel);

    const world = gridToWorld(visual.gridPosition.x, visual.gridPosition.y);
    inner.x = world.x;
    inner.y = world.y;
    inner.zIndex = visual.gridPosition.x + visual.gridPosition.y;

    container.addChild(inner);

    states.set(id, {
      container: inner,
      sprite,
      label,
      pendingLabel,
      type: visual.type,
      gridX: visual.gridPosition.x,
      gridY: visual.gridPosition.y,
    });
  };

  const remove = (id: ComponentId): void => {
    const state = states.get(id);
    if (!state) return;
    container.removeChild(state.container);
    state.container.destroy({ children: true });
    states.delete(id);
  };

  const update = (id: ComponentId, u: ComponentUpdate): void => {
    const state = states.get(id);
    if (!state) return;

    if (u.gridPosition) {
      state.gridX = u.gridPosition.x;
      state.gridY = u.gridPosition.y;
      const w = gridToWorld(u.gridPosition.x, u.gridPosition.y);
      state.container.x = w.x;
      state.container.y = w.y;
      state.container.zIndex = u.gridPosition.x + u.gridPosition.y;
    }

    if (u.utilization !== undefined) {
      const tint = utilizationColor(u.utilization);
      state.sprite.tint = tint;
    }

    if (u.pendingCount !== undefined) {
      if (u.pendingCount > 0) {
        state.pendingLabel.text = String(u.pendingCount);
        state.pendingLabel.visible = true;
      } else {
        state.pendingLabel.visible = false;
      }
    }
  };

  return {
    container,
    add,
    remove,
    update,
    get: (id) => states.get(id),
    all: () => states.entries(),
  };
}
```

- [ ] **Step 2: Wire component layer into the renderer**

Modify `src/dashboard/render/cyberpunk-topology-renderer.ts`.

Add imports:
```ts
import {
  createComponentLayer,
  loadComponentTextures,
  type ComponentLayer,
  type ComponentTextureMap,
} from "./cyberpunk/component-layer.js";
```

Add private fields:
```ts
  private componentLayer: ComponentLayer | null = null;
  private componentTextures: ComponentTextureMap | null = null;
```

In `mount()`, after the board setup and before `recomputeWorldCenter()`, add:
```ts
    this.componentTextures = await loadComponentTextures();
    this.componentLayer = createComponentLayer(this.componentTextures);
    world.addChild(this.componentLayer.container);
```

Replace the stubs:
```ts
  addComponent(id: ComponentId, visual: ComponentVisual): void {
    this.componentLayer?.add(id, visual);
  }
  removeComponent(id: ComponentId): void {
    this.componentLayer?.remove(id);
  }
  updateComponent(id: ComponentId, update: ComponentUpdate): void {
    this.componentLayer?.update(id, update);
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Dev smoke**

Run: `pnpm dev`
Open: `http://localhost:5173/?renderer=iso`
Expected: iso board + the Client component visible near the center of the board (TD mode starts with a Client component). Place a Server by clicking a Server button + empty cell — new sprite appears at the iso-projected position. Zero console errors. Stop dev server.

---

## Task 4: Connection layer

**Files:**
- Create: `src/dashboard/render/cyberpunk/connection-layer.ts`
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts`

- [ ] **Step 1: Connection layer module**

Create `src/dashboard/render/cyberpunk/connection-layer.ts`:

```ts
import { Container, Graphics } from "pixi.js";
import type { ComponentId, ConnectionId } from "@core/types/ids.js";
import type { ConnectionUpdate } from "../topology-renderer.js";
import type { ComponentLayer } from "./component-layer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

interface ConnectionRenderState {
  sourceId: ComponentId;
  targetId: ComponentId;
  /** 0..1 utilization set by updateConnection; modulates core alpha. */
  loadUtilization: number;
}

export interface ConnectionLayer {
  readonly container: Container;
  add(id: ConnectionId, sourceId: ComponentId, targetId: ComponentId): void;
  remove(id: ConnectionId): void;
  update(id: ConnectionId, update: ConnectionUpdate): void;
  /** Returns endpoint positions in world coords for a given connection id. */
  endpoints(id: ConnectionId): { fromX: number; fromY: number; toX: number; toY: number } | null;
  entries(): IterableIterator<[ConnectionId, ConnectionRenderState]>;
  /** Redraw everything from current component positions. */
  redraw(): void;
}

export function createConnectionLayer(components: ComponentLayer): ConnectionLayer {
  const container = new Container();
  const states = new Map<ConnectionId, ConnectionRenderState>();
  const outer = new Graphics();
  const core = new Graphics();
  const highlight = new Graphics();
  container.addChild(outer);
  container.addChild(core);
  container.addChild(highlight);

  const redraw = (): void => {
    outer.clear();
    core.clear();
    highlight.clear();
    for (const [, s] of states) {
      const from = components.get(s.sourceId);
      const to = components.get(s.targetId);
      if (!from || !to) continue;
      const fromX = from.container.x;
      const fromY = from.container.y;
      const toX = to.container.x;
      const toY = to.container.y;
      outer.moveTo(fromX, fromY).lineTo(toX, toY).stroke({
        color: CYBERPUNK_TOKENS.palette.tileLine,
        width: CYBERPUNK_TOKENS.cable.outerWidth,
        alpha: 1,
        cap: "butt",
        join: "miter",
      });
      core.moveTo(fromX, fromY).lineTo(toX, toY).stroke({
        color: CYBERPUNK_TOKENS.palette.connection,
        width: CYBERPUNK_TOKENS.cable.coreWidth,
        alpha: 0.65 + s.loadUtilization * 0.35,
        cap: "butt",
        join: "miter",
      });
      highlight.moveTo(fromX, fromY).lineTo(toX, toY).stroke({
        color: CYBERPUNK_TOKENS.palette.packet,
        width: CYBERPUNK_TOKENS.cable.highlightWidth,
        alpha: 1,
        cap: "butt",
        join: "miter",
      });
    }
  };

  const add = (id: ConnectionId, sourceId: ComponentId, targetId: ComponentId): void => {
    states.set(id, { sourceId, targetId, loadUtilization: 0 });
    redraw();
  };
  const remove = (id: ConnectionId): void => {
    if (states.delete(id)) redraw();
  };
  const update = (id: ConnectionId, u: ConnectionUpdate): void => {
    const s = states.get(id);
    if (!s) return;
    if (u.loadUtilization !== undefined) s.loadUtilization = u.loadUtilization;
    redraw();
  };
  const endpoints = (id: ConnectionId) => {
    const s = states.get(id);
    if (!s) return null;
    const from = components.get(s.sourceId);
    const to = components.get(s.targetId);
    if (!from || !to) return null;
    return {
      fromX: from.container.x,
      fromY: from.container.y,
      toX: to.container.x,
      toY: to.container.y,
    };
  };

  return { container, add, remove, update, endpoints, entries: () => states.entries(), redraw };
}
```

- [ ] **Step 2: Wire connection layer into the renderer**

Modify `src/dashboard/render/cyberpunk-topology-renderer.ts`.

Add import:
```ts
import { createConnectionLayer, type ConnectionLayer } from "./cyberpunk/connection-layer.js";
```

Add private field:
```ts
  private connectionLayer: ConnectionLayer | null = null;
```

In `mount()`, AFTER the component layer is added to world (so connections render on top of the board but the component layer is added later — meaning components render on top of connections), update the insertion order:

```ts
    this.componentTextures = await loadComponentTextures();
    this.componentLayer = createComponentLayer(this.componentTextures);

    this.connectionLayer = createConnectionLayer(this.componentLayer);
    world.addChild(this.connectionLayer.container);
    world.addChild(this.componentLayer.container);
```

Replace the connection stubs:
```ts
  addConnection(id: ConnectionId, sourceId: ComponentId, targetId: ComponentId): void {
    this.connectionLayer?.add(id, sourceId, targetId);
  }
  removeConnection(id: ConnectionId): void {
    this.connectionLayer?.remove(id);
  }
  updateConnection(id: ConnectionId, update: ConnectionUpdate): void {
    this.connectionLayer?.update(id, update);
  }
```

Also, in `updateComponent`, after applying the component update, trigger a connection redraw so cables follow moved components. Update:
```ts
  updateComponent(id: ComponentId, update: ComponentUpdate): void {
    this.componentLayer?.update(id, update);
    if (update.gridPosition) this.connectionLayer?.redraw();
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Dev smoke**

Run: `pnpm dev`
Open: `http://localhost:5173/?renderer=iso`
Expected: placing two components and drawing a connection between them shows a thick cased cyan cable. Multiple connections render correctly. Zero console errors. Stop dev server.

---

## Task 5: Packet layer (basic spawn + travel)

**Files:**
- Create: `src/dashboard/render/cyberpunk/packet-layer.ts`
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts`

- [ ] **Step 1: Packet layer module**

Create `src/dashboard/render/cyberpunk/packet-layer.ts`:

```ts
import { Assets, Container, Sprite, Text, Texture } from "pixi.js";
import type { ConnectionId, RequestId } from "@core/types/ids.js";
import type { SpawnRequestDotArgs } from "../topology-renderer.js";
import type { ConnectionLayer } from "./connection-layer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

export type PacketSpriteType = "read" | "write";

const PACKET_URLS: Record<PacketSpriteType, string> = {
  read: new URL("../../assets/packet_read.png", import.meta.url).href,
  write: new URL("../../assets/packet_write.png", import.meta.url).href,
};

export type PacketTextureMap = Record<PacketSpriteType, Texture>;

export async function loadPacketTextures(): Promise<PacketTextureMap> {
  const entries = await Promise.all(
    (Object.entries(PACKET_URLS) as [PacketSpriteType, string][]).map(async ([type, url]) => {
      const texture = await Assets.load<Texture>(url);
      texture.source.scaleMode = "nearest";
      return [type, texture] as const;
    }),
  );
  return Object.fromEntries(entries) as PacketTextureMap;
}

const PACKET_BY_REQUEST_TYPE: Record<string, PacketSpriteType> = {
  api_read: "read",
  api_write: "write",
  static_asset: "read",
  auth_required: "read",
  stream_init: "read",
};

function classify(requestType: string): PacketSpriteType {
  return PACKET_BY_REQUEST_TYPE[requestType] ?? "read";
}

interface ActivePacket {
  readonly sprite: Sprite;
  readonly label: Text | null;
  readonly connection: ConnectionId;
  readonly requestId: RequestId;
  /** Spawn time in ms (relative to animator's internal clock). */
  readonly spawnMs: number;
  /** Delay before motion starts (ms). */
  readonly spawnOffsetMs: number;
  /** Total traversal time (ms). */
  readonly durationMs: number;
  /** Callback fired when this packet retires at its destination. */
  onRetire: (() => void) | null;
}

export interface PacketLayer {
  readonly container: Container;
  spawn(args: SpawnRequestDotArgs): void;
  /** Called every tick with elapsed ms since last frame. */
  tick(deltaMs: number): void;
  /** Remove packets whose connection no longer exists. */
  cleanup(): void;
  /** Returns the active packet for a request (for chaining flashes). */
  getByRequest(requestId: RequestId): ActivePacket | null;
  registerRetireHandler(requestId: RequestId, handler: () => void): void;
}

export function createPacketLayer(connections: ConnectionLayer, textures: PacketTextureMap): PacketLayer {
  const container = new Container();
  const packets: ActivePacket[] = [];
  const byRequest = new Map<RequestId, ActivePacket>();
  let clockMs = 0;

  const spawn = (args: SpawnRequestDotArgs): void => {
    const type = classify(args.requestType);
    const texture = textures[type];
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.6);
    sprite.scale.set(1);

    let label: Text | null = null;
    if (args.count && args.count > 1) {
      label = new Text({
        text: `x${args.count}`,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 9,
          fill: 0xaef7ff,
        },
      });
      label.anchor.set(0.5, 1);
      label.y = -10;
      sprite.addChild(label);
    }

    // Position at source immediately.
    const ep = connections.endpoints(args.connectionId);
    if (ep) {
      sprite.x = ep.fromX;
      sprite.y = ep.fromY;
    }
    container.addChild(sprite);

    const packet: ActivePacket = {
      sprite,
      label,
      connection: args.connectionId,
      requestId: args.requestId,
      spawnMs: clockMs,
      spawnOffsetMs: args.spawnOffsetMs ?? 0,
      durationMs: args.durationMs > 0 ? args.durationMs : CYBERPUNK_TOKENS.timing.defaultPacketTraversalMs,
      onRetire: null,
    };
    packets.push(packet);
    byRequest.set(args.requestId, packet);
  };

  const retire = (packet: ActivePacket): void => {
    const idx = packets.indexOf(packet);
    if (idx >= 0) packets.splice(idx, 1);
    const current = byRequest.get(packet.requestId);
    if (current === packet) byRequest.delete(packet.requestId);
    container.removeChild(packet.sprite);
    packet.sprite.destroy({ children: true });
    if (packet.onRetire) packet.onRetire();
  };

  const tick = (deltaMs: number): void => {
    clockMs += deltaMs;
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]!;
      const elapsed = clockMs - p.spawnMs - p.spawnOffsetMs;
      const ep = connections.endpoints(p.connection);
      if (!ep) {
        retire(p);
        continue;
      }
      if (elapsed < 0) {
        // Pinned at source.
        p.sprite.x = ep.fromX;
        p.sprite.y = ep.fromY;
        continue;
      }
      const t = Math.min(1, elapsed / p.durationMs);
      p.sprite.x = ep.fromX + (ep.toX - ep.fromX) * t;
      p.sprite.y = ep.fromY + (ep.toY - ep.fromY) * t;
      if (t >= 1) retire(p);
    }
  };

  const cleanup = (): void => {
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]!;
      if (!connections.endpoints(p.connection)) retire(p);
    }
  };

  const getByRequest = (requestId: RequestId): ActivePacket | null => byRequest.get(requestId) ?? null;

  const registerRetireHandler = (requestId: RequestId, handler: () => void): void => {
    const p = byRequest.get(requestId);
    if (p) p.onRetire = handler;
  };

  return { container, spawn, tick, cleanup, getByRequest, registerRetireHandler };
}
```

- [ ] **Step 2: Wire packet layer + ticker**

Modify `src/dashboard/render/cyberpunk-topology-renderer.ts`.

Add imports:
```ts
import {
  createPacketLayer,
  loadPacketTextures,
  type PacketLayer,
  type PacketTextureMap,
} from "./cyberpunk/packet-layer.js";
```

Add private fields:
```ts
  private packetLayer: PacketLayer | null = null;
  private packetTextures: PacketTextureMap | null = null;
```

In `mount()`, after component + connection layers:
```ts
    this.packetTextures = await loadPacketTextures();
    this.packetLayer = createPacketLayer(this.connectionLayer, this.packetTextures);
    world.addChild(this.packetLayer.container);

    app.ticker.add((ticker) => {
      const deltaMs = ticker.deltaMS;
      this.packetLayer?.tick(deltaMs);
    });
```

Replace the `spawnRequestDot` stub:
```ts
  spawnRequestDot(args: SpawnRequestDotArgs): void {
    this.packetLayer?.spawn(args);
  }
```

In `removeConnection`, call `cleanup()` on the packet layer so stranded packets retire:
```ts
  removeConnection(id: ConnectionId): void {
    this.connectionLayer?.remove(id);
    this.packetLayer?.cleanup();
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Dev smoke**

Run: `pnpm dev`
Open: `http://localhost:5173/?renderer=iso`
Start Wave 1. Expected: box packets (cyan) flow from Client along connections to Server. Zero console errors. Stop dev server.

---

## Task 6: Flash FX + queueFlashOnRequestArrival

**Files:**
- Create: `src/dashboard/render/cyberpunk/flash-fx.ts`
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts`

- [ ] **Step 1: Flash FX module**

Create `src/dashboard/render/cyberpunk/flash-fx.ts`:

```ts
import { Container, Graphics } from "pixi.js";
import type { ComponentId, RequestId } from "@core/types/ids.js";
import type { ComponentLayer } from "./component-layer.js";
import type { PacketLayer } from "./packet-layer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

export type FlashKind = "served" | "drop" | "overload";

interface ActiveFlash {
  readonly gfx: Graphics;
  readonly componentId: ComponentId;
  readonly color: number;
  /** Age in ms. */
  age: number;
  /** Duration in ms. */
  readonly duration: number;
}

interface PendingFlash {
  readonly requestId: RequestId;
  readonly componentId: ComponentId;
  readonly kind: FlashKind;
  age: number;
}

function colorForKind(kind: FlashKind): number {
  switch (kind) {
    case "served":
      return CYBERPUNK_TOKENS.palette.flashResponded;
    case "drop":
      return CYBERPUNK_TOKENS.palette.flashDrop;
    case "overload":
      return CYBERPUNK_TOKENS.palette.flashOverload;
  }
}

export interface FlashFx {
  readonly container: Container;
  flashOverload(id: ComponentId): void;
  flashDrop(id: ComponentId): void;
  flashResponded(id: ComponentId): void;
  queueOnArrival(requestId: RequestId, componentId: ComponentId, kind: FlashKind): void;
  tick(deltaMs: number): void;
}

export function createFlashFx(components: ComponentLayer, packets: PacketLayer): FlashFx {
  const container = new Container();
  const active: ActiveFlash[] = [];
  const pending: PendingFlash[] = [];

  const fireFlash = (id: ComponentId, kind: FlashKind): void => {
    const state = components.get(id);
    if (!state) return;
    const gfx = new Graphics();
    gfx.x = state.container.x;
    gfx.y = state.container.y;
    container.addChild(gfx);
    active.push({
      gfx,
      componentId: id,
      color: colorForKind(kind),
      age: 0,
      duration: 500,
    });
  };

  const flashOverload = (id: ComponentId): void => fireFlash(id, "overload");
  const flashDrop = (id: ComponentId): void => fireFlash(id, "drop");
  const flashResponded = (id: ComponentId): void => fireFlash(id, "served");

  const queueOnArrival = (
    requestId: RequestId,
    componentId: ComponentId,
    kind: FlashKind,
  ): void => {
    // Register retire handler so we fire the flash when the packet retires.
    packets.registerRetireHandler(requestId, () => fireFlash(componentId, kind));
    pending.push({ requestId, componentId, kind, age: 0 });
  };

  const tick = (deltaMs: number): void => {
    // Age pending flashes; fire any whose packet never arrived within the timeout.
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i]!;
      p.age += deltaMs;
      const stillActive = packets.getByRequest(p.requestId) !== null;
      if (!stillActive && p.age > 0) {
        // Packet already retired (handler fired).
        pending.splice(i, 1);
        continue;
      }
      if (p.age > CYBERPUNK_TOKENS.timing.maxPendingFlashAgeMs) {
        fireFlash(p.componentId, p.kind);
        pending.splice(i, 1);
      }
    }

    // Animate active flashes: expanding ring + fade.
    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i]!;
      a.age += deltaMs;
      const t = a.age / a.duration;
      if (t >= 1) {
        container.removeChild(a.gfx);
        a.gfx.destroy();
        active.splice(i, 1);
        continue;
      }
      const radius = 18 + t * 34;
      const alpha = 1 - t;
      a.gfx.clear();
      a.gfx.circle(0, 0, radius).stroke({ color: a.color, width: 3, alpha });
    }
  };

  return { container, flashOverload, flashDrop, flashResponded, queueOnArrival, tick };
}
```

- [ ] **Step 2: Wire flash FX into the renderer**

Modify `src/dashboard/render/cyberpunk-topology-renderer.ts`.

Add import:
```ts
import { createFlashFx, type FlashFx } from "./cyberpunk/flash-fx.js";
```

Add private field:
```ts
  private flashFx: FlashFx | null = null;
```

In `mount()`, after packet layer is created and added to world:
```ts
    this.flashFx = createFlashFx(this.componentLayer, this.packetLayer);
    world.addChild(this.flashFx.container);
```

Update the ticker hook to also tick the flash FX:
```ts
    app.ticker.add((ticker) => {
      const deltaMs = ticker.deltaMS;
      this.packetLayer?.tick(deltaMs);
      this.flashFx?.tick(deltaMs);
    });
```

Replace flash stubs:
```ts
  flashOverload(id: ComponentId): void {
    this.flashFx?.flashOverload(id);
  }
  flashDrop(id: ComponentId): void {
    this.flashFx?.flashDrop(id);
  }
  flashResponded(id: ComponentId): void {
    this.flashFx?.flashResponded(id);
  }
  queueFlashOnRequestArrival(
    requestId: RequestId,
    componentId: ComponentId,
    kind: "served" | "drop" | "overload",
  ): void {
    this.flashFx?.queueOnArrival(requestId, componentId, kind);
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Dev smoke**

Run: `pnpm dev`
Open: `http://localhost:5173/?renderer=iso`
Start Wave 1 and let it run. Expected: ring pulses fire on Server when it processes requests. Zero console errors. Stop dev server.

---

## Task 7: Selection + placement ghost

**Files:**
- Create: `src/dashboard/render/cyberpunk/placement-ghost.ts`
- Create: `src/dashboard/render/cyberpunk/selection-ring.ts`
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts`

- [ ] **Step 1: Placement ghost module**

Create `src/dashboard/render/cyberpunk/placement-ghost.ts`:

```ts
import { Container, Sprite } from "pixi.js";
import { gridToWorld, worldToGrid } from "./iso-projection.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import type { ComponentTextureMap } from "./component-layer.js";

export interface PlacementGhost {
  readonly container: Container;
  set(type: string | null, screenPos: { x: number; y: number } | null, worldCenterX: number, worldCenterY: number): void;
}

export function createPlacementGhost(textures: ComponentTextureMap): PlacementGhost {
  const container = new Container();
  let currentSprite: Sprite | null = null;
  let currentType: string | null = null;

  const set = (
    type: string | null,
    screenPos: { x: number; y: number } | null,
    worldCenterX: number,
    worldCenterY: number,
  ): void => {
    if (type === null || screenPos === null) {
      if (currentSprite) {
        container.removeChild(currentSprite);
        currentSprite.destroy();
        currentSprite = null;
      }
      currentType = null;
      return;
    }

    if (type !== currentType || !currentSprite) {
      if (currentSprite) {
        container.removeChild(currentSprite);
        currentSprite.destroy();
      }
      const texture = textures[type] ?? textures.client!;
      currentSprite = new Sprite(texture);
      currentSprite.anchor.set(0.5, 0.75);
      currentSprite.scale.set(CYBERPUNK_TOKENS.scale.spriteScale);
      currentSprite.alpha = 0.55;
      currentSprite.tint = CYBERPUNK_TOKENS.palette.ghost;
      container.addChild(currentSprite);
      currentType = type;
    }

    // Snap screen → grid → world
    const grid = worldToGrid(screenPos.x - worldCenterX, screenPos.y - worldCenterY);
    const world = gridToWorld(grid.x, grid.y);
    currentSprite.x = world.x;
    currentSprite.y = world.y;
  };

  return { container, set };
}
```

- [ ] **Step 2: Selection ring module**

Create `src/dashboard/render/cyberpunk/selection-ring.ts`:

```ts
import { Container, Graphics } from "pixi.js";
import type { ComponentId } from "@core/types/ids.js";
import type { ComponentLayer } from "./component-layer.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";

export interface SelectionRing {
  readonly container: Container;
  set(id: ComponentId | null): void;
  /** Re-render for a moved component. */
  refresh(): void;
}

export function createSelectionRing(components: ComponentLayer): SelectionRing {
  const container = new Container();
  const gfx = new Graphics();
  container.addChild(gfx);
  let selectedId: ComponentId | null = null;

  const render = (): void => {
    gfx.clear();
    if (selectedId === null) return;
    const state = components.get(selectedId);
    if (!state) return;
    const halfW = CYBERPUNK_TOKENS.scale.isoHalfWidth;
    const halfH = CYBERPUNK_TOKENS.scale.isoHalfHeight;
    const cx = state.container.x;
    const cy = state.container.y;
    // Diamond outline around the iso cell
    gfx
      .moveTo(cx, cy - halfH)
      .lineTo(cx + halfW, cy)
      .lineTo(cx, cy + halfH)
      .lineTo(cx - halfW, cy)
      .closePath()
      .stroke({ color: CYBERPUNK_TOKENS.palette.selectionRing, width: 2, alpha: 1 });
  };

  const set = (id: ComponentId | null): void => {
    selectedId = id;
    render();
  };

  return { container, set, refresh: render };
}
```

- [ ] **Step 3: Wire ghost + selection ring into the renderer**

Modify `src/dashboard/render/cyberpunk-topology-renderer.ts`.

Add imports:
```ts
import { createPlacementGhost, type PlacementGhost } from "./cyberpunk/placement-ghost.js";
import { createSelectionRing, type SelectionRing } from "./cyberpunk/selection-ring.js";
```

Add private fields:
```ts
  private placementGhost: PlacementGhost | null = null;
  private selectionRing: SelectionRing | null = null;
```

In `mount()`, after flash FX:
```ts
    this.selectionRing = createSelectionRing(this.componentLayer);
    world.addChild(this.selectionRing.container);

    this.placementGhost = createPlacementGhost(this.componentTextures);
    world.addChild(this.placementGhost.container);
```

Replace the selection/ghost stubs:
```ts
  setSelected(id: ComponentId | null): void {
    this.selectionRing?.set(id);
  }
  setPlacementGhost(type: string | null, screenPos: { x: number; y: number } | null): void {
    this.placementGhost?.set(type, screenPos, this.worldCenterX, this.worldCenterY);
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 5: Dev smoke**

Run: `pnpm dev`
Open: `http://localhost:5173/?renderer=iso`
Select the Place Server button. Hover over an empty cell — a translucent ghost sprite should follow the cursor snapped to iso cells. Click to place a Server. Click a placed component — a cyan diamond selection ring appears around it. Zero console errors. Stop dev server.

---

## Task 8: Hit testing + pointer events

**Files:**
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts`

- [ ] **Step 1: Implement hit test + pointer wiring**

Replace the hit-test stub and wire pointer events in `mount()`.

First, add a private helper method to the class:
```ts
  private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return { x: screenX - this.worldCenterX, y: screenY - this.worldCenterY };
  }

  private hitTestConnection(screenX: number, screenY: number): ConnectionId | null {
    if (!this.connectionLayer) return null;
    const w = this.screenToWorld(screenX, screenY);
    const THRESHOLD = 10;
    for (const [id] of this.connectionLayer.entries()) {
      const ep = this.connectionLayer.endpoints(id);
      if (!ep) continue;
      const dx = ep.toX - ep.fromX;
      const dy = ep.toY - ep.fromY;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((w.x - ep.fromX) * dx + (w.y - ep.fromY) * dy) / len2));
      const px = ep.fromX + t * dx;
      const py = ep.fromY + t * dy;
      const dxp = w.x - px;
      const dyp = w.y - py;
      if (Math.hypot(dxp, dyp) < THRESHOLD) return id;
    }
    return null;
  }
```

Replace the `hitTest` stub:
```ts
  hitTest(screenX: number, screenY: number): { componentId: ComponentId } | null {
    if (!this.componentLayer) return null;
    const w = this.screenToWorld(screenX, screenY);
    // Iterate components in reverse depth order (front → back) so overlapping sprites resolve correctly.
    const all = Array.from(this.componentLayer.all());
    all.sort((a, b) => (b[1].gridX + b[1].gridY) - (a[1].gridX + a[1].gridY));
    for (const [id, state] of all) {
      const local = {
        x: w.x - state.container.x,
        y: w.y - state.container.y,
      };
      // Component sprite is anchored at (0.5, 0.75), so the bounding box is
      // roughly (-32, -48, 32, 16) at scale 1. Use an approximate oval.
      const nx = local.x / 32;
      const ny = (local.y + 16) / 32; // shift so center is at 0
      if (nx * nx + ny * ny < 1) {
        return { componentId: id };
      }
    }
    return null;
  }
```

Now wire pointer events. In `mount()`, after all layers are added:
```ts
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;

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
      const hit = this.hitTest(sx, sy);
      if (hit === null) {
        // Try connection hit-test before the empty-space callback.
        const connId = this.hitTestConnection(sx, sy);
        if (connId !== null) {
          for (const cb of this.connectionPointerDownCallbacks) cb(connId);
          return;
        }
      }
      emitPointer(this.pointerDownCallbacks, sx, sy);
    });
    app.stage.on("pointermove", (ev) => {
      emitPointer(this.pointerMoveCallbacks, ev.global.x, ev.global.y);
    });
```

Also update `resize()` so the hit area tracks canvas size changes:
```ts
  resize(_width: number, _height: number): void {
    if (this.app) {
      this.app.stage.hitArea = this.app.screen;
    }
    this.recomputeWorldCenter();
    this.connectionLayer?.redraw();
    this.board?.rebuild();
    this.selectionRing?.refresh();
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Dev smoke**

Run: `pnpm dev`
Open: `http://localhost:5173/?renderer=iso`
Click a placed component — selection ring should appear (proving hit test works). Click an empty cell with Place Server active — a Server spawns at that cell (proving screenToGrid works via setPlacementGhost round trip). Click on a connection line — the connection click callback should fire (visible as a connection-info panel or similar in the existing TD UI). Zero console errors. Stop dev server.

---

## Task 9: Wire sandbox demos + final verification

**Files:**
- Modify: `src/dashboard/main.ts`

- [ ] **Step 1: Route sandbox demos through the factory**

In `src/dashboard/main.ts`, find all instances of `new PixiTopologyRenderer()` and replace with `createRenderer()`. Add the factory import at the top of the file:

```ts
import { createRenderer } from "./render/renderer-factory.js";
```

Remove any unused `PixiTopologyRenderer` import if it only served those replaced sites. If it's still referenced elsewhere in the file, leave the import alone.

Each instantiation becomes:
```ts
const renderer: TopologyRenderer = createRenderer();
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Full regression test suite**

Run: `pnpm test`
Expected: **708 passing, 0 failing.** Any regression is a blocker.

- [ ] **Step 4: Dev smoke — classic renderer unchanged**

Run: `pnpm dev`
Open: `http://localhost:5173/`
Play through Wave 1 of TD mode with the classic (default) renderer. Everything should work exactly as before. Zero console errors. Leave dev server running.

- [ ] **Step 5: Dev smoke — iso renderer end-to-end**

Open: `http://localhost:5173/?renderer=iso`

Go through this manual checklist, confirming each item:

- [ ] Dark navy background with 24×24 iso tile board centered on canvas
- [ ] Initial Client component visible at (or near) grid center
- [ ] Hovering the "Place Server" button + moving the cursor shows the translucent placement ghost snapping to iso cells
- [ ] Clicking an empty cell with a component type selected plants the sprite at that iso cell
- [ ] Clicking an existing component selects it (cyan diamond ring appears)
- [ ] Drawing a connection between two components renders a thick cased cyan cable
- [ ] Start Wave 1 — box packets flow as cyan cubes along the cables from Client → Server
- [ ] Server processes requests — cyan ring pulses appear on the Server (flashResponded)
- [ ] Wave 1 completes and the "next wave" dialog appears
- [ ] Resizing the browser window re-centers the board and keeps components in place
- [ ] Zero console errors throughout

Stop the dev server.

- [ ] **Step 6: Report to user**

Do not commit. Report outcome to user per project rule "Never commit unless explicitly asked."

---

## Self-review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| File layout | Tasks 1–8 create every file listed in the spec |
| Integration point (td-mode.ts single-line swap) | Task 1 step 6 |
| Iso projection (forward + inverse) | Task 1 step 2 |
| screenToGrid / worldToScreen | Task 1 stub + Task 8 resize-aware hit area |
| Board (24×24, depth-sorted, centered on grid 0,0) | Task 2 |
| Components layer with Y-sort, fallbacks, utilization tint, pending count | Task 3 |
| Connection layer (cased cable, updateConnection alpha modulation) | Task 4 |
| Packet layer (spawn, durationMs, spawnOffsetMs, count label) | Task 5 |
| Request type → packet texture mapping with fallbacks | Task 5 (PACKET_BY_REQUEST_TYPE const) |
| Multi-hop chaining via retire handlers | Task 5 (registerRetireHandler) + Task 6 (flash-fx uses it) |
| Flash FX (overload/drop/responded + pending arrival queue) | Task 6 |
| Placement ghost | Task 7 |
| Selection ring | Task 7 |
| Hit testing (component) | Task 8 |
| Connection click hit-test | Task 8 (hitTestConnection) |
| Pointer event wiring | Task 8 |
| Resize behavior | Task 8 (updated resize()) |
| Main.ts sandbox demo factory usage | Task 9 step 1 |
| Verification (typecheck + tests + dev smoke both modes) | Task 9 steps 2–5 |

**Placeholder scan:** no "TBD"/"implement later"/vague steps. Every code block is complete.

**Type consistency:** `ComponentLayer`/`ConnectionLayer`/`PacketLayer`/`FlashFx`/`PlacementGhost`/`SelectionRing` names used consistently across tasks. `ComponentRenderState` / `ComponentTextureMap` / `PacketTextureMap` / `BoardTextures` / `SceneContext` all defined in their introducing tasks and consumed by later tasks without renaming.

**Known deferred items (Phase 1B, not 1A):**
- Component pulse animation (showcase has it; real TD doesn't need it in 1A, YAGNI)
- Cyberpunk HUD chrome (wave pill, budget/SLA, palette strip)
- Live palette drag interactions
- Sprites for `static_asset`, `auth_required`, `stream_init` packet variants

# Cyberpunk TD Renderer — Phase 1A Design Spec

**Date:** 2026-04-14
**Status:** Draft (awaiting user review)
**Branch:** `feature/cyberpunk-td-renderer`
**Depends on:** generated assets from the `feature/cyberpunk-showcase` branch (copied into `src/dashboard/assets/`)

## Context

We built an isolated Pixi showcase (`showcase.html`) that proves a cyberpunk aesthetic for the TD game: iso tile floor, pixellab component sprites, thick cased connection cables, box-shaped packet sprites, and a cyberpunk HTML HUD overlay. The aesthetic is approved.

Now we want to bring that look into the actual TD game mode, which today uses a flat cartesian grid renderer (`pixi-topology-renderer.ts`) with colored geometric shapes.

## Goal (Phase 1A only)

Build a new renderer, `CyberpunkTopologyRenderer`, that implements the existing `TopologyRenderer` interface and can be swapped in for the classic renderer at boot time via URL param. The TD game loop, sim engine, economy, waves, dashboard state, and all 708 existing tests must continue to work unchanged — the integration point is the renderer boundary.

Phase 1A covers the **visible scene only** — floor, components, cables, packets, placement ghost, selection, hit testing, and feedback flashes. The existing TD status banner + buttons stay as-is.

**Phase 1B** (later session, not in this spec) will replace the existing TD HUD chrome with the cyberpunk HUD we built for the showcase, wired to live game state (wave counter, budget, SLA, interactive palette).

## Non-goals (Phase 1A)

- No HUD changes — the existing TD mode's status banner + any buttons stay untouched.
- No gameplay changes — sim engine, economy, waves, TD controller all unchanged.
- No new unit tests — phase 1A is pure renderer; existing 708 tests must stay green.
- No removal of the classic renderer — it stays as fallback, reachable via `?renderer=classic` (or default).
- No changes to `TopologyRenderer` interface or any of its types.
- No panning, zooming, or camera. Fixed iso board, centered on canvas.

## File layout

```
src/dashboard/render/
  topology-renderer.ts              # unchanged (interface only)
  pixi-topology-renderer.ts         # unchanged (classic fallback)
  cyberpunk-topology-renderer.ts    # NEW — implements TopologyRenderer
  cyberpunk/                        # NEW — sub-files for the new renderer
    tokens.ts                       #   palette, iso half-dimensions, timing
    iso-projection.ts               #   forward + inverse iso transform
    board.ts                        #   loads + draws the tile board
    component-layer.ts              #   component sprite lifecycle + Map<ComponentId, state>
    connection-layer.ts             #   cased cable drawing + Map<ConnectionId, state>
    packet-layer.ts                 #   box packet sprites, lerping
    placement-ghost.ts              #   translucent preview sprite at hovered cell
    flash-fx.ts                     #   ring pulse + tint flash effects
  renderer-factory.ts               # NEW — picks renderer based on URL param
src/dashboard/td-mode.ts            # MODIFY — 1 line: use factory instead of `new PixiTopologyRenderer()`
src/dashboard/main.ts               # POSSIBLY MODIFY — if classic topology sandbox demos also need the factory (TBD during impl)
src/dashboard/assets/               # already populated — component sprites, tile sprites, packet sprites
```

**Rationale for sub-files:** `cyberpunk-topology-renderer.ts` becomes the facade that wires together small focused modules. Keeps each file under ~200 LOC. The existing `pixi-topology-renderer.ts` is 711 LOC and does everything — I don't want to repeat that shape.

## Integration point

Only one line of non-renderer code changes:

```ts
// src/dashboard/td-mode.ts:89
// BEFORE:
const renderer: TopologyRenderer = new PixiTopologyRenderer();
// AFTER:
const renderer: TopologyRenderer = createRenderer();
```

`createRenderer()` lives in `renderer-factory.ts` and picks between `new PixiTopologyRenderer()` (default) and `new CyberpunkTopologyRenderer()` based on a URL param.

**URL param contract:** `?renderer=iso` → cyberpunk. Anything else (including absent) → classic. Read with `new URLSearchParams(location.search).get("renderer") === "iso"`.

Sandbox topology demos in `main.ts` also instantiate a renderer — Phase 1A reuses the same factory so the URL param toggles both TD mode and sandbox demos consistently.

## Iso projection

The TD game stores component positions as `{x, y}` integers where `x` grows east and `y` grows south (matching the existing flat renderer's conventions). The cyberpunk renderer projects them through a standard 2:1 iso transform:

```
const halfW = 40;   // matches the showcase tileScale 1.25× 32
const halfH = 20;

function gridToWorld(gx, gy) {
  return { x: (gx - gy) * halfW, y: (gx + gy) * halfH };
}

function worldToGrid(wx, wy) {
  return {
    x: Math.round((wx / halfW + wy / halfH) / 2),
    y: Math.round((wy / halfH - wx / halfW) / 2),
  };
}
```

Grid (0, 0) maps to world (0, 0). The world container is offset so world (0, 0) appears at canvas center — this centers the board AND puts origin components in the middle of the viewport, matching player intuition.

### screenToGrid

The `TopologyRenderer.screenToGrid` contract takes screen pixels (relative to the canvas, which is what Pixi v8 pointer events give us) and returns grid coords. It's the inverse of the forward chain `grid → world → screen`, which is `screen → world → grid`. The renderer tracks its world-center offset so the inverse is:

```
function screenToGrid(sx, sy) {
  const wx = sx - this.worldCenterX;
  const wy = sy - this.worldCenterY;
  return worldToGrid(wx, wy);
}
```

### worldToScreen

The contract on the existing renderer returns a `{x, y}` in screen pixels for a given grid position. Same chain forward:

```
function worldToScreen(grid) {
  const w = gridToWorld(grid.x, grid.y);
  return { x: w.x + this.worldCenterX, y: w.y + this.worldCenterY };
}
```

## Board

A fixed-size iso tile board fills the visible area behind components. For Phase 1A the board is **24×24 tiles**, centered so grid (0, 0) sits at its middle. That covers grid range `(-11..12, -11..12)`, which is plenty for current TD gameplay (typical range is `(-5..10, -5..10)`).

Rendering reuses the pattern from the showcase's `grid-background.ts` with the small modifications:
- Uses `tile_dark.png` + `tile_light.png` at `tileScale = 1.25`
- Alternates via `(c + r) & 1` parity
- Depth-sorted back-to-front
- **Rebuilt on resize** with the world-center offset recomputed

## Components layer

```ts
interface ComponentRenderState {
  container: Container;    // the Pixi root (sprite + label + feedback overlays)
  sprite: Sprite;          // the pixellab component tile
  type: string;
  gridPosition: { x: number; y: number };
}
```

- `addComponent(id, visual)` creates a new Sprite from the type-keyed texture map, positions it via `gridToWorld`, and stores state in a `Map<ComponentId, ComponentRenderState>`.
- `removeComponent(id)` destroys the container and deletes the map entry.
- `updateComponent(id, update)` mutates position (re-projects), utilization (tint lerp green→yellow→red, reusing the existing `utilization-color.ts` helper if the module is pure), pendingCount (small label).

### Sprite type map + fallbacks

```ts
const SPRITE_URLS: Record<string, string> = {
  client: "client.png",
  server: "server.png",
  database: "database.png",
  cache: "cache.png",
  load_balancer: "load_balancer.png",
  cdn: "cdn.png",
  api_gateway: "api_gateway.png",
};

const FALLBACKS: Record<string, string> = {
  streaming_server: "server",
  blob_storage: "database",
  // anything else → client (most generic pixel box)
};
```

All textures loaded via `Assets.load` in `mount()` with `texture.source.scaleMode = "nearest"`.

### Y-sort

Components render in a single `Container` that sorts children by `depth = gridX + gridY` on every update call. Pixi v8 supports `sortableChildren = true` with per-sprite `zIndex` — set `container.zIndex = depth` and let Pixi handle it.

## Connections layer

Reuses the showcase's three-pass cased cable drawing:
1. Outer casing `tileLine` (#1a3060) width 12
2. Core `connection` (#5ef0ff) width 8
3. Center highlight `packet` (#aef7ff) width 2

```ts
interface ConnectionRenderState {
  from: { x: number; y: number };   // iso world coords
  to: { x: number; y: number };
  sourceId: ComponentId;
  targetId: ComponentId;
}
```

Stored in `Map<ConnectionId, ConnectionRenderState>`. On add/remove/update the `connectionsLayer` Graphics object is cleared and redrawn for all active connections (O(N) but N is small and updates are rare).

`updateConnection(id, { loadUtilization })` modulates the core line alpha — higher load = brighter core.

## Packet layer

Reuses showcase `packet-animator.ts` but adapts it to the renderer contract:
- Spawns are triggered by `spawnRequestDot(args)`, not a tick-driven cadence
- Each spawned packet is keyed by `RequestId` (for the `queueFlashOnRequestArrival` contract)
- Traversal time is `durationMs` converted to frame count via `app.ticker.deltaMS` accumulation
- `spawnOffsetMs` pins the packet at the source position until the delay elapses
- `count` (if > 1) renders a small label on the packet (mirrors existing behavior)

### Request type → packet texture

```ts
const PACKET_BY_REQUEST_TYPE: Record<string, PacketType> = {
  api_read: "read",
  api_write: "write",
  static_asset: "read",       // fallback to cyan for Phase 1A
  auth_required: "read",      // fallback to cyan for Phase 1A
  stream_init: "read",        // added for Wave 8
};
```

Phase 1B can generate `static_asset`, `auth_required`, and `stream_init` variants if desired.

### Per-request chaining

The existing renderer chains multi-hop dots via `activeDotByRequest` and `queuedDotsByRequest` Maps so a single request animates as a continuous thread across Client → Server → Database instead of spawning the second hop in parallel. **The cyberpunk renderer must preserve this behavior** — implementation is a straight port.

## Placement ghost

- `setPlacementGhost(type, screenPos)` — if `type` is non-null, snap `screenPos` to the nearest grid cell via `screenToGrid`, then reproject to iso world via `gridToWorld`, and position a translucent Sprite (the type-matched texture, alpha 0.55) at that location.
- If `type === null`, hide the ghost.
- The ghost sprite lives in its own layer above components so it's always visible.

## Selection highlight

- `setSelected(id)` — draws a thin cyan diamond ring around the selected component's base. Clears on null.
- Implemented as a Graphics object in the `selectionLayer`, cleared and redrawn each call.

## Feedback flashes

- `flashOverload(id)` — red ring pulse expanding outward, 500ms
- `flashDrop(id)` — orange ring pulse
- `flashResponded(id)` — cyan ring pulse
- `queueFlashOnRequestArrival(requestId, componentId, kind)` — enqueue the flash in a `PendingFlash[]`; when the dot for that `requestId` retires, fire the appropriate flash on `componentId`. If no matching dot arrives within 2× tick interval, fire the flash anyway (mirroring existing renderer semantics).

Implemented in `flash-fx.ts` as a small module that owns a `PendingFlash[]` and exposes `tickFlashes(deltaMs)` called from the renderer's ticker.

## Utilization tint

Preserve the existing `utilization-color.ts` helper if it's a pure module; import and use it. The cyberpunk renderer tints the component sprite base by the utilization color — full saturation at high util, no tint at zero.

## Hit testing

- `hitTest(screenX, screenY)` — converts to world coords, iterates all active components, returns the first whose sprite bounds contain the point. Fast enough for N<=50 components.
- Connection hit-testing (`hitTestConnection` internal) — line-segment distance test (point-to-segment distance < 8 px). Used by `onConnectionPointerDown` since thick cables deserve a generous click target.

## Pointer events

Pixi v8 `app.stage.eventMode = "static"` + `hitArea = app.screen` + `on("pointerdown", ...)` — same pattern as the existing renderer. Forward to registered callbacks. `onConnectionPointerDown` short-circuits before the empty-space callback, same as classic.

## Resize behavior

On resize:
1. Pixi handles canvas resize via `resizeTo: container`
2. `CyberpunkTopologyRenderer.resize(width, height)` is called explicitly by the host
3. Recompute world-center offset → re-run board rebuild, re-project all component positions, re-render connections
4. Packet in-flight positions are re-derived on the next tick since they lerp from connection endpoints which are already in sync

## Verification

**No new unit tests.** Phase 1A is pure renderer. Verification is:

1. `pnpm typecheck` — must be clean
2. `pnpm test` — must stay at ≥708 passing (all existing tests)
3. `pnpm dev` manual smoke:
   - `http://localhost:5173/` loads classic TD mode unchanged (default, no URL param)
   - `http://localhost:5173/?renderer=iso` loads TD mode with the cyberpunk renderer
   - Wave 1 is playable through to pass, with:
     - Iso board visible
     - Component placement ghost previews at hovered cell
     - Components plant on click
     - Connections drawable between components
     - Traffic packets flow as box sprites along cables
     - Selection ring appears on click
     - Flash animations fire on server overload / drop / success
     - Wave 1 completes and the "next wave" dialog appears
   - Zero console errors

## Risks

1. **Coordinate mapping edge cases.** Negative grid coords (`{x: 1, y: -1}` seen in topologies.ts) must round-trip cleanly through the iso transform. Easy to test manually with a scratch console log.
2. **Pixi hit area after resize.** `app.stage.hitArea = app.screen` captures the screen rect at mount time; after resize the hit area may not track. Classic renderer handles this — I need to either follow the same pattern or update the hit area on resize.
3. **Unknown component types.** If a wave introduces a component type with no sprite and no fallback, the renderer should not crash — it falls back to the client sprite with a warn log.
4. **Performance for 100+ tiles + N components.** Each tile is a Sprite; 24×24 = 576 tiles. Pixi handles that easily. No concern.
5. **Connection re-render churn.** Connections redraw on every update. If `updateConnection` is called every tick during heavy traffic, that's N tick draws. Keep it cheap (Graphics clear + redraw is fast).

## Open questions

- **Should the ghost snap to integer grid cells or follow the cursor continuously?** Classic renderer snaps. I'll follow that.
- **Should the board size be dynamic (fit placed components with margin) or fixed?** Fixed for Phase 1A. If placements exceed board bounds they'll overflow off-tile — acceptable because that's outside the expected play area.
- **Should tile sprites become selectable (drop-to-place)?** No — the tile board is backdrop only; hit tests go through the stage's empty-space callback, same as classic.

## Phase 1B preview

After 1A ships, phase 1B adds:
- Replace the TD mode status banner and buttons with the cyberpunk HUD chrome from the showcase
- Wire live bindings: wave counter, budget, SLA gauges, interactive palette (drag-to-place)
- Possibly regenerate `static_asset`, `auth_required`, `stream_init` packet variants
- Retire the classic renderer if the iso one is proven on all current waves

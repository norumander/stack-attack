# Pico-8 Retheme — Design

**Date:** 2026-04-20
**Status:** Draft (pending implementation plan)

## Context

The landing page (`src/index.html`) already uses a Pico-8-inspired aesthetic — 16-color palette via `--pi-*` CSS vars, the `client-typing.gif` sprite of a small character at a desk, chunky box-shadow buttons, a layered wordmark. The in-game scene (`/game.html`, `/diagnose.html`), by contrast, uses an isometric cyberpunk treatment — dark navy sprites with cyan glow, produced in an earlier pass and named under `src/render/cyberpunk/`. The two aesthetics don't meet.

This spec retheme the in-game scene to match the landing page: strict Pico-8 palette on the iso board, with the level framed as a retro office. Gameplay, simulation, and sprite-layer rendering code are unchanged — this is a sprite and CSS swap with a small addition for wall/logo decals.

## Goals

- Every in-game component sprite conforms to the 16-color Pico-8 palette
- The iso board reads as a retro office: carpet/parquet floor, a back wall behind row 0, a company logo mounted on that wall
- HUD, menus, and chatbot drawer palette match the landing page (no layout changes)
- Rollback to the current cyberpunk look is a git-level move, not a rewrite

## Non-goals

- Animated sprites (static textures only; frame-based animation is future work)
- Rendering-engine changes (no shader, no new PIXI plugins)
- Diagnose-mode engineer sprites (`src/assets/stack-attack/engineers/`) — already pico-8-ish, left alone
- Sound, music, CRT-overlay tuning
- File/directory renames (`src/render/cyberpunk/` stays named as-is this pass)

## Viewpoint decision

Reskin the existing isometric board — same grid, same tile footprint, same camera. No renderer restructure.

**Alternatives considered and rejected:**
- Top-down overhead office room — required a new renderer, re-authoring every sprite, no gameplay benefit
- Side-on 2D landing-page style — would have forced sim changes (placement grid → strip)

## Palette

**Strict Pico-8 16-color:**

```
#000000 #1D2B53 #7E2553 #008751 #AB5236 #5F574F #C2C3C7 #FFF1E8
#FF004D #FFA300 #FFEC27 #00E436 #29ADFF #83769C #FF77A8 #FFCCAA
```

No colors outside this set are permitted in regenerated sprites. Enforced by an automated palette-conformance test (see Testing).

**Landing-page `--pi-*` CSS vars** are already aligned with this palette; promoted to `src/styles/palette.css` (or a top block of `src/styles.css`) as the single source of truth.

## Scope & deliverables

### Sprite regeneration (PixelLab MCP)

**13 components** — overwrite `src/assets/<name>.png` (originals archived first):

1. `server`
2. `database`
3. `load_balancer`
4. `api_gateway`
5. `cdn`
6. `queue`
7. `worker`
8. `edge_cache`
9. `streaming_server`
10. `dns_gtm`
11. `blob_storage`
12. `circuit_breaker`
13. `data_cache`

**Floor tiles** — `tile_light.png`, `tile_dark.png` (office carpet/parquet, iso).

**Packet sprites** — `packet_read.png`, `packet_write.png`.

**Back wall** — new `src/assets/back_wall.png`, tileable strip rendered behind row 0.

**Company logos** — new `src/assets/logos/{netflix,bitly,instagram}.png`, framed pico-8 poster style.

### Reused, not regenerated

- **Client** — existing `src/assets/stack-attack/client-typing.gif` (the landing-page typist). PIXI doesn't render GIF natively; plan for either:
  - (a) Extract the first frame as `client-typing.png` (static), OR
  - (b) Extract all frames to a spritesheet and render with `AnimatedSprite`
  - Default to (a). Animation is polish, not a blocker for this spec.

### UI / HUD CSS reskin (no sprite generation)

- `src/styles.css`, `src/cyberpunk-hud.css`, `src/auth/auth.css`, `src/chatbot/` CSS — palette vars swapped to `--pi-*`, no structural changes
- Button pattern promoted from landing CTA (solid fill, 3px ink border, 5px magenta box-shadow, `steps(2)` transitions) to in-game buttons
- `src/cyberpunk-hud.ts` — move any hard-coded colors to CSS vars
- No file/class renames (defer)

## Architecture

### Archive + fallback

Before any regeneration:

```
git mv src/assets/*.png src/assets/_cyberpunk-archive/
```

The existing `SPRITE_URLS` map in `src/render/cyberpunk/component-layer.ts` (lines 8–23) is duplicated as a commented-out `CYBERPUNK_SPRITE_URLS` block adjacent to the live map. Rollback path: `git mv _cyberpunk-archive/*.png ../` and uncomment. Verified as part of the rollout (see Testing).

### Renderer changes

Location: `src/render/cyberpunk/`.

- **`component-layer.ts`** — no structural change.
  - `SPRITE_URLS.client` points at the converted `client-typing.png` (or spritesheet, if chosen).
  - The base/highlight split texture logic keeps working, but the "cyan → utilization tint" heuristic is modified: the pixel detector targets `#29ADFF` (Pico-8 blue) instead of cyan. Any sprite wanting utilization tinting uses `#29ADFF` as its LED/accent color. This is a small constant change, not a refactor.
- **`board.ts`** — loads the new tile PNGs. No code change.
- **`tokens.ts`** — palette constants (currently cyberpunk hex values) replaced with Pico-8 equivalents. Anywhere code tints primitive `Graphics` shapes, it reads from here.
- **New `wall-layer.ts`** — a small new layer that draws, behind all other iso content:
  1. The `back_wall.png` strip at the back of the board (north edge)
  2. One logo decal at a fixed screen position on that wall, chosen from the current level id
  - Mounted once per scene. No per-frame work.
  - Level id is already available in the boot files (`physics-td/physics-td.ts` branches on `?level=url-shortener`; `diagnose-boot.ts` reads a level from the URL).

### HUD / CSS

- `--pi-*` vars are the only palette source. Every stylesheet imports the shared palette file or inherits from `body`.
- No `cyberpunk-` class renames — churn for no functional win. The directory name `src/render/cyberpunk/` is left alone.

### Sprite footprint rule

Every component occupies **exactly 1 iso tile** for gameplay (placement, collision, routing). Visual size is variable — sprites may overflow their tile upward and to the sides. Anchor point stays at tile center. This keeps sim/core code untouched.

## PixelLab generation workflow

### Per-component loop

1. Write the prompt for the component.
2. Call `mcp__pixellab__create_isometric_tile` with a per-component `size` (variable; default 96×96 unless sprite warrants taller/wider).
3. Fetch the resulting PNG, drop into `src/assets/<name>.png`.
4. Run `pnpm dev`, view in-context on the iso board.
5. User approval gate:
   - Approved → commit the sprite with a focused message; move to next component
   - Rejected → refine prompt, regenerate. Rejected attempts archived under `.worktrees/<branch>/_rejects/<component>-vN.png`
6. Repeat until all components done.

### Prompt template

Every prompt pins the palette:

> *"Isometric pixel-art tile, strict Pico-8 16-color palette only (#000, #1D2B53, #7E2553, #008751, #AB5236, #5F574F, #C2C3C7, #FFF1E8, #FF004D, #FFA300, #FFEC27, #00E436, #29ADFF, #83769C, #FF77A8, #FFCCAA), hard black outlines, chunky readable silhouette, transparent background. Subject: `<SUBJECT>`. Reads as retro office equipment sitting on a single floor tile. LED accent (if any) uses #29ADFF so it picks up utilization tinting."*

Per-component `<SUBJECT>` lines drafted from `docs/sprite-themes/theme-1-8bit-datacenter.md`.

### Iteration order

Easy silhouettes first to build confidence, then harder ones, then environment:

1. `server`
2. `database`
3. `load_balancer`, `api_gateway`, `cdn`
4. `queue`, `worker`, `edge_cache`
5. `streaming_server`, `dns_gtm`, `blob_storage`, `circuit_breaker`
6. `data_cache`
7. `tile_light`, `tile_dark`
8. `packet_read`, `packet_write`
9. `back_wall`
10. `logos/netflix`, `logos/bitly`, `logos/instagram`

### Palette conformance check

A small script at `scripts/check-palette.mjs` reads every PNG recursively under `src/assets/` (excluding `_cyberpunk-archive/`) and asserts every opaque pixel is in the Pico-8 16-color set. Run after each generation; also wired into the test suite as `tests/unit/palette-conformance.test.ts`.

## Testing

### New tests

- `tests/unit/palette-conformance.test.ts` — recursively walks `src/assets/**/*.png` (excluding `_cyberpunk-archive/` and `stack-attack/engineers/`), opens each, verifies all opaque pixels are in the Pico-8 16-color set.
- `tests/unit/asset-presence.test.ts` — asserts every URL in `SPRITE_URLS` resolves to an existing file.

### Existing suite

- `pnpm test` stays green (833-passing baseline per HANDOFF)
- `pnpm typecheck` stays clean
- No sim/core changes expected → `tests/unit/engine-pixi-isolation.test.ts` and sim-layer tests untouched

### Manual verification (browser)

- `/` — landing unchanged (it's already Pico-8)
- `/levels.html` — palette consistent
- `/game.html?wave=1` — Netflix campaign: placement, one wave, connections route, packets animate, utilization tint pulses on overload, back wall visible, Netflix logo on wall
- `/game.html?level=url-shortener` — Bitly logo swaps in
- `/diagnose.html` — Instagram logo on Instagram levels
- Mobile viewport (≤640px) — sprites remain readable

### Rollback drill

Before any new sprites are generated, confirm the archive move works end-to-end:

```
git mv src/assets/_cyberpunk-archive/*.png src/assets/
# verify cyberpunk renders
git mv src/assets/*.png src/assets/_cyberpunk-archive/
```

Run once; proves the fallback path is real before we commit to the retheme.

## Definition of done

- All 13 components + floor + packets + back wall + 3 logos regenerated and user-approved
- `tests/unit/palette-conformance.test.ts` passing
- `tests/unit/asset-presence.test.ts` passing
- UI/HUD CSS palette pass complete (all stylesheets using `--pi-*`)
- `pnpm test` + `pnpm typecheck` green
- Smoke-check on Netflix, Bitly, Instagram campaigns in browser
- Git history: archive commit first, then per-component (or small-batch) commits so any one sprite can be reverted in isolation

## Open items (flagged, not blockers)

- **Client animation**: default is static first-frame PNG. If the typing animation is visually important, upgrade to `AnimatedSprite` in a follow-on pass.
- **Directory rename** `src/render/cyberpunk/` → `src/render/pico8/`: deferred. Rename when no other branches depend on the path.
- **Connection line colors**: adjacent to this work but not included. Wires currently use cyberpunk colors; a CSS var swap is cheap and can ride along or defer.
- **Per-level portrait expansion**: if company logos feel too minimal, future work could add Pico-8 "mission statement" posters, whiteboard decals, etc. Out of scope here.

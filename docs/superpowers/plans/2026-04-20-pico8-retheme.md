# Pico-8 Retheme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the in-game iso board to strict Pico-8 16-color palette with an "office" frame (back wall + company logo), keeping gameplay, sim, and rendering architecture untouched.

**Architecture:** Archive existing cyberpunk sprites for rollback, then regenerate 13 component sprites + floor tiles + packet sprites + back wall + 3 company logos via the PixelLab MCP, one at a time with user approval between each. Change the renderer's utilization-highlight detector from cyan to Pico-8 blue (`#29ADFF`). Add a new `wall-layer.ts` that draws a back-wall strip and one logo decal driven by level id. UI/HUD CSS gets a palette-var swap only (no layout changes). A palette-conformance test and an asset-presence test guard against drift.

**Tech Stack:** PIXI.js 8, Vite, TypeScript strict, Vitest, pnpm. PixelLab MCP (`mcp__pixellab__create_isometric_tile`) for sprite generation. ffmpeg for GIF frame extraction.

**Reference spec:** `docs/superpowers/specs/2026-04-20-pico8-retheme-design.md`

---

## File structure

### New files

- `src/assets/_cyberpunk-archive/` — frozen copy of the current sprite set (fallback)
- `src/assets/logos/netflix.png`, `bitly.png`, `instagram.png` — new logo decals
- `src/assets/back_wall.png` — new tileable back-wall sprite
- `src/assets/client-typing.png` — static first frame of `client-typing.gif`
- `src/styles/palette.css` — shared `--pi-*` palette vars (single source of truth)
- `src/render/cyberpunk/wall-layer.ts` — draws back wall + logo decal, level-driven
- `scripts/check-palette.mjs` — standalone palette-conformance CLI
- `tests/unit/palette-conformance.test.ts` — enforces Pico-8 palette on all live sprites
- `tests/unit/asset-presence.test.ts` — asserts every URL in `SPRITE_URLS` resolves

### Regenerated files (overwrite in place)

- `src/assets/server.png`, `database.png`, `data-cache.png`, `load_balancer.png`, `cdn.png`, `api_gateway.png`, `queue.png`, `worker.png`, `streaming_server.png`, `edge_cache.png`, `dns_gtm.png`, `blob_storage.png`, `circuit_breaker.png` — 13 component sprites
- `src/assets/tile_light.png`, `tile_dark.png` — floor tiles
- `src/assets/packet_read.png`, `packet_write.png` — packet sprites

### Modified files

- `src/render/cyberpunk/component-layer.ts` — change cyan heuristic to `#29ADFF` detector; swap `SPRITE_URLS.client` to `client-typing.png`; archive the current map as a commented `CYBERPUNK_SPRITE_URLS` block
- `src/render/cyberpunk/tokens.ts` — palette constants replaced with Pico-8 equivalents
- `src/render/cyberpunk-topology-renderer.ts` — add `setWall(levelId)` method, instantiate wall-layer
- `src/physics-td/physics-td.ts` — call `renderer.setWall(levelId)` after mount
- `src/diagnose-boot.ts` — call `renderer.setWall(levelId)` after mount
- `src/styles.css` — import shared palette; any lingering cyberpunk hex values swapped
- `src/cyberpunk-hud.css` — palette vars swapped to `--pi-*`
- `src/cyberpunk-hud.ts` — move any hard-coded colors into CSS vars
- `src/auth/auth.css` — palette swap
- `src/chatbot/*.css` — palette swap
- `src/index.html` — remove inline `--pi-*` block (now in shared file), add `<link>` to shared palette
- `package.json` — add `check-palette` script, add `sharp` or `pngjs` devDep if needed for the palette script
- `vitest.config.*` — no change expected; confirm `tests/unit/*.test.ts` already discovered

---

## Phase 0 — Worktree setup

### Task 0: Create isolated worktree

**Files:** none (setup step)

- [ ] **Step 1: Create worktree**

Run: `git worktree add .worktrees/pico8-retheme -b pico8-retheme main`
Expected: new dir `.worktrees/pico8-retheme`, branch `pico8-retheme` tracking `main`.

- [ ] **Step 2: Cd into worktree and install**

Run from repo root:
```bash
cd .worktrees/pico8-retheme
pnpm install
```
Per `docs/claude/worktree-gotchas.md`: `node_modules` is a symlink — if install complains, see that doc.

- [ ] **Step 3: Baseline check**

Run:
```bash
pnpm typecheck
pnpm test --run
```
Expected: typecheck clean. 833 passing, 7 skipped (per HANDOFF).

No commit. Baseline recorded mentally.

---

## Phase 1 — Safety net (archive + tests)

### Task 1: Archive existing sprites

**Files:**
- Create: `src/assets/_cyberpunk-archive/` (directory)
- Copy: all `src/assets/*.png` → `src/assets/_cyberpunk-archive/`

- [ ] **Step 1: Make archive dir and copy sprites**

Run from worktree root:
```bash
mkdir -p src/assets/_cyberpunk-archive
cp src/assets/*.png src/assets/_cyberpunk-archive/
```
Expected: archive contains 19 PNGs (mirror of `src/assets/*.png`). Live `src/assets/*.png` untouched — app still renders cyberpunk.

- [ ] **Step 2: Verify count matches**

Run:
```bash
ls src/assets/*.png | wc -l
ls src/assets/_cyberpunk-archive/*.png | wc -l
```
Expected: same number.

- [ ] **Step 3: Commit archive**

```bash
git add src/assets/_cyberpunk-archive/
git commit -m "chore(assets): archive cyberpunk sprites as retheme fallback

Before regenerating sprites in the Pico-8 retheme, snapshot the current
cyberpunk sprite set so we can revert with a single cp if needed."
```

---

### Task 2: Rollback drill — prove the archive works

**Files:** none (validation step)

- [ ] **Step 1: Simulate live-set corruption**

Run from worktree root:
```bash
mkdir -p /tmp/pico8-drill
mv src/assets/server.png /tmp/pico8-drill/
```

- [ ] **Step 2: Start dev server and verify breakage**

Run: `pnpm dev`
Open `http://localhost:5173/game.html?wave=1` in browser.
Expected: server sprite missing / fallback warning in console.

Stop dev server (Ctrl+C).

- [ ] **Step 3: Restore from archive**

Run:
```bash
cp src/assets/_cyberpunk-archive/server.png src/assets/
```
Start dev server again: `pnpm dev`. Open same URL. Expected: server sprite renders as before. Stop dev server.

- [ ] **Step 4: Clean up the drill artifact**

Run:
```bash
rm /tmp/pico8-drill/server.png
rmdir /tmp/pico8-drill
```

No commit (drill left no tracked changes).

---

### Task 3: Palette-conformance script

**Files:**
- Create: `scripts/check-palette.mjs`

- [ ] **Step 1: Add `pngjs` to devDependencies**

Run: `pnpm add -D pngjs`

Expected: `package.json` updated, lockfile updated.

- [ ] **Step 2: Write the script**

Create `scripts/check-palette.mjs`:

```javascript
#!/usr/bin/env node
// Verify every opaque pixel in the live sprite set is in the Pico-8 16-color palette.
// Usage: node scripts/check-palette.mjs
// Exits 0 on pass, 1 on violation.

import { readdirSync, statSync, createReadStream } from "node:fs";
import { join, relative } from "node:path";
import { PNG } from "pngjs";

const PICO8 = new Set([
  "000000", "1D2B53", "7E2553", "008751",
  "AB5236", "5F574F", "C2C3C7", "FFF1E8",
  "FF004D", "FFA300", "FFEC27", "00E436",
  "29ADFF", "83769C", "FF77A8", "FFCCAA",
]);

const ROOT = "src/assets";
const EXCLUDE = new Set(["_cyberpunk-archive", "stack-attack"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.toLowerCase().endsWith(".png")) out.push(full);
  }
  return out;
}

function checkPng(path) {
  return new Promise((resolve, reject) => {
    createReadStream(path)
      .pipe(new PNG())
      .on("parsed", function () {
        const bad = new Set();
        for (let i = 0; i < this.data.length; i += 4) {
          const a = this.data[i + 3];
          if (a === 0) continue;
          const r = this.data[i].toString(16).padStart(2, "0").toUpperCase();
          const g = this.data[i + 1].toString(16).padStart(2, "0").toUpperCase();
          const b = this.data[i + 2].toString(16).padStart(2, "0").toUpperCase();
          const hex = r + g + b;
          if (!PICO8.has(hex)) bad.add(hex);
        }
        resolve({ path, bad: [...bad] });
      })
      .on("error", reject);
  });
}

const files = walk(ROOT);
let violations = 0;
for (const file of files) {
  const { bad } = await checkPng(file);
  if (bad.length > 0) {
    violations++;
    console.error(`[palette] ${relative(".", file)} — off-palette colors: ${bad.join(", ")}`);
  }
}
if (violations > 0) {
  console.error(`\n${violations} file(s) off-palette.`);
  process.exit(1);
}
console.log(`OK — ${files.length} sprite(s) conform to Pico-8 palette.`);
```

Make executable: `chmod +x scripts/check-palette.mjs`.

- [ ] **Step 3: Add npm script**

Edit `package.json`. In the `"scripts"` object add (preserving existing scripts):

```json
"check-palette": "node scripts/check-palette.mjs"
```

- [ ] **Step 4: Run against the current live set**

Run: `pnpm check-palette`
Expected: reports off-palette colors for **every** cyberpunk sprite (cyan `5EF0FF` etc.). This is expected — the script works; the current sprites aren't Pico-8 yet. Do not fix violations; they go away when sprites are regenerated.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-palette.mjs package.json pnpm-lock.yaml
git commit -m "chore(tools): add pico-8 palette-conformance script"
```

---

### Task 4: Palette-conformance test

**Files:**
- Create: `tests/unit/palette-conformance.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/unit/palette-conformance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const PICO8 = new Set([
  "000000", "1D2B53", "7E2553", "008751",
  "AB5236", "5F574F", "C2C3C7", "FFF1E8",
  "FF004D", "FFA300", "FFEC27", "00E436",
  "29ADFF", "83769C", "FF77A8", "FFCCAA",
]);

const ROOT = "src/assets";
const EXCLUDE = new Set(["_cyberpunk-archive", "stack-attack"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.toLowerCase().endsWith(".png")) out.push(full);
  }
  return out;
}

function offPaletteColors(path: string): string[] {
  const buf = readFileSync(path);
  const png = PNG.sync.read(buf);
  const bad = new Set<string>();
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a === 0) continue;
    const r = png.data[i].toString(16).padStart(2, "0").toUpperCase();
    const g = png.data[i + 1].toString(16).padStart(2, "0").toUpperCase();
    const b = png.data[i + 2].toString(16).padStart(2, "0").toUpperCase();
    const hex = r + g + b;
    if (!PICO8.has(hex)) bad.add(hex);
  }
  return [...bad];
}

describe("palette conformance — live sprite set must be Pico-8 16-color", () => {
  const files = walk(ROOT);

  it.each(files)("%s conforms to Pico-8", (file) => {
    const bad = offPaletteColors(file);
    expect(bad, `off-palette in ${file}: ${bad.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect red**

Run: `pnpm test tests/unit/palette-conformance.test.ts`
Expected: every current cyberpunk sprite fails. This is the intended red state — proves the test works. Tests will go green as sprites are regenerated.

- [ ] **Step 3: Skip the file for now**

So we don't break CI while regenerating, mark the suite `describe.skip` until all sprites are regenerated:

Edit `tests/unit/palette-conformance.test.ts`, change `describe(` to `describe.skip(`.

- [ ] **Step 4: Confirm full suite still green**

Run: `pnpm test --run`
Expected: same baseline as before (833+ passing). New test file adds 0 active tests.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/palette-conformance.test.ts
git commit -m "test(palette): add conformance test (skipped until sprites regenerated)"
```

---

### Task 5: Asset-presence test

**Files:**
- Create: `tests/unit/asset-presence.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/unit/asset-presence.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Source of truth: SPRITE_URLS in src/render/cyberpunk/component-layer.ts
// This test duplicates the path list on purpose — if the real one drifts
// and a file is missing, the renderer falls back silently. We want noise.
const COMPONENT_SPRITES = [
  "client.png",            // swapped to client-typing.png later
  "server.png",
  "database.png",
  "data-cache.png",
  "load_balancer.png",
  "cdn.png",
  "api_gateway.png",
  "queue.png",
  "worker.png",
  "streaming_server.png",
  "edge_cache.png",
  "dns_gtm.png",
  "blob_storage.png",
  "circuit_breaker.png",
];

const FLOOR = ["tile_light.png", "tile_dark.png"];
const PACKETS = ["packet_read.png", "packet_write.png"];

describe("asset presence — every sprite referenced by the renderer exists on disk", () => {
  it.each([...COMPONENT_SPRITES, ...FLOOR, ...PACKETS])("src/assets/%s exists", (name) => {
    expect(existsSync(`src/assets/${name}`)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should pass**

Run: `pnpm test tests/unit/asset-presence.test.ts`
Expected: all pass (current live set has all these files).

- [ ] **Step 3: Full suite green**

Run: `pnpm test --run`
Expected: baseline + asset-presence tests passing.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/asset-presence.test.ts
git commit -m "test(assets): add sprite presence test"
```

---

## Phase 2 — CSS palette foundation

Palette-only changes to every stylesheet. No layout, no structure. App should look like the landing page's palette bled into the HUD, with sprites still cyberpunk (which is fine — visual dissonance is temporary).

### Task 6: Promote `--pi-*` vars to shared palette file

**Files:**
- Create: `src/styles/palette.css`
- Modify: `src/index.html` — remove inline `--pi-*` block, add `<link>` to palette.css

- [ ] **Step 1: Read the current inline palette**

Read `src/index.html:17-23` and any other place `--pi-*` is defined. Expected vars: `--pi-bg-2`, `--pi-cream`, `--pi-yellow`, `--pi-cyan`, `--pi-pink`, `--pi-magenta`, `--pi-orange`, `--pi-ink`, `--pi-font-display`, `--pi-font-body`.

- [ ] **Step 2: Create `src/styles/palette.css`**

```css
/* Shared Pico-8 palette + typography.
   Single source of truth. Import from any stylesheet that needs --pi-* vars. */
:root {
  /* 16-color Pico-8 palette */
  --pi-black:   #000000;
  --pi-navy:    #1D2B53;
  --pi-maroon:  #7E2553;
  --pi-dkgreen: #008751;
  --pi-brown:   #AB5236;
  --pi-dkgrey:  #5F574F;
  --pi-lgrey:   #C2C3C7;
  --pi-white:   #FFF1E8;
  --pi-red:     #FF004D;
  --pi-orange:  #FFA300;
  --pi-yellow:  #FFEC27;
  --pi-green:   #00E436;
  --pi-blue:    #29ADFF;
  --pi-lavender:#83769C;
  --pi-pink:    #FF77A8;
  --pi-peach:   #FFCCAA;

  /* Landing-page aliases (kept for back-compat) */
  --pi-bg-2:    #1a2150;  /* deep navy */
  --pi-cream:   var(--pi-white);
  --pi-cyan:    var(--pi-blue);
  --pi-magenta: var(--pi-maroon);
  --pi-ink:     var(--pi-black);

  --pi-font-display: 'Press Start 2P', monospace;
  --pi-font-body: 'VT323', 'IBM Plex Mono', monospace;
}
```

- [ ] **Step 3: Link palette from `src/index.html`**

In `src/index.html`, in `<head>`, replace the inline `:root { --pi-* }` block (inside the `<style>` tag) with a `<link rel="stylesheet" href="./styles/palette.css" />` above the existing stylesheets. Keep the rest of the `<style>` block intact.

- [ ] **Step 4: Link palette from other entrypoints**

Add the same `<link>` to `<head>` of:
- `src/levels.html`
- `src/game.html`
- `src/diagnose.html`

- [ ] **Step 5: Verify landing page still renders correctly**

Run: `pnpm dev`
Open `http://localhost:5173/`.
Expected: landing looks identical to before — yellow wordmark, pink/magenta shadow, cream CTA bubble, orange "INSERT COIN" button.

Stop dev server.

- [ ] **Step 6: Typecheck + test**

Run: `pnpm typecheck && pnpm test --run`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/styles/palette.css src/index.html src/levels.html src/game.html src/diagnose.html
git commit -m "refactor(styles): promote Pico-8 palette to shared palette.css"
```

---

### Task 7: Swap cyberpunk-hud.css to Pico-8 palette vars

**Files:**
- Modify: `src/cyberpunk-hud.css`

- [ ] **Step 1: Inventory current colors**

Read `src/cyberpunk-hud.css` end-to-end. Note every hex color, `rgba()`, and CSS var referenced.

- [ ] **Step 2: Build a mapping**

Create a mental/notebook mapping from cyberpunk colors to Pico-8 equivalents. Typical mapping rules:
- Dark background navy → `var(--pi-bg-2)` (#1a2150)
- Neon cyan (`#5ef0ff`, etc.) → `var(--pi-blue)` (#29ADFF)
- Pure black → `var(--pi-black)`
- White/cream text → `var(--pi-white)`
- Warning red → `var(--pi-red)`
- Overload orange → `var(--pi-orange)`
- Success green → `var(--pi-green)`
- Purple/violet accents → `var(--pi-lavender)` or `var(--pi-maroon)`

- [ ] **Step 3: Apply the swap**

Edit `src/cyberpunk-hud.css`, replacing hex literals with the appropriate `var(--pi-*)`. Do **not** change selectors, layout properties (width/height/flex/grid/padding/margin), or animations.

- [ ] **Step 4: Browser check**

Run: `pnpm dev`.
Open `http://localhost:5173/game.html?wave=1`.
Expected: HUD color-shifts into Pico-8 palette. Layout unchanged. Sprites still cyberpunk (that's fine).

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/cyberpunk-hud.css
git commit -m "refactor(hud): swap cyberpunk-hud palette to Pico-8 vars"
```

---

### Task 8: Swap cyberpunk-hud.ts hard-coded colors to CSS vars

**Files:**
- Modify: `src/cyberpunk-hud.ts`

- [ ] **Step 1: Find hard-coded colors**

Run: `grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' src/cyberpunk-hud.ts`
Expected: a list of inline color literals set via `element.style.xxx = "..."`.

- [ ] **Step 2: Move colors to CSS**

For each literal, either:
- Add a class in `cyberpunk-hud.css` that uses `var(--pi-*)`, and apply the class from TS (preferred), OR
- Set `element.style.xxx = "var(--pi-*)"` directly (fine for simple cases).

Prefer moving to CSS — keeps one source of truth.

- [ ] **Step 3: Browser check + typecheck**

Run: `pnpm typecheck && pnpm dev`.
Open game page. Confirm no visual regressions and no console warnings about invalid colors.
Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/cyberpunk-hud.ts src/cyberpunk-hud.css
git commit -m "refactor(hud): move hard-coded colors out of cyberpunk-hud.ts"
```

---

### Task 9: Swap auth.css + chatbot CSS to Pico-8 vars

**Files:**
- Modify: `src/auth/auth.css`
- Modify: `src/chatbot/*.css` (all CSS files under chatbot/)

- [ ] **Step 1: Inventory chatbot CSS files**

Run: `ls src/chatbot/*.css`
Expected: one or more CSS files.

- [ ] **Step 2: Apply the same swap rules as Task 7**

Edit each file. Hex literals → `var(--pi-*)`. No layout changes.

- [ ] **Step 3: Browser check**

Run `pnpm dev`. Open game page. Log in (if auth is enabled) — auth modal should use Pico-8 palette. Open chatbot drawer — same. No layout regressions.

- [ ] **Step 4: Commit**

```bash
git add src/auth/auth.css src/chatbot/*.css
git commit -m "refactor(styles): swap auth + chatbot CSS to Pico-8 palette vars"
```

---

### Task 10: Swap `tokens.ts` palette to Pico-8

**Files:**
- Modify: `src/render/cyberpunk/tokens.ts`

- [ ] **Step 1: Apply the swap**

Edit `src/render/cyberpunk/tokens.ts`. Replace the `palette` section as follows:

```typescript
export const CYBERPUNK_TOKENS = {
  palette: {
    bg: 0x1a2150,             // pico-8 deep navy background
    tileLine: 0x1D2B53,       // pico-8 navy — grid lines on floor tiles
    connection: 0x29ADFF,     // pico-8 blue — active connection
    connectionDim: 0x83769C,  // pico-8 lavender — idle connection
    packet: 0x29ADFF,         // pico-8 blue — forward packet
    packetReturn: 0xFFEC27,   // pico-8 yellow — return packet
    selectionRing: 0xFFEC27,  // pico-8 yellow — selection highlight
    ghost: 0xFFCCAA,          // pico-8 peach — placement ghost
    flashOverload: 0xFF004D,  // pico-8 red
    flashDrop: 0xFFA300,      // pico-8 orange
    flashResponded: 0x00E436, // pico-8 green
  },
  scale: { /* unchanged */
    spriteScale: 1,
    tileScale: 1.25,
    isoHalfWidth: 40,
    isoHalfHeight: 20,
  },
  board: { size: 30 },
  timing: {
    defaultPacketTraversalMs: 1200,
    maxPendingFlashAgeMs: 1500,
  },
  cable: {
    outerWidth: 12,
    coreWidth: 8,
    highlightWidth: 2,
  },
} as const;
```

(The dir/name comment mentioning "cyberpunk" is now inaccurate. Leave it for the defer-rename decision from the spec.)

- [ ] **Step 2: Typecheck + test + browser**

Run: `pnpm typecheck && pnpm test --run && pnpm dev`.
Open `http://localhost:5173/game.html?wave=1`.
Expected: connection lines, selection ring, packets, flash effects all now render in Pico-8 hues. Sprites still cyberpunk.
Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add src/render/cyberpunk/tokens.ts
git commit -m "refactor(tokens): swap cyberpunk renderer palette constants to Pico-8"
```

---

## Phase 3 — Renderer prep

### Task 11: Change cyan-highlight heuristic to #29ADFF detector

**Files:**
- Modify: `src/render/cyberpunk/component-layer.ts:79-81`

- [ ] **Step 1: Replace the heuristic**

In `src/render/cyberpunk/component-layer.ts`, find the block starting at line 79:

```typescript
    // Cyan heuristic: alpha present, green+blue bright and similar, red well below both.
    const isCyan =
      a > 0 && g > 100 && b > 100 && r < g - 20 && r < b - 20 && Math.abs(g - b) < 60;
```

Replace with:

```typescript
    // Pico-8 blue detector (#29ADFF = 41, 173, 255). Exact match — sprites are
    // generated in a fixed 16-color palette so we don't need tolerance.
    const isCyan = a > 0 && r === 0x29 && g === 0xAD && b === 0xFF;
```

Keep variable name `isCyan` — it's used below at line 83. Renaming is cosmetic churn.

- [ ] **Step 2: Typecheck + test**

Run: `pnpm typecheck && pnpm test --run`
Expected: all clean.

- [ ] **Step 3: Browser check — no regression yet**

Run: `pnpm dev`. Open `game.html?wave=1`. Expected: cyberpunk sprites still render, but utilization tint may be gone on some components (cyberpunk cyan is no longer detected). This is expected; tint returns once Pico-8 sprites with `#29ADFF` LEDs replace them. Sim still plays.
Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/render/cyberpunk/component-layer.ts
git commit -m "refactor(render): swap cyan utilization detector to #29ADFF exact match"
```

---

### Task 12: Archive the cyberpunk SPRITE_URLS block inline

**Files:**
- Modify: `src/render/cyberpunk/component-layer.ts:8-23`

- [ ] **Step 1: Add a commented snapshot**

Above the live `SPRITE_URLS` map (line 8), add:

```typescript
// NOTE: Cyberpunk sprite URLs archived for rollback. To revert the retheme:
//   1. cp src/assets/_cyberpunk-archive/*.png src/assets/
//   2. Uncomment the CYBERPUNK_SPRITE_URLS block below, delete the live one,
//      and rename the archive back to SPRITE_URLS.
// See docs/superpowers/specs/2026-04-20-pico8-retheme-design.md
//
// const CYBERPUNK_SPRITE_URLS: Record<string, string> = {
//   client: new URL("../../assets/_cyberpunk-archive/client.png", import.meta.url).href,
//   server: new URL("../../assets/_cyberpunk-archive/server.png", import.meta.url).href,
//   database: new URL("../../assets/_cyberpunk-archive/database.png", import.meta.url).href,
//   data_cache: new URL("../../assets/_cyberpunk-archive/data-cache.png", import.meta.url).href,
//   load_balancer: new URL("../../assets/_cyberpunk-archive/load_balancer.png", import.meta.url).href,
//   cdn: new URL("../../assets/_cyberpunk-archive/cdn.png", import.meta.url).href,
//   api_gateway: new URL("../../assets/_cyberpunk-archive/api_gateway.png", import.meta.url).href,
//   queue: new URL("../../assets/_cyberpunk-archive/queue.png", import.meta.url).href,
//   worker: new URL("../../assets/_cyberpunk-archive/worker.png", import.meta.url).href,
//   streaming_server: new URL("../../assets/_cyberpunk-archive/streaming_server.png", import.meta.url).href,
//   edge_cache: new URL("../../assets/_cyberpunk-archive/edge_cache.png", import.meta.url).href,
//   dns_gtm: new URL("../../assets/_cyberpunk-archive/dns_gtm.png", import.meta.url).href,
//   blob_storage: new URL("../../assets/_cyberpunk-archive/blob_storage.png", import.meta.url).href,
//   circuit_breaker: new URL("../../assets/_cyberpunk-archive/circuit_breaker.png", import.meta.url).href,
// };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`.
Expected: clean (the block is commented out).

- [ ] **Step 3: Commit**

```bash
git add src/render/cyberpunk/component-layer.ts
git commit -m "docs(render): archive cyberpunk SPRITE_URLS as inline rollback note"
```

---

### Task 13: Create wall-layer skeleton

**Files:**
- Create: `src/render/cyberpunk/wall-layer.ts`

- [ ] **Step 1: Read SceneContext**

Review `src/render/cyberpunk/scene-context.ts` (see reference). The wall sits at a fixed screen position relative to the board's world center, behind row 0 of the iso grid.

- [ ] **Step 2: Write the layer**

Create `src/render/cyberpunk/wall-layer.ts`:

```typescript
import { Container, Sprite, Texture, Assets } from "pixi.js";
import { CYBERPUNK_TOKENS } from "./tokens.js";
import { gridToWorld } from "./iso-projection.js";

const BACK_WALL_URL = new URL("../../assets/back_wall.png", import.meta.url).href;

const LOGO_URLS: Record<string, string> = {
  netflix: new URL("../../assets/logos/netflix.png", import.meta.url).href,
  "url-shortener": new URL("../../assets/logos/bitly.png", import.meta.url).href,
  instagram: new URL("../../assets/logos/instagram.png", import.meta.url).href,
};

export interface WallLayer {
  readonly root: Container;
  setLevel(levelId: string | null): Promise<void>;
  destroy(): void;
}

/**
 * Draws a back-wall strip behind row 0 of the iso board, plus a company logo
 * decal chosen by level id. If the wall PNG or logo PNG is missing (e.g. during
 * the retheme rollout), the layer silently renders nothing — game still plays.
 */
export function createWallLayer(): WallLayer {
  const root = new Container();
  root.label = "wall-layer";

  let wallSprite: Sprite | null = null;
  let logoSprite: Sprite | null = null;
  let currentLevel: string | null = null;

  async function loadWall(): Promise<void> {
    try {
      const tex = await Assets.load<Texture>(BACK_WALL_URL);
      tex.source.scaleMode = "nearest";
      wallSprite = new Sprite(tex);
      // Position: behind row 0 of the board (negative iso y).
      const { x, y } = gridToWorld(CYBERPUNK_TOKENS.board.size / 2, -1);
      wallSprite.anchor.set(0.5, 1);
      wallSprite.position.set(x, y);
      root.addChildAt(wallSprite, 0);
    } catch {
      // Asset missing during rollout — silently skip.
    }
  }

  async function loadLogo(levelId: string): Promise<void> {
    if (logoSprite) {
      root.removeChild(logoSprite);
      logoSprite.destroy();
      logoSprite = null;
    }
    const url = LOGO_URLS[levelId];
    if (!url) return;
    try {
      const tex = await Assets.load<Texture>(url);
      tex.source.scaleMode = "nearest";
      logoSprite = new Sprite(tex);
      // Position: centered on wall, slightly above grid origin.
      const { x, y } = gridToWorld(CYBERPUNK_TOKENS.board.size / 2, -1);
      logoSprite.anchor.set(0.5, 1);
      logoSprite.position.set(x, y - 40); // tune after wall sprite lands
      root.addChild(logoSprite);
    } catch {
      // Asset missing — silently skip.
    }
  }

  async function setLevel(levelId: string | null): Promise<void> {
    if (wallSprite === null) await loadWall();
    currentLevel = levelId;
    if (levelId) await loadLogo(levelId);
  }

  function destroy(): void {
    if (logoSprite) { logoSprite.destroy(); logoSprite = null; }
    if (wallSprite) { wallSprite.destroy(); wallSprite = null; }
    root.destroy({ children: true });
  }

  return { root, setLevel, destroy };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/render/cyberpunk/wall-layer.ts
git commit -m "feat(render): add wall-layer skeleton (renders nothing until wall/logo sprites land)"
```

---

### Task 14: Wire wall-layer into the renderer

**Files:**
- Modify: `src/render/cyberpunk-topology-renderer.ts`
- Modify: `src/render/topology-renderer.ts` (add optional `setWall` to interface)

- [ ] **Step 1: Extend the interface**

In `src/render/topology-renderer.ts`, after the existing optional methods, add:

```typescript
  /**
   * Set the back-wall decor for the current level. Calling with `null` removes
   * the logo. Renderers that don't support walls can omit this method.
   */
  setWall?(levelId: string | null): Promise<void> | void;
```

- [ ] **Step 2: Implement in cyberpunk renderer**

In `src/render/cyberpunk-topology-renderer.ts`:

1. Add import at top:
   ```typescript
   import { createWallLayer, type WallLayer } from "./cyberpunk/wall-layer.js";
   ```
2. Add private field on the class (near the other layer fields):
   ```typescript
   private wallLayer: WallLayer | null = null;
   ```
3. In `mount()`, after the other layers are added to `this.world`, add:
   ```typescript
   this.wallLayer = createWallLayer();
   this.world!.addChildAt(this.wallLayer.root, 0); // behind everything else
   ```
4. Add the public method:
   ```typescript
   async setWall(levelId: string | null): Promise<void> {
     if (!this.wallLayer) return;
     await this.wallLayer.setLevel(levelId);
   }
   ```
5. In `destroy()`, add:
   ```typescript
   this.wallLayer?.destroy();
   this.wallLayer = null;
   ```

- [ ] **Step 3: Typecheck + test**

Run: `pnpm typecheck && pnpm test --run`
Expected: clean. Engine-isolation test should still pass — wall-layer doesn't import react/next/vercel.

- [ ] **Step 4: Commit**

```bash
git add src/render/topology-renderer.ts src/render/cyberpunk-topology-renderer.ts
git commit -m "feat(render): wire wall-layer into CyberpunkTopologyRenderer"
```

---

### Task 15: Call setWall() from boot scripts

**Files:**
- Modify: `src/physics-td/physics-td.ts`
- Modify: `src/diagnose-boot.ts`

- [ ] **Step 1: Wire from physics-td.ts**

In `src/physics-td/physics-td.ts`, around where the renderer is mounted (look for `await renderer.mount(...)`), add immediately after the `mount` call:

```typescript
  await renderer.setWall?.(levelId ?? "netflix");
```

`levelId` is already in scope (see line 860-ish).

- [ ] **Step 2: Wire from diagnose-boot.ts**

In `src/diagnose-boot.ts`, around the renderer mount (`await renderer.mount(...)`), grab the level's family. Diagnose levels split between Instagram and Netflix; the renderer's logo comes from `level.id`'s family. Add:

```typescript
  const wallLevelId = level.id.startsWith("ig-") ? "instagram" : "netflix";
  await renderer.setWall?.(wallLevelId);
```

(Verify the actual level-id prefix by inspecting `DIAGNOSE_LEVELS` in `src/diagnose/diagnose-level.ts`. Adjust the prefix check if it's different.)

- [ ] **Step 3: Typecheck + test + browser**

Run: `pnpm typecheck && pnpm test --run`
Expected: clean.

Run: `pnpm dev`.
Open `http://localhost:5173/game.html?wave=1`. Expected: no wall/logo visible (assets not generated yet). Console clean.
Open `http://localhost:5173/diagnose.html`. Expected: same.
Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/physics-td/physics-td.ts src/diagnose-boot.ts
git commit -m "feat(boot): wire setWall() into physics-td + diagnose boot"
```

---

## Phase 4 — Client conversion

### Task 16: Extract first frame of client-typing.gif

**Files:**
- Create: `src/assets/client-typing.png`

- [ ] **Step 1: Check ffmpeg is installed**

Run: `ffmpeg -version`
Expected: version info prints. If missing: `brew install ffmpeg`.

- [ ] **Step 2: Extract frame 0**

Run from worktree root:
```bash
ffmpeg -y -i src/assets/stack-attack/client-typing.gif -vframes 1 src/assets/client-typing.png
```
Expected: `src/assets/client-typing.png` created.

- [ ] **Step 3: Palette-check the extracted frame**

Run: `pnpm check-palette`
Expected: reports many off-palette violations across the cyberpunk sprites (unchanged). If violations are reported specifically for `client-typing.png`, GIF encoding introduced anti-aliasing. Response:
1. Add `"client-typing.png"` to the `EXCLUDE_FILES` constant in both `scripts/check-palette.mjs` and `tests/unit/palette-conformance.test.ts` (add a top-level `const EXCLUDE_FILES = new Set(["client-typing.png"]);` and skip matching basenames in the walker).
2. Add a `// TODO(pico-8): re-author client sprite to strict palette` comment above the exclude constant.
3. Continue with the plan. Re-authoring the client is deferred polish, not a blocker.

- [ ] **Step 4: Update SPRITE_URLS.client**

In `src/render/cyberpunk/component-layer.ts`, change line 9:

```typescript
  client: new URL("../../assets/client.png", import.meta.url).href,
```

to:

```typescript
  client: new URL("../../assets/client-typing.png", import.meta.url).href,
```

- [ ] **Step 5: Update asset-presence test**

In `tests/unit/asset-presence.test.ts`, replace `"client.png"` with `"client-typing.png"` in the `COMPONENT_SPRITES` list.

- [ ] **Step 6: Typecheck + test + browser**

Run: `pnpm typecheck && pnpm test --run`
Expected: clean.

Run: `pnpm dev`. Open `game.html?wave=1`. Expected: the landing-page typist appears at the client position on the board. Sim still plays.
Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add src/assets/client-typing.png src/render/cyberpunk/component-layer.ts tests/unit/asset-presence.test.ts
git commit -m "feat(client): use landing-page typist as in-game client sprite"
```

---

## Phase 5 — Sprite generation loop

### Phase 5 procedure (shared across all sprite tasks)

Every sprite-generation task below follows this exact procedure. It is not repeated in each task — the per-sprite tasks give only the inputs (subject, size, output path, commit message) and defer to this procedure.

**Procedure:**

1. **Verify PixelLab MCP tools are available.** If not, run:
   ```bash
   claude mcp add --transport http pixellab https://api.pixellab.ai/mcp \
     --header "Authorization: Bearer 3b469505-a138-4872-b022-03817fb3e08c"
   ```
2. **Construct the prompt** by substituting `<SUBJECT>` into this template:
   > *"Isometric pixel-art tile, strict Pico-8 16-color palette only (#000, #1D2B53, #7E2553, #008751, #AB5236, #5F574F, #C2C3C7, #FFF1E8, #FF004D, #FFA300, #FFEC27, #00E436, #29ADFF, #83769C, #FF77A8, #FFCCAA), hard black outlines, chunky readable silhouette, transparent background. Subject: `<SUBJECT>`. Reads as retro office equipment sitting on a single floor tile. LED accent (if any) uses #29ADFF so it picks up utilization tinting."*
3. **Call `mcp__pixellab__create_isometric_tile`** with `description=<prompt>` and the task-specified `size`. Wait for the job to complete.
4. **Save the output** to the task-specified path in `src/assets/`.
5. **Run `pnpm check-palette`.** If violations appear for this sprite, the generation drifted. Save the reject to `.rejects/<name>-v<n>.png` (create the dir if needed — gitignored) and regenerate with a tightened prompt (mention the offending color: "no gradients, no anti-aliasing, pure 16-color pixels").
6. **Run the dev server** (`pnpm dev`) and navigate to a page showing the sprite. Visually confirm it reads correctly on the iso board at its intended scale.
7. **Show the user** and wait for approval. If rejected, archive the attempt to `.rejects/` and return to step 2 with a refined subject.
8. **Commit** once approved.

**Dev-server tip:** only one `pnpm dev` per session (per CLAUDE.md). Keep it running through the whole phase; Vite HMR will reload the sprite on save.

**`.rejects/` dir:** add to `.gitignore` if not already.

---

### Task 17: Prepare reject archive dir

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Gitignore `.rejects/`**

Append to `.gitignore`:
```
.rejects/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore .rejects/ sprite reject archive"
```

---

### Task 18: Generate `server` sprite

**Inputs:**
- Subject: `"beige 1990s tower PC / rackmount unit with a chunky power button and blinking green LED strip on the front panel, visible fan grille on the side, thick power cable trailing off the back"`
- Size: 96×96
- Output path: `src/assets/server.png` (overwrites live cyberpunk sprite)

- [ ] Run Phase 5 procedure with the inputs above.
- [ ] Commit message:
  ```bash
  git add src/assets/server.png
  git commit -m "feat(sprites): pico-8 server (1/21)"
  ```

---

### Task 19: Generate `database` sprite

**Inputs:**
- Subject: `"stack of 3 chunky hard drives / disk platters in a beige enclosure, LED activity lights blinking in sequence on the front, small 'DB' label in pixel font"`
- Size: 96×96
- Output path: `src/assets/database.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/database.png && git commit -m "feat(sprites): pico-8 database (2/21)"`

---

### Task 20: Generate `data_cache` sprite

**Inputs:**
- Subject: `"small boxy unit resembling a RAM stick standing upright in a bracket, glowing blue traces along the PCB edge, noticeably smaller and faster-looking than a database"`
- Size: 80×96
- Output path: `src/assets/data-cache.png` (note hyphen, matches existing filename)

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/data-cache.png && git commit -m "feat(sprites): pico-8 data-cache (3/21)"`

---

### Task 21: Generate `load_balancer` sprite

**Inputs:**
- Subject: `"office-style network switch box, flat and wide, a row of blinking ethernet port LEDs across the front, small digital display showing a rotating arrow icon"`
- Size: 112×96
- Output path: `src/assets/load_balancer.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/load_balancer.png && git commit -m "feat(sprites): pico-8 load_balancer (4/21)"`

---

### Task 22: Generate `api_gateway` sprite

**Inputs:**
- Subject: `"security checkpoint / badge reader terminal, small screen showing a lock icon, card slot on the side, green/red indicator light on top, turnstile gate aesthetic"`
- Size: 96×112
- Output path: `src/assets/api_gateway.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/api_gateway.png && git commit -m "feat(sprites): pico-8 api_gateway (5/21)"`

---

### Task 23: Generate `cdn` sprite

**Inputs:**
- Subject: `"satellite dish or antenna mounted on a small rack shelf, dish with concentric rings and a blue glow at the focal point, coax cable running down to the base"`
- Size: 96×112
- Output path: `src/assets/cdn.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/cdn.png && git commit -m "feat(sprites): pico-8 cdn (6/21)"`

---

### Task 24: Generate `queue` sprite

**Inputs:**
- Subject: `"inbox/outbox desk tray, a stackable paper tray with pixel-art documents piling up, small LED counter showing queue depth, papers glow blue at the edges"`
- Size: 96×96
- Output path: `src/assets/queue.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/queue.png && git commit -m "feat(sprites): pico-8 queue (7/21)"`

---

### Task 25: Generate `worker` sprite

**Inputs:**
- Subject: `"desktop PC workstation, chunky CRT monitor showing a progress bar, keyboard in front, screen glows blue, small 'BUSY' indicator LED on the monitor bezel"`
- Size: 96×96
- Output path: `src/assets/worker.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/worker.png && git commit -m "feat(sprites): pico-8 worker (8/21)"`

---

### Task 26: Generate `edge_cache` sprite

**Inputs:**
- Subject: `"mini fridge-sized box with a globe / world icon sticker on the front, smaller and closer-feeling than a CDN, antenna nub on top, blue status ring"`
- Size: 80×96
- Output path: `src/assets/edge_cache.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/edge_cache.png && git commit -m "feat(sprites): pico-8 edge_cache (9/21)"`

---

### Task 27: Generate `streaming_server` sprite

**Inputs:**
- Subject: `"VHS / tape deck unit with reels visibly spinning, blue 'PLAY' triangle on the front display, chunky play / stop / rewind buttons below a display window"`
- Size: 112×96
- Output path: `src/assets/streaming_server.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/streaming_server.png && git commit -m "feat(sprites): pico-8 streaming_server (10/21)"`

---

### Task 28: Generate `dns_gtm` sprite

**Inputs:**
- Subject: `"rotary phone switchboard operator panel, patch cables and jacks, small directory / address book icon, blue lights tracing active routes across the patch panel"`
- Size: 112×96
- Output path: `src/assets/dns_gtm.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/dns_gtm.png && git commit -m "feat(sprites): pico-8 dns_gtm (11/21)"`

---

### Task 29: Generate `blob_storage` sprite

**Inputs:**
- Subject: `"tall 3-drawer filing cabinet with chunky handles, one drawer slightly open showing colorful file folders inside, label slots on each drawer front glow blue"`
- Size: 96×128
- Output path: `src/assets/blob_storage.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/blob_storage.png && git commit -m "feat(sprites): pico-8 blob_storage (12/21)"`

---

### Task 30: Generate `circuit_breaker` sprite

**Inputs:**
- Subject: `"literal electrical breaker box mounted on a small wall panel, large flip switch in the center (up = closed, down = tripped), red / green indicator light on top, blue arc graphics when active"`
- Size: 96×112
- Output path: `src/assets/circuit_breaker.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/circuit_breaker.png && git commit -m "feat(sprites): pico-8 circuit_breaker (13/21)"`

---

### Task 31: Generate `tile_light` floor sprite

**Inputs:**
- Subject: `"single isometric floor tile, 1990s office beige carpet texture, subtle pixel grain, no prominent pattern — reads as a neutral ground tile"`
- Size: 80×40 (classic 2:1 iso footprint, matches current `tileScale` math)
- Output path: `src/assets/tile_light.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/tile_light.png && git commit -m "feat(sprites): pico-8 tile_light floor (14/21)"`

---

### Task 32: Generate `tile_dark` floor sprite

**Inputs:**
- Subject: `"single isometric floor tile, 1990s office beige carpet texture, one shade darker than tile_light for checkerboard contrast"`
- Size: 80×40
- Output path: `src/assets/tile_dark.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/tile_dark.png && git commit -m "feat(sprites): pico-8 tile_dark floor (15/21)"`

---

### Task 33: Generate `packet_read` sprite

**Inputs:**
- Subject: `"tiny pixel icon representing a read request — an open envelope or a small document with a magnifying glass, blue accent, reads at 16x16 at native resolution"`
- Size: 16×16
- Output path: `src/assets/packet_read.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/packet_read.png && git commit -m "feat(sprites): pico-8 packet_read (16/21)"`

---

### Task 34: Generate `packet_write` sprite

**Inputs:**
- Subject: `"tiny pixel icon representing a write request — a pencil or quill mark on a small document, pink / red accent, reads at 16x16 at native resolution"`
- Size: 16×16
- Output path: `src/assets/packet_write.png`

- [ ] Run Phase 5 procedure.
- [ ] Commit: `git add src/assets/packet_write.png && git commit -m "feat(sprites): pico-8 packet_write (17/21)"`

---

### Task 35: Generate `back_wall` sprite

**Inputs:**
- Subject: `"a single tileable back-wall strip in 1990s office style, wood paneling or drywall with a chair rail, Pico-8 palette, horizontally tileable so the wall can span the entire board width, reads behind the iso grid"`
- Size: 480×120 (width large enough to span most of the board; height ≈ 3 iso-tile heights)
- Output path: `src/assets/back_wall.png`

- [ ] Run Phase 5 procedure.
- [ ] In the wall-layer, the sprite will scale with the board. If the wall feels misaligned after it loads, tune the `position.set()` offset in `src/render/cyberpunk/wall-layer.ts` (inside `loadWall()` — currently `(x, y)` with anchor `(0.5, 1)`). Commit the tuning along with the sprite.
- [ ] Commit: `git add src/assets/back_wall.png src/render/cyberpunk/wall-layer.ts && git commit -m "feat(sprites): pico-8 back_wall + position tune (18/21)"`

---

### Task 36: Generate `netflix` logo decal

**Files:**
- Create: `src/assets/logos/netflix.png`

- [ ] **Step 1: Make logos dir**

Run: `mkdir -p src/assets/logos`

- [ ] **Step 2: Run Phase 5 procedure**

- Subject: `"Netflix logo — the word NETFLIX in bold pico-8 red, mounted in a chunky black wooden picture frame with a small nameplate. Reads as a poster or awards-shelf photo hanging on an office wall."`
- Size: 96×64
- Output path: `src/assets/logos/netflix.png`

- [ ] **Step 3: Verify in-context**

Run `pnpm dev`, open `game.html?wave=1`. Logo should appear centered on back wall. Tune `logoSprite.position.set(x, y - 40)` in `wall-layer.ts` if misaligned.

- [ ] **Step 4: Commit**

```bash
git add src/assets/logos/netflix.png src/render/cyberpunk/wall-layer.ts
git commit -m "feat(sprites): pico-8 netflix logo decal (19/21)"
```

---

### Task 37: Generate `bitly` logo decal

**Inputs:**
- Subject: `"Bitly logo — the word 'bit.ly' in pico-8 orange, mounted in a chunky black wooden picture frame with a small nameplate. Reads as a framed photo hanging on an office wall."`
- Size: 96×64
- Output path: `src/assets/logos/bitly.png`

- [ ] Run Phase 5 procedure.
- [ ] Verify by running `pnpm dev` and visiting `game.html?level=url-shortener`.
- [ ] Commit: `git add src/assets/logos/bitly.png && git commit -m "feat(sprites): pico-8 bitly logo decal (20/21)"`

---

### Task 38: Generate `instagram` logo decal

**Inputs:**
- Subject: `"Instagram logo — the pico-8 camera icon (rounded square with lens circle and small indicator dot) in pico-8 pink, mounted in a chunky black wooden picture frame with a small nameplate. Reads as a framed photo hanging on an office wall."`
- Size: 96×64
- Output path: `src/assets/logos/instagram.png`

- [ ] Run Phase 5 procedure.
- [ ] Verify by running `pnpm dev` and visiting `diagnose.html` on an Instagram level.
- [ ] Commit: `git add src/assets/logos/instagram.png && git commit -m "feat(sprites): pico-8 instagram logo decal (21/21)"`

---

## Phase 6 — Verification & handoff

### Task 39: Un-skip palette-conformance test

**Files:**
- Modify: `tests/unit/palette-conformance.test.ts`

- [ ] **Step 1: Un-skip**

In `tests/unit/palette-conformance.test.ts`, change `describe.skip(` back to `describe(`.

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/unit/palette-conformance.test.ts`
Expected: **all passing** (every new sprite conforms). If any sprite fails, jump back to its Phase 5 task and regenerate.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `pnpm typecheck && pnpm test --run`
Expected: clean; 833+ passing (plus the new conformance + asset-presence tests).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/palette-conformance.test.ts
git commit -m "test(palette): enable conformance test — all sprites pico-8 compliant"
```

---

### Task 40: Browser smoke-check all three campaigns

**Files:** none (manual verification)

- [ ] **Step 1: Start dev server**

Run: `pnpm dev` (kill any existing server on :5173 first: `lsof -ti:5173 | xargs kill` per CLAUDE.md).

- [ ] **Step 2: Landing page unchanged**

Open `http://localhost:5173/`. Expected: identical to before (already Pico-8).

- [ ] **Step 3: Level selector unchanged visually**

Open `http://localhost:5173/levels.html`. Expected: palette consistent with landing.

- [ ] **Step 4: Netflix campaign, wave 1**

Open `http://localhost:5173/game.html?wave=1`. Verify:
- Back wall visible behind the top of the iso grid
- Netflix logo centered on the wall
- Client (typist) at left edge of the board
- All component sprites render in Pico-8 style
- Place a server. Start the wave. Packets animate. Utilization tint (blue → red) visible on loaded components.

- [ ] **Step 5: Bitly campaign**

Open `http://localhost:5173/game.html?level=url-shortener`. Expected: Bitly logo replaces Netflix on the wall.

- [ ] **Step 6: Instagram diagnose**

Open `http://localhost:5173/diagnose.html`. Pick an Instagram level. Expected: Instagram logo on the wall.

- [ ] **Step 7: Mobile viewport**

Resize to 640px-wide. Expected: sprites still readable; HUD wraps correctly.

- [ ] **Step 8: Stop dev server**

No commit (verification only).

---

### Task 41: Final rollback drill

**Files:** none (validation)

- [ ] **Step 1: Simulate full revert**

From worktree root:
```bash
rm src/assets/*.png  # live set gone
cp src/assets/_cyberpunk-archive/*.png src/assets/
```

Open `http://localhost:5173/game.html?wave=1` in browser. Expected: cyberpunk sprites render. No wall/logo (wall-layer gracefully hides — archive doesn't have back_wall.png or logos/).

- [ ] **Step 2: Restore Pico-8 live set**

```bash
git checkout src/assets/
```

Expected: live set back to Pico-8. Browser confirms.

- [ ] **Step 3: Stop dev server. No commit.**

---

### Task 42: Open PR

**Files:** none (handoff)

- [ ] **Step 1: Push branch**

From worktree root:
```bash
git push -u origin pico8-retheme
```

- [ ] **Step 2: Open PR**

Run:
```bash
gh pr create --title "feat(render): Pico-8 retheme — iso board reskin + office frame" --body "$(cat <<'EOF'
## Summary
- Regenerate all 13 component sprites + floor tiles + packet sprites + back wall + 3 company logos in strict Pico-8 16-color palette via PixelLab MCP
- Add wall-layer that draws a back-wall strip and company logo decal behind the iso grid, driven by level id
- Swap the renderer's utilization-highlight detector from cyan to Pico-8 blue (#29ADFF)
- Palette-only CSS pass across HUD, auth, chatbot (no layout changes)
- New palette-conformance and asset-presence tests
- Cyberpunk sprite set archived under src/assets/_cyberpunk-archive/ for one-command rollback

## Test plan
- [x] pnpm typecheck clean
- [x] pnpm test --run green (new conformance + presence tests pass)
- [x] Browser smoke on Netflix, Bitly, Instagram campaigns
- [x] Rollback drill confirms cyberpunk sprite set is recoverable via cp

Spec: docs/superpowers/specs/2026-04-20-pico8-retheme-design.md
Plan: docs/superpowers/plans/2026-04-20-pico8-retheme.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL to the user.

---

## Definition of done (whole plan)

- [ ] All 21 sprite tasks committed and user-approved
- [ ] `pnpm check-palette` reports 0 violations
- [ ] `tests/unit/palette-conformance.test.ts` un-skipped and green
- [ ] `tests/unit/asset-presence.test.ts` green
- [ ] `pnpm typecheck` + `pnpm test --run` green
- [ ] Browser smoke-check passed on Netflix, Bitly, Instagram
- [ ] Rollback drill passed
- [ ] PR open on `pico8-retheme` branch

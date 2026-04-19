# Stack Attack — Rename, Level Roster, and Pico-8 UI Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the game from BrainLift to Stack Attack across the codebase, turn the level-select surface into two playable cards (URL Shortener + Build Netflix) that both point at today's campaign, and redesign `src/index.html` and `src/levels.html` in a Pico-8 arcade aesthetic with a generated PixelLab client sprite.

**Architecture:** Four isolated tracks touching disjoint files — a rename sweep (text-only edits to 7 files + a file move), a sprite asset copy (4 tiny PNGs into `src/assets/stack-attack/`), a trivial URL-param reader added to `src/physics-td/physics-td.ts` (a no-op hook the teammate will pivot on later), and two full HTML rewrites. No runtime logic changes in `src/physics-td/` beyond reading one query-string value.

**Tech Stack:** Vite + Pixi (Pixi untouched this pass), TypeScript, vitest for unit tests, pure CSS + Google Fonts (`Press Start 2P`, `VT323`) for the UI redesign. No new dependencies.

**Spec reference:** [`docs/superpowers/specs/2026-04-19-stack-attack-rename-and-ui-pass-design.md`](../specs/2026-04-19-stack-attack-rename-and-ui-pass-design.md)

---

## File Structure

**Created (5 files):**
- `src/assets/stack-attack/client-south.png` — PixelLab client sprite, south-facing, 68×68
- `src/assets/stack-attack/client-east.png` — east-facing, 68×68
- `src/assets/stack-attack/client-north.png` — north-facing, 68×68
- `src/assets/stack-attack/client-west.png` — west-facing, 68×68
- `tests/unit/level-id-param.test.ts` — unit test for the new `?level=` URL param reader

**Modified (text content only, no logic changes):**
- `CLAUDE.md` — rename heading
- `README.md` — rename heading + body mentions + URL
- `docs/claude/game-design.md` — rename body mentions
- `src/game.html` — `<title>` tag

**Replaced (full rewrite):**
- `src/index.html` — Pico-8 landing page
- `src/levels.html` — Pico-8 level select with two cards

**Modified with added logic:**
- `src/physics-td/physics-td.ts` — add a `readLevelIdFromUrl()` export and call it at boot

**Moved:**
- `brainlift-system-architecture-game.md` → `archive/stack-attack-concept.md` (title line inside updated)

---

## Task 1: Create and switch to a dedicated worktree

Per project policy in `CLAUDE.md`, all code changes happen in a project-local worktree at `.worktrees/<branch-name>`. Do this first; every subsequent task commits inside the worktree.

**Files:**
- Create (outside worktree): `.worktrees/stack-attack-ui-pass/` git worktree

- [ ] **Step 1: Confirm you are on `main` and caught up**

Run from repo root:
```bash
cd /Users/normanettedgui/development/capstone
git fetch origin
git status
git rev-list --count HEAD..origin/main
```
Expected: clean working tree (the untracked `.DS_Store`, `.~lock`, `brainlift-tam-analysis.xlsx`, and `sr.mov` are fine; they will not move into the worktree). `rev-list` should print `0`. If nonzero, stop and rebase before continuing.

- [ ] **Step 2: Create the worktree and branch**

Run:
```bash
git worktree add .worktrees/stack-attack-ui-pass -b stack-attack-ui-pass
cd .worktrees/stack-attack-ui-pass
```
Expected: new directory exists; you are now inside it. All subsequent `pwd` should print a path ending in `.worktrees/stack-attack-ui-pass`.

- [ ] **Step 3: Link node_modules**

The project uses a symlink convention so the worktree shares the parent's installed packages (per `docs/claude/worktree-gotchas.md`).
```bash
ln -s ../../node_modules node_modules
ls -la node_modules
```
Expected: `node_modules -> ../../node_modules` symlink.

- [ ] **Step 4: Verify toolchain is green on the worktree**

```bash
pnpm typecheck
pnpm test
```
Expected: typecheck produces only the single pre-existing noise line documented in `CLAUDE.md` (`tests/unit/pull-from-buffers.test.ts:81` `requestsPerTick`); tests report 613 passing. If baseline is not green, fix before editing anything.

---

## Task 2: Rename — BrainLift → Stack Attack

Seven files plus one file move. No code logic changes. Commit as a single atomic rename.

**Files:**
- Modify: `CLAUDE.md:1`
- Modify: `README.md:1`, `README.md:5`, `README.md:13`, `README.md:15`
- Modify: `docs/claude/game-design.md:30`
- Modify: `src/game.html:6`
- Move: `brainlift-system-architecture-game.md` → `archive/stack-attack-concept.md`
- Modify (inside moved file): `archive/stack-attack-concept.md:1`
- Modify (referenced from `game-design.md`): update the filename reference after the move

- [ ] **Step 1: Update `CLAUDE.md` heading**

Edit `CLAUDE.md` line 1.

Old:
```markdown
# BrainLift: System Architecture Tower Defense Game
```
New:
```markdown
# Stack Attack: System Architecture Tower Defense Game
```

- [ ] **Step 2: Update `README.md` — four lines**

Edit `README.md`:

Line 1 — `# BrainLift: System Architecture Tower Defense Game` → `# Stack Attack: System Architecture Tower Defense Game`

Line 5 — `**Public URL:** *https://brainlift.app* (tentative -- not yet deployed)` → `**Public URL:** *https://stackattack.app* (tentative -- not yet deployed)`

Line 13 — replace the sentence-initial `BrainLift is a strategy game` with `Stack Attack is a strategy game`; leave the rest of the paragraph intact.

Line 15 — replace `BrainLift does the same for system architecture.` with `Stack Attack does the same for system architecture.`; leave the rest of the paragraph intact.

- [ ] **Step 3: Update `docs/claude/game-design.md`**

Line 30 currently reads:
```markdown
- **`brainlift-system-architecture-game.md`** — purpose, SPOVs, research insights, market analysis, design theory.
```
Replace with:
```markdown
- **`archive/stack-attack-concept.md`** — purpose, SPOVs, research insights, market analysis, design theory.
```

- [ ] **Step 4: Update `src/game.html`**

Line 6 currently reads:
```html
  <title>BrainLift — Physics TD</title>
```
Replace with:
```html
  <title>Stack Attack — Physics TD</title>
```

- [ ] **Step 5: Move research doc into `archive/`**

```bash
git mv brainlift-system-architecture-game.md archive/stack-attack-concept.md
```
Expected: git staging records the rename. `ls archive/ | grep stack-attack-concept.md` prints the filename.

- [ ] **Step 6: Update the moved file's heading**

Open `archive/stack-attack-concept.md`. Line 1 currently reads:
```markdown
# BrainLift: System Architecture Tower Defense Game
```
Replace with:
```markdown
# Stack Attack: System Architecture Tower Defense Game (concept — archived research)
```

- [ ] **Step 7: Verify nothing else mentions BrainLift in tracked files**

Run from worktree root:
```bash
rg -i --hidden --glob '!.git' --glob '!node_modules' --glob '!.superpowers' --glob '!brainlift-tam-analysis.xlsx' 'brainlift'
```
Expected: **zero matches.** The untracked `brainlift-tam-analysis.xlsx` is not in the repo and is excluded. Old commit messages inside `.git` history still mention BrainLift — do not rewrite history.

If any match appears in a tracked file, stop and fix it before committing.

- [ ] **Step 8: Run typecheck and tests**

```bash
pnpm typecheck
pnpm test
```
Expected: typecheck unchanged (same single pre-existing noise line); 613 tests pass. The rename touches only Markdown + one `<title>` tag, so nothing should move.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md README.md docs/claude/game-design.md src/game.html archive/stack-attack-concept.md
git commit -m "chore(rename): BrainLift → Stack Attack across docs + UI title"
```

---

## Task 3: Copy PixelLab client sprite assets into the repo

Four tiny PNGs (68×68, ~5 KB combined) generated by the PixelLab MCP during brainstorming. They already live at `.superpowers/brainstorm/96156-1776622820/content/sprites/`. We copy them into a new directory so Vite picks them up from the build root (`src/`).

**Files:**
- Create: `src/assets/stack-attack/client-south.png`
- Create: `src/assets/stack-attack/client-east.png`
- Create: `src/assets/stack-attack/client-north.png`
- Create: `src/assets/stack-attack/client-west.png`

- [ ] **Step 1: Create the destination directory**

```bash
mkdir -p src/assets/stack-attack
```

- [ ] **Step 2: Copy the four sprite files**

```bash
cp ../../.superpowers/brainstorm/96156-1776622820/content/sprites/client-south.png src/assets/stack-attack/client-south.png
cp ../../.superpowers/brainstorm/96156-1776622820/content/sprites/client-east.png  src/assets/stack-attack/client-east.png
cp ../../.superpowers/brainstorm/96156-1776622820/content/sprites/client-north.png src/assets/stack-attack/client-north.png
cp ../../.superpowers/brainstorm/96156-1776622820/content/sprites/client-west.png  src/assets/stack-attack/client-west.png
```

Note: the worktree lives at `.worktrees/stack-attack-ui-pass/`, so `../../.superpowers/...` reaches back to the main project root.

- [ ] **Step 3: Verify file sizes and dimensions**

```bash
ls -la src/assets/stack-attack/
file src/assets/stack-attack/client-south.png
```
Expected: four files, each 800–1500 bytes, PNG 68×68.

If `file` isn't available, skip; size alone confirms the copy.

- [ ] **Step 4: Commit**

```bash
git add src/assets/stack-attack/
git commit -m "feat(assets): add Stack Attack client sprites (PixelLab, 4 rotations)

Generated via pixellab MCP, character id 168439bb-b390-4edc-bb29-ffe803799bcc.
68x68 transparent PNGs for the landing + level-select UI."
```

---

## Task 4: Add `?level=` URL param reader — TDD

Small additive change: export a pure function that parses a level id out of a `location.search` string, store it on a `window.__stackAttackLevelId` marker at boot. Current campaign code path is unchanged — the teammate will later branch on this value.

**Files:**
- Modify: `src/physics-td/physics-td.ts` — add exported `readLevelIdFromUrl` and one boot-time call
- Test: `tests/unit/level-id-param.test.ts` — new

### TDD cycle

- [ ] **Step 1: Write the failing test**

Create `tests/unit/level-id-param.test.ts` with the exact content:

```typescript
import { describe, expect, it } from "vitest";
import { readLevelIdFromUrl } from "../../src/physics-td/physics-td";

describe("readLevelIdFromUrl", () => {
  it("returns 'url-shortener' when ?level=url-shortener", () => {
    expect(readLevelIdFromUrl("?level=url-shortener")).toBe("url-shortener");
  });

  it("returns 'netflix' when ?level=netflix", () => {
    expect(readLevelIdFromUrl("?level=netflix")).toBe("netflix");
  });

  it("returns null when the param is missing", () => {
    expect(readLevelIdFromUrl("")).toBeNull();
    expect(readLevelIdFromUrl("?wave=3")).toBeNull();
  });

  it("returns null for unknown level ids", () => {
    expect(readLevelIdFromUrl("?level=bogus")).toBeNull();
    expect(readLevelIdFromUrl("?level=")).toBeNull();
  });

  it("ignores casing on the value", () => {
    expect(readLevelIdFromUrl("?level=URL-SHORTENER")).toBe("url-shortener");
    expect(readLevelIdFromUrl("?level=Netflix")).toBe("netflix");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/level-id-param.test.ts
```
Expected: import error / `readLevelIdFromUrl is not a function`. **Do not move on until you see the failure.**

- [ ] **Step 3: Implement `readLevelIdFromUrl` in `physics-td.ts`**

Open `src/physics-td/physics-td.ts`. At the top of the file, after the existing imports and constants block (after the `DRAIN_SECONDS` constant, before the rest of the module body), add:

```typescript
export type StackAttackLevelId = "url-shortener" | "netflix";

const KNOWN_LEVEL_IDS: ReadonlySet<string> = new Set([
  "url-shortener",
  "netflix",
]);

/**
 * Parse ?level=… out of a URL query string. Exported for testability.
 * Returns the normalized (lowercased) level id, or null when the param
 * is missing, empty, or not in the known set. The teammate owning game
 * balance will branch on this value when the two campaigns diverge.
 */
export function readLevelIdFromUrl(search: string): StackAttackLevelId | null {
  const raw = new URLSearchParams(search).get("level");
  if (raw === null) return null;
  const normalized = raw.toLowerCase();
  return KNOWN_LEVEL_IDS.has(normalized)
    ? (normalized as StackAttackLevelId)
    : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/unit/level-id-param.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Wire the reader at boot so the value is observable**

Still in `src/physics-td/physics-td.ts`, find the existing URL param handling at around line 199-200:

```typescript
    // Honor ?wave=N on URL (1-indexed for human friendliness).
    const urlWaveParam = new URLSearchParams(window.location.search).get("wave");
```

Immediately **above** that block (so level id is captured first), add:

```typescript
    // Capture ?level= so the teammate can branch on it when the URL Shortener
    // and Netflix campaigns diverge. Currently a read-only observable marker.
    const levelId = readLevelIdFromUrl(window.location.search);
    (window as unknown as { __stackAttackLevelId: StackAttackLevelId | null }).__stackAttackLevelId = levelId;
```

- [ ] **Step 6: Run the full suite**

```bash
pnpm typecheck
pnpm test
```
Expected: typecheck still has only the one pre-existing noise line; 618 tests pass (613 + 5 new).

- [ ] **Step 7: Commit**

```bash
git add src/physics-td/physics-td.ts tests/unit/level-id-param.test.ts
git commit -m "feat(physics-td): read ?level= URL param as a no-op marker

Exports readLevelIdFromUrl and stores the result on window.__stackAttackLevelId
at boot. Current campaign selection is unchanged — this is a handoff seam for
the teammate to branch on when URL Shortener and Netflix campaigns diverge."
```

---

## Task 5: Redesign `src/index.html` (landing page)

Replace the entire file. Implementation matches the approved mockup at `.superpowers/brainstorm/96156-1776622820/content/pico-with-sprite.html`, trimmed to the final scope from the spec (no `2P-READY` text, speech bubble stays `GET /api/me`, portrait logic moves to levels page).

**Files:**
- Replace: `src/index.html`

- [ ] **Step 1: Replace `src/index.html` with the full document below**

Overwrite the entire file. This is the complete, final contents:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stack Attack</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link
    href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap"
    rel="stylesheet">
  <style>
    :root {
      --pi-bg-2:    #1d2b53;
      --pi-bg-3:    #3a3a8a;
      --pi-cream:   #fff1e8;
      --pi-yellow:  #ffec27;
      --pi-orange:  #ffa300;
      --pi-pink:    #ff77a8;
      --pi-magenta: #7e2553;
      --pi-cyan:    #29adff;
      --pi-lime:    #00e436;
      --pi-ink:     #000000;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--pi-bg-2);
      color: var(--pi-cream);
      font-family: "Press Start 2P", "Courier New", monospace;
      overflow: hidden;
    }

    .stage {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(circle at 50% 22%, #4a4aa5 0%, transparent 55%),
        var(--pi-bg-2);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 28px 36px;
      overflow: hidden;
    }
    .stars {
      position: absolute; inset: 0; pointer-events: none;
      background-image:
        radial-gradient(1px 1px at 8% 18%,  var(--pi-cream), transparent 100%),
        radial-gradient(1px 1px at 24% 8%,  var(--pi-yellow), transparent 100%),
        radial-gradient(2px 2px at 38% 30%, var(--pi-cream), transparent 100%),
        radial-gradient(1px 1px at 65% 14%, var(--pi-cyan),  transparent 100%),
        radial-gradient(1px 1px at 82% 24%, var(--pi-cream), transparent 100%),
        radial-gradient(1px 1px at 92% 44%, var(--pi-pink),  transparent 100%),
        radial-gradient(1px 1px at 14% 72%, var(--pi-cream), transparent 100%),
        radial-gradient(2px 2px at 72% 62%, var(--pi-yellow), transparent 100%);
    }
    .scanlines {
      position: absolute; inset: 0; pointer-events: none;
      background: repeating-linear-gradient(
        0deg,
        rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 1px,
        transparent 1px, transparent 4px);
    }

    .hud {
      position: relative; z-index: 5;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 10px;
      letter-spacing: 0.1em;
    }
    .hud .coin  { color: var(--pi-yellow); }
    .hud .hp    { color: var(--pi-pink); letter-spacing: 0.3em; }
    .hud .live  { color: var(--pi-lime); }
    .hud .live::before {
      content: "● ";
      animation: blink 1s steps(2) infinite;
    }
    @keyframes blink { 50% { opacity: 0.25; } }

    .title-block {
      position: relative; z-index: 5;
      margin-top: 4vh;
    }
    .wordmark {
      font-family: "Press Start 2P", monospace;
      font-size: clamp(36px, 9vw, 96px);
      line-height: 1;
      color: var(--pi-yellow);
      letter-spacing: 0.02em;
      text-shadow:
        4px 4px 0 var(--pi-pink),
        8px 8px 0 var(--pi-magenta),
        11px 11px 0 var(--pi-ink);
      margin: 0;
    }
    .wordmark em {
      color: var(--pi-cyan);
      font-style: normal;
    }
    .tagline {
      font-size: 11px;
      color: var(--pi-cyan);
      margin-top: 22px;
      letter-spacing: 0.28em;
    }
    .tagline::before { content: "▸ "; color: var(--pi-orange); }

    .cta-row {
      position: relative; z-index: 5;
      display: flex;
      align-items: center;
      gap: 22px;
      margin-top: 28px;
    }
    .cta {
      font-family: "Press Start 2P", monospace;
      font-size: 14px;
      padding: 16px 28px;
      background: var(--pi-orange);
      color: var(--pi-bg-2);
      letter-spacing: 0.1em;
      text-decoration: none;
      box-shadow:
        5px 5px 0 var(--pi-magenta),
        inset 0 0 0 3px var(--pi-cream);
      animation: cta-pulse 1.4s steps(2) infinite;
    }
    .cta:focus-visible {
      outline: 3px solid var(--pi-yellow);
      outline-offset: 4px;
    }
    @keyframes cta-pulse { 50% { filter: brightness(1.15) saturate(1.1); } }
    .cta-hint {
      font-family: "VT323", monospace;
      font-size: 20px;
      color: var(--pi-cream);
      opacity: 0.7;
      letter-spacing: 0.04em;
    }

    .ground {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: 28%;
      z-index: 2;
      background:
        linear-gradient(180deg, transparent 0, rgba(0,0,0,0.55) 100%),
        repeating-linear-gradient(90deg, #212a5a 0 24px, #1a2150 24px 48px);
      border-top: 2px solid var(--pi-magenta);
      box-shadow: 0 -2px 0 var(--pi-pink), 0 -8px 0 rgba(126, 37, 83, 0.25);
    }

    .queue {
      position: absolute;
      left: 36px; right: 36px; bottom: 36px;
      display: flex;
      align-items: flex-end;
      gap: 16px;
      z-index: 3;
    }
    .queue img {
      display: block;
      width: 108px;
      height: 108px;
    }
    .queue .s1 { animation: bob 1.1s steps(2) infinite;       }
    .queue .s2 { animation: bob 1.1s steps(2) infinite 0.2s;  }
    .queue .s3 { animation: bob 1.1s steps(2) infinite 0.4s;  }
    .queue .s4 {
      margin-left: auto;
      transform: scaleX(-1);
      animation: bob-flip 1.1s steps(2) infinite 0.6s;
    }
    @keyframes bob      { 50% { transform: translateY(-4px); } }
    @keyframes bob-flip {
      0%, 100% { transform: scaleX(-1) translateY(0);    }
      50%      { transform: scaleX(-1) translateY(-4px); }
    }

    .bubble {
      position: absolute;
      left: 78px; bottom: 160px;
      z-index: 4;
      font-family: "VT323", monospace;
      font-size: 20px;
      color: var(--pi-ink);
      background: var(--pi-cream);
      padding: 6px 12px;
      box-shadow: 4px 4px 0 var(--pi-ink);
      letter-spacing: 0.02em;
    }
    .bubble::after {
      content: "";
      position: absolute;
      left: 18px; bottom: -10px;
      width: 0; height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 10px solid var(--pi-cream);
    }

    @media (prefers-reduced-motion: reduce) {
      .hud .live::before,
      .cta,
      .queue .s1, .queue .s2, .queue .s3, .queue .s4 {
        animation: none !important;
      }
    }

    @media (max-width: 640px) {
      .stage { padding: 20px 22px; }
      .queue { gap: 8px; }
      .queue img { width: 72px; height: 72px; }
      .bubble { left: 46px; bottom: 118px; font-size: 16px; }
      .wordmark { text-shadow:
        3px 3px 0 var(--pi-pink),
        6px 6px 0 var(--pi-magenta),
        8px 8px 0 var(--pi-ink);
      }
    }
  </style>
</head>
<body>
  <main class="stage">
    <div class="stars" aria-hidden="true"></div>
    <div class="scanlines" aria-hidden="true"></div>

    <div class="hud">
      <span class="coin">★ 00425</span>
      <span class="hp">♥ ♥ ♥</span>
      <span class="live">ONLINE</span>
    </div>

    <div class="title-block">
      <h1 class="wordmark">STACK<em>//</em><br>ATTACK</h1>
      <p class="tagline">SYSTEM ARCHITECTURE · TOWER DEFENCE</p>
    </div>

    <div class="cta-row">
      <a class="cta" href="./levels.html">▶ INSERT COIN</a>
      <span class="cta-hint">— press play to begin —</span>
    </div>

    <div class="ground" aria-hidden="true"></div>

    <div class="bubble" aria-hidden="true">GET /api/me</div>

    <div class="queue" aria-hidden="true">
      <img class="s1" src="./assets/stack-attack/client-south.png" alt="">
      <img class="s2" src="./assets/stack-attack/client-east.png"  alt="">
      <img class="s3" src="./assets/stack-attack/client-south.png" alt="">
      <img class="s4" src="./assets/stack-attack/client-east.png"  alt="">
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 2: Start the dev server (kill any held port first)**

```bash
lsof -ti:5173 | xargs kill 2>/dev/null || true
pnpm dev
```
Expected: Vite serves on `http://localhost:5173`.

- [ ] **Step 3: Visual check in a browser**

Open `http://localhost:5173/index.html`.

Verify, in this order:
- Wordmark `STACK//ATTACK` renders in yellow with layered pink/magenta/ink shadow, not fallback Courier.
- Scanlines are visible as faint horizontal lines across the whole viewport.
- Four client sprites are walking along the bottom — three left-facing, one right-facing (the flipped one).
- Speech bubble `GET /api/me` sits just above the leftmost sprite.
- `▶ INSERT COIN` button is orange with magenta drop-shadow; clicking it navigates to `/levels.html` (404 is fine this task — levels is redone in Task 6).
- `ONLINE` indicator blinks.

If fonts look like Courier, wait 2-3 seconds for Google Fonts to load, then hard-refresh. If still Courier, check the network tab for the Google Fonts request (must be 200).

- [ ] **Step 4: Reduced-motion check**

In browser devtools → Rendering → emulate `prefers-reduced-motion: reduce`. Verify sprites stop bobbing, `ONLINE` stops blinking, and CTA stops pulsing.

- [ ] **Step 5: Mobile breakpoint check**

Resize the viewport to 375px wide. Verify sprites shrink to 72px and the speech bubble moves with them. Wordmark text-shadow is lighter. No horizontal scroll.

- [ ] **Step 6: Typecheck and tests**

```bash
pnpm typecheck
pnpm test
```
Expected: both clean (HTML-only change shouldn't affect either).

- [ ] **Step 7: Commit**

```bash
git add src/index.html
git commit -m "feat(ui): Pico-8 landing page with PixelLab client sprites

Replaces the scaffold. Wordmark + scanlines + animated sprite queue +
speech bubble. CSS-only animations; honors prefers-reduced-motion.
Responsive down to 375px."
```

---

## Task 6: Redesign `src/levels.html` with two playable level cards

Replace the entire file. Two cards, both `<a>` elements, cyan on indigo, with a 52×52 portrait tile and the Pico-8 chrome established on the landing.

**Files:**
- Replace: `src/levels.html`

- [ ] **Step 1: Replace `src/levels.html` with the full document below**

Overwrite the entire file:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stack Attack — Select Level</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link
    href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap"
    rel="stylesheet">
  <style>
    :root {
      --pi-bg-2:    #1d2b53;
      --pi-bg-3:    #3a3a8a;
      --pi-cream:   #fff1e8;
      --pi-yellow:  #ffec27;
      --pi-orange:  #ffa300;
      --pi-pink:    #ff77a8;
      --pi-magenta: #7e2553;
      --pi-cyan:    #29adff;
      --pi-lime:    #00e436;
      --pi-ink:     #000000;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    html, body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      background: var(--pi-bg-2);
      color: var(--pi-cream);
      font-family: "Press Start 2P", "Courier New", monospace;
    }
    body::after {
      content: "";
      position: fixed; inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        0deg,
        rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 1px,
        transparent 1px, transparent 4px);
    }

    .page {
      position: relative;
      max-width: 960px;
      margin: 0 auto;
      padding: 36px 28px 48px;
    }

    .top {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 10px;
      letter-spacing: 0.22em;
      color: var(--pi-pink);
    }
    .top .back {
      color: var(--pi-cream);
      text-decoration: none;
    }
    .top .back:focus-visible { outline: 3px solid var(--pi-yellow); outline-offset: 3px; }

    h1.title {
      font-family: "Press Start 2P", monospace;
      font-size: clamp(22px, 4.2vw, 36px);
      color: var(--pi-yellow);
      margin: 28px 0 28px;
      text-shadow:
        3px 3px 0 var(--pi-magenta),
        5px 5px 0 var(--pi-ink);
      letter-spacing: 0.06em;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 18px;
    }
    @media (min-width: 720px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }

    .card {
      position: relative;
      display: grid;
      grid-template-columns: 64px 1fr auto;
      gap: 14px;
      align-items: center;
      padding: 18px 20px;
      background: var(--pi-cyan);
      color: var(--pi-bg-2);
      text-decoration: none;
      box-shadow: 5px 5px 0 var(--pi-magenta), inset 0 0 0 3px var(--pi-bg-2);
      transition: transform 80ms steps(2), filter 80ms steps(2);
    }
    .card:hover,
    .card:focus-visible {
      transform: translate(-2px, -2px);
      filter: brightness(1.05);
      outline: none;
    }
    .card:focus-visible { box-shadow: 5px 5px 0 var(--pi-magenta), inset 0 0 0 3px var(--pi-yellow); }
    .card:active { transform: translate(2px, 2px); filter: brightness(0.95); }

    .portrait {
      width: 64px; height: 64px;
      background: var(--pi-cream);
      box-shadow: inset 0 0 0 3px var(--pi-bg-2);
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .portrait img { width: 84px; height: 84px; margin-top: 6px; }

    .meta .num {
      font-size: 10px;
      color: var(--pi-bg-2);
      letter-spacing: 0.05em;
    }
    .meta .name {
      font-size: 14px;
      color: var(--pi-bg-2);
      margin-top: 6px;
      letter-spacing: 0.04em;
    }
    .meta .desc {
      font-family: "VT323", monospace;
      font-size: 18px;
      color: var(--pi-bg-2);
      opacity: 0.9;
      margin-top: 6px;
      letter-spacing: 0.02em;
      line-height: 1.25;
    }
    .meta .record {
      font-family: "VT323", monospace;
      font-size: 15px;
      color: var(--pi-magenta);
      margin-top: 6px;
      letter-spacing: 0.04em;
    }

    .tag {
      font-family: "Press Start 2P", monospace;
      font-size: 11px;
      padding: 8px 12px;
      background: var(--pi-lime);
      color: var(--pi-bg-2);
      box-shadow: 3px 3px 0 var(--pi-bg-2);
      letter-spacing: 0.1em;
    }

    @media (prefers-reduced-motion: reduce) {
      .card,
      .card:hover,
      .card:focus-visible,
      .card:active {
        transition: none !important;
        transform: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <a class="back" href="./index.html">◂ BACK</a>
      <span>WORLD 1-1</span>
    </div>

    <h1 class="title">SELECT LEVEL</h1>

    <nav class="grid" aria-label="Level selection">
      <a class="card" href="./game.html?level=url-shortener">
        <div class="portrait" aria-hidden="true">
          <img src="./assets/stack-attack/client-south.png" alt="">
        </div>
        <div class="meta">
          <div class="num">LV. 01</div>
          <div class="name">URL SHORTENER</div>
          <div class="desc">A tiny service. Reads dwarf writes. Database + cache is enough — if you route it right.</div>
          <div class="record">⭐ no record · target 99.5%</div>
        </div>
        <span class="tag">GO ▸</span>
      </a>

      <a class="card" href="./game.html?level=netflix">
        <div class="portrait" aria-hidden="true">
          <img src="./assets/stack-attack/client-south.png" alt="">
        </div>
        <div class="meta">
          <div class="num">LV. 02</div>
          <div class="name">BUILD NETFLIX</div>
          <div class="desc">Peak-hour streaming. Writes, reads, and viewers all want the same hot keys. Scale before the SLA drops.</div>
          <div class="record">⭐ no record · target 99.5%</div>
        </div>
        <span class="tag">GO ▸</span>
      </a>
    </nav>
  </div>
</body>
</html>
```

- [ ] **Step 2: Visual check in the browser**

Open `http://localhost:5173/levels.html` (dev server should still be running from Task 5; if not: `pnpm dev`).

Verify:
- Two cyan cards on indigo, side-by-side at ≥720px wide, stacked below.
- Each card shows the client sprite inside a cream portrait tile.
- Hover nudges the card up-left by 2px; active pushes it down-right; focus ring is yellow.
- Card copy reads correctly for both LV. 01 (URL Shortener) and LV. 02 (Build Netflix).
- `◂ BACK` link returns to `/index.html`.
- Clicking either card lands on `/game.html?level=url-shortener` or `/game.html?level=netflix` and the game loads normally.

- [ ] **Step 3: Verify `?level=` is captured at runtime**

From the devtools console of the loaded `game.html?level=url-shortener`:
```javascript
window.__stackAttackLevelId
```
Expected: `"url-shortener"`. Reload with `?level=netflix` — expect `"netflix"`. Reload with no param — expect `null`.

- [ ] **Step 4: Reduced-motion check**

Enable `prefers-reduced-motion: reduce`. Hover a card — no transform.

- [ ] **Step 5: Mobile breakpoint check**

Resize to 375px. Cards should stack vertically with full-width layout. No horizontal scroll.

- [ ] **Step 6: Typecheck and tests**

```bash
pnpm typecheck
pnpm test
```
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/levels.html
git commit -m "feat(ui): Pico-8 level select with URL Shortener + Build Netflix cards

Two playable cards, both routing to the current campaign with a
distinguishing ?level= query param that the teammate can branch on
when the campaigns diverge. Hover nudges mirror the CTA button feel
from the landing. Responsive, a11y-labeled, prefers-reduced-motion
honored."
```

---

## Task 7: Build + final verification

Confirms everything still builds, renders, and tests cleanly from a cold state.

- [ ] **Step 1: Stop the dev server if still running**

```bash
lsof -ti:5173 | xargs kill 2>/dev/null || true
```

- [ ] **Step 2: Production build**

```bash
pnpm exec vite build
```
Expected: build succeeds. `dist/` contains `index.html`, `levels.html`, `game.html`, and an `assets/` dir that includes the 4 sprite PNGs (Vite may rename them with a content hash — that's fine). No build warnings about missing assets.

- [ ] **Step 3: Preview the production build**

```bash
pnpm exec vite preview
```
Open the URL Vite prints (typically `http://localhost:4173/`). Walk through landing → level select → game. Verify sprites load (no broken image icons), fonts render, both level cards navigate to `game.html` with the correct `?level=` param.

- [ ] **Step 4: Full suite one more time**

```bash
pnpm typecheck
pnpm test
```
Expected: typecheck single pre-existing noise line; 618 tests pass.

- [ ] **Step 5: Sanity grep for leftover BrainLift**

```bash
rg -i --hidden --glob '!.git' --glob '!node_modules' --glob '!.superpowers' --glob '!brainlift-tam-analysis.xlsx' 'brainlift'
```
Expected: zero matches.

- [ ] **Step 6: Log conclusion in commit history (optional tidy commit)**

If you collected any small fix-up during verification (e.g., a CSS tweak), commit it with a focused message. Otherwise skip this step.

- [ ] **Step 7: Summary for the user**

Report in chat: branch name, list of 4-6 commits made, the three URLs that now work (`/`, `/levels.html`, `/game.html?level=…`), and any follow-ups the verification surfaced. Do **not** push, open a PR, or merge — that's the user's call per `CLAUDE.md`.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Rename 7 files + move research doc | Task 2 |
| `archive/stack-attack-concept.md` path | Task 2, steps 5-6 |
| Leave untracked xlsx alone | Task 2, step 7 (excluded from grep) |
| Two playable levels, both linking to current campaign | Task 6 |
| `?level=url-shortener` / `?level=netflix` routing | Task 4 + Task 6 |
| `window.__stackAttackLevelId` observable marker | Task 4 |
| Unknown level id → null + warning-tolerant | Task 4, tests cover it |
| Sprite assets in `src/assets/stack-attack/` | Task 3 |
| Pico-8 palette via CSS custom properties | Tasks 5, 6 |
| Press Start 2P + VT323 via Google Fonts | Tasks 5, 6 |
| `image-rendering: pixelated` globally | Tasks 5, 6 (`* { ... }` rule) |
| CTA + sprite queue + speech bubble on landing | Task 5 |
| Starfield + scanlines + ground parallax | Task 5 |
| 52px portrait tile on level cards (upsized to 64px for legibility) | Task 6 — intentional +12px bump for legibility; still sprite-secondary |
| Full-card `<a>` click target | Task 6 |
| `prefers-reduced-motion: reduce` honored | Tasks 5, 6 |
| Focus ring on interactive elements | Tasks 5, 6 |
| Responsive at 375/1280/1920 | Tasks 5, 6 + Task 7 preview walk |
| `pnpm typecheck` clean | Every task that touches code, + Task 7 |
| `pnpm test` green (613 → 618) | Task 4 adds 5 tests |
| Vite build produces all three entrypoints | Task 7 |

Single intentional deviation from the spec: portrait tile sized at 64px not 52px. Spec noted the same tradeoff and left it open; 64px keeps the sprite readable without making it dominate the card. Flagged here for transparency.

**Placeholder scan:** None.

**Type consistency:** `StackAttackLevelId` type name matches across Task 4 step 3 and the boot-site call in step 5.

**No-cross-boundary-check:** Nothing in this plan touches `src/core/`, `src/capabilities/`, `src/sim/`, or adds React/Next/Vercel imports anywhere, honoring the project rule called out in `CLAUDE.md`.

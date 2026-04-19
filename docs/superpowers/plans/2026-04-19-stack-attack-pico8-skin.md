# Stack Attack — Pico-8 Reskin (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite every player-facing surface outside the game canvas in a unified Pico-8 arcade aesthetic — landing page, level-select page, login overlay, profile setup, nav bar, user dropdown, leaderboard modal — with the generated PixelLab client sprite anchoring the landing and level cards.

**Architecture:** Three bundles of change. (1) A shared Pico-8 design-token layer (palette, typography, motifs) expressed as CSS custom properties on `:root`, loaded ahead of every other stylesheet. (2) A full rewrite of `src/auth/auth.css` using those tokens, replacing the teammate's original cyberpunk-purple styling everywhere. (3) Fresh `src/index.html` and `src/levels.html` that lean on the same tokens plus the PixelLab sprite assets. The game canvas (`src/game.html`, `src/cyberpunk-hud.css`, `src/physics-td/*`) is untouched this pass.

**Tech Stack:** Vite + TypeScript (unchanged). CSS custom properties, Google Fonts (`Press Start 2P`, `VT323`), one set of 4 PixelLab sprites (68×68 PNG), zero new npm deps, no JS logic changes to the auth module.

**Spec reference:** [`docs/superpowers/specs/2026-04-19-stack-attack-rename-and-ui-pass-design.md`](../specs/2026-04-19-stack-attack-rename-and-ui-pass-design.md) (the Pico-8 direction and palette locked in during brainstorming).

---

## Design tokens (referenced by every task)

All tasks assume these tokens live on `:root` in the rewritten `src/auth/auth.css` (Task 2 sets them). Copy values verbatim — no improvisation.

```
--pi-bg-2:    #1d2b53;   /* indigo base          */
--pi-bg-3:    #3a3a8a;   /* indigo elevated      */
--pi-cream:   #fff1e8;   /* primary light        */
--pi-yellow:  #ffec27;   /* wordmark / accent    */
--pi-orange:  #ffa300;   /* CTA                  */
--pi-pink:    #ff77a8;   /* secondary accent     */
--pi-magenta: #7e2553;   /* shadow depth         */
--pi-cyan:    #29adff;   /* info / level cards   */
--pi-lime:    #00e436;   /* success / OK         */
--pi-red:     #ff004d;   /* danger               */
--pi-ink:     #000000;   /* outline / hard edge  */
```

Typography:
- **Display:** `"Press Start 2P", monospace` — wordmark, buttons, labels, table headers.
- **Body:** `"VT323", monospace` — input values, descriptions, user-visible paragraphs.

Motifs:
- Hard 2-3px solid borders (no rounded corners anywhere; `border-radius: 0`).
- Hard offset drop-shadows (`box-shadow: Xpx Ypx 0 var(--pi-magenta)`) — **no blur**.
- Scanline overlay: `repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 4px)` on dark backdrops.
- `image-rendering: pixelated` globally so PNG sprites scale crisply.
- No `backdrop-filter: blur()` anywhere (breaks the flat pixel aesthetic).

---

## File Structure

**Created:**
- `src/assets/stack-attack/client-south.png`, `client-east.png`, `client-north.png`, `client-west.png` — 4 PixelLab sprites, copied from the brainstorm session (existing PixelLab character id `168439bb-b390-4edc-bb29-ffe803799bcc`).

**Rewritten end-to-end:**
- `src/auth/auth.css` — Pico-8 tokens + every class used by login overlay, profile setup, nav bar, user menu, dropdown, and leaderboard.
- `src/index.html` — landing page.
- `src/levels.html` — level select.

**Untouched:** `src/auth/*.ts`, `src/physics-td/*`, `src/cyberpunk-hud.css`, `src/styles.css`, `src/game.html`, `src/core/*`, `src/sim/*`, `src/capabilities/*`.

---

## Task 1: Worktree + sprite assets

**Files created:**
- `src/assets/stack-attack/client-south.png`
- `src/assets/stack-attack/client-east.png`
- `src/assets/stack-attack/client-north.png`
- `src/assets/stack-attack/client-west.png`

- [ ] **Step 1: Confirm worktree baseline is green**

```bash
cd /Users/normanettedgui/development/capstone/.worktrees/stack-attack-pico8-skin
pnpm typecheck 2>&1 | tail -6
pnpm test 2>&1 | tail -6
```
Expected: typecheck has the 2 pre-existing noise lines (`pull-from-buffers.test.ts:81`, `sim-to-renderer-adapter.test.ts:8`); 703 tests pass + 6 skipped.

- [ ] **Step 2: Copy the 4 sprite files into the repo**

```bash
mkdir -p src/assets/stack-attack
cp ../../.superpowers/brainstorm/96156-1776622820/content/sprites/client-south.png src/assets/stack-attack/
cp ../../.superpowers/brainstorm/96156-1776622820/content/sprites/client-east.png  src/assets/stack-attack/
cp ../../.superpowers/brainstorm/96156-1776622820/content/sprites/client-north.png src/assets/stack-attack/
cp ../../.superpowers/brainstorm/96156-1776622820/content/sprites/client-west.png  src/assets/stack-attack/
ls -la src/assets/stack-attack/
```
Expected: 4 files, each 800–1500 bytes.

- [ ] **Step 3: Commit**

```bash
git add src/assets/stack-attack/
git commit -m "feat(assets): add Stack Attack client sprites (PixelLab, 4 rotations)

Chibi pixel-art character generated via pixellab MCP, character id
168439bb-b390-4edc-bb29-ffe803799bcc. 68x68 transparent PNGs anchor
the Pico-8 landing + level-select visuals."
```

---

## Task 2: Rewrite `src/auth/auth.css` — tokens + login overlay

**Files rewritten:** `src/auth/auth.css` (entire file; this task writes the tokens, global font imports, base rules, and the login-overlay section).

The file is rewritten across Tasks 2–5. Each task appends its section to the emerging file. Starting fresh makes the final state easier to review.

- [ ] **Step 1: Replace `src/auth/auth.css` with the base + login-overlay block below**

Overwrite the entire file. Tasks 3–5 will append to it.

```css
/* ══════════════════════════════════════════════════════════════════════
   Stack Attack — Pico-8 arcade skin
   Player-facing chrome outside the game canvas. Game-side HUD and
   component sprites are styled separately (cyberpunk-hud.css, Pixi).
   ══════════════════════════════════════════════════════════════════════ */

@import url("https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap");

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
  --pi-red:     #ff004d;
  --pi-ink:     #000000;

  --pi-font-display: "Press Start 2P", "Courier New", monospace;
  --pi-font-body:    "VT323", "Courier New", monospace;
}

/* Crisp pixel rendering for every sprite on every page */
.sa-login-overlay *,
.sa-profile-setup-overlay *,
.sa-nav-bar *,
.sa-leaderboard-overlay * {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

@keyframes sa-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes sa-blink   { 50% { opacity: 0.35; } }

/* ─── Login overlay ──────────────────────────────────────────────── */
.sa-login-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    repeating-linear-gradient(0deg,
      rgba(0, 0, 0, 0.18) 0, rgba(0, 0, 0, 0.18) 1px,
      transparent 1px, transparent 4px),
    var(--pi-bg-2);
  animation: sa-fade-in 0.2s steps(4);
  padding: 24px;
}

.sa-login-card {
  position: relative;
  background: var(--pi-bg-3);
  color: var(--pi-cream);
  border: 3px solid var(--pi-ink);
  padding: 36px 32px 28px;
  box-shadow: 8px 8px 0 var(--pi-magenta), 8px 8px 0 3px var(--pi-ink);
  max-width: 440px;
  width: 100%;
  text-align: center;
}

.sa-login-logo {
  margin: 0 auto 12px;
  width: 56px;
  height: 56px;
}

.sa-login-title {
  font-family: var(--pi-font-display);
  font-size: 22px;
  color: var(--pi-yellow);
  margin: 0 0 10px;
  letter-spacing: 0.04em;
  text-shadow:
    2px 2px 0 var(--pi-pink),
    4px 4px 0 var(--pi-magenta),
    5px 5px 0 var(--pi-ink);
}

.sa-login-tagline {
  font-family: var(--pi-font-body);
  font-size: 17px;
  color: var(--pi-cyan);
  margin: 0 0 28px;
  letter-spacing: 0.04em;
}

.sa-login-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 22px;
  font-family: var(--pi-font-display);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--pi-bg-2);
  background: var(--pi-orange);
  border: 3px solid var(--pi-ink);
  box-shadow: 4px 4px 0 var(--pi-magenta);
  cursor: pointer;
  transition: transform 80ms steps(2), filter 80ms steps(2);
}

.sa-login-btn:hover {
  transform: translate(-2px, -2px);
  filter: brightness(1.1);
}

.sa-login-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 var(--pi-magenta);
}

.sa-login-btn:focus-visible {
  outline: 3px solid var(--pi-yellow);
  outline-offset: 3px;
}

.sa-login-footer {
  font-family: var(--pi-font-body);
  font-size: 15px;
  color: var(--pi-pink);
  margin: 22px 0 0;
  letter-spacing: 0.03em;
  font-style: normal;
}
```

- [ ] **Step 2: Smoke-check in the dev server**

```bash
lsof -ti:5173 2>/dev/null | xargs kill 2>/dev/null; sleep 1
pnpm exec vite --port 5173 &
```

Open `http://localhost:5173/` (signed-out). You should see the Pico-8 overlay: indigo scanline backdrop, cream card with hard magenta drop-shadow, yellow Press Start 2P `STACK ATTACK` title with triple-layer shadow, cyan `VT323` tagline, orange `Sign in with Google` button with chunky ink border + magenta shadow. No blur, no rounded corners. Hover on the button nudges it up-left by 2px with a brightness pop.

- [ ] **Step 3: Commit**

```bash
git add src/auth/auth.css
git commit -m "feat(ui): Pico-8 auth skin — tokens + login overlay

Rewrites auth.css from scratch against the Pico-8 palette. This
commit covers design tokens (palette, fonts, motifs), global sprite
crispness, and the login overlay. Profile setup, nav bar, and
leaderboard follow in subsequent commits."
```

---

## Task 3: auth.css — profile setup

**Files modified:** `src/auth/auth.css` (append the profile-setup block).

- [ ] **Step 1: Append the profile-setup block to `src/auth/auth.css`**

Append this block to the end of the file:

```css
/* ─── Profile setup ──────────────────────────────────────────────── */
.sa-profile-setup-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    repeating-linear-gradient(0deg,
      rgba(0, 0, 0, 0.18) 0, rgba(0, 0, 0, 0.18) 1px,
      transparent 1px, transparent 4px),
    var(--pi-bg-2);
  animation: sa-fade-in 0.2s steps(4);
  padding: 24px;
}

.sa-profile-card {
  background: var(--pi-bg-3);
  color: var(--pi-cream);
  border: 3px solid var(--pi-ink);
  padding: 32px 28px 28px;
  box-shadow: 8px 8px 0 var(--pi-magenta), 8px 8px 0 3px var(--pi-ink);
  max-width: 520px;
  width: 100%;
}

.sa-profile-title {
  font-family: var(--pi-font-display);
  font-size: 16px;
  color: var(--pi-yellow);
  margin: 0 0 6px;
  letter-spacing: 0.04em;
  text-shadow: 2px 2px 0 var(--pi-magenta), 3px 3px 0 var(--pi-ink);
}

.sa-profile-subtitle {
  font-family: var(--pi-font-body);
  font-size: 17px;
  color: var(--pi-cyan);
  margin: 0 0 22px;
  letter-spacing: 0.03em;
}

.sa-profile-label {
  display: block;
  font-family: var(--pi-font-display);
  font-size: 9px;
  color: var(--pi-pink);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  margin-bottom: 8px;
}

.sa-profile-input {
  display: block;
  width: 100%;
  padding: 10px 12px;
  font-family: var(--pi-font-body);
  font-size: 18px;
  color: var(--pi-bg-2);
  background: var(--pi-cream);
  border: 3px solid var(--pi-ink);
  box-shadow: inset 2px 2px 0 rgba(0, 0, 0, 0.15);
  margin-bottom: 22px;
  outline: none;
  box-sizing: border-box;
  letter-spacing: 0.02em;
}

.sa-profile-input:focus {
  box-shadow: inset 2px 2px 0 rgba(0, 0, 0, 0.15), 0 0 0 3px var(--pi-yellow);
}

.sa-avatar-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 26px;
}

.sa-avatar-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  background: var(--pi-bg-2);
  border: 3px solid var(--pi-ink);
  box-shadow: 3px 3px 0 var(--pi-magenta);
  cursor: pointer;
  transition: transform 80ms steps(2), filter 80ms steps(2);
  color: var(--pi-cream);
}

.sa-avatar-btn:hover {
  transform: translate(-2px, -2px);
  filter: brightness(1.1);
}

.sa-avatar-btn.selected {
  background: var(--pi-cyan);
  color: var(--pi-bg-2);
  box-shadow: 3px 3px 0 var(--pi-yellow);
}

.sa-avatar-btn:focus-visible {
  outline: 3px solid var(--pi-yellow);
  outline-offset: 3px;
}

.sa-avatar-label {
  font-family: var(--pi-font-display);
  font-size: 8px;
  color: inherit;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sa-profile-save-btn {
  display: block;
  width: 100%;
  padding: 14px;
  font-family: var(--pi-font-display);
  font-size: 12px;
  color: var(--pi-bg-2);
  background: var(--pi-lime);
  border: 3px solid var(--pi-ink);
  box-shadow: 5px 5px 0 var(--pi-magenta);
  cursor: pointer;
  letter-spacing: 0.16em;
  transition: transform 80ms steps(2), filter 80ms steps(2);
}

.sa-profile-save-btn:hover {
  transform: translate(-2px, -2px);
  filter: brightness(1.1);
}

.sa-profile-save-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 var(--pi-magenta);
}

.sa-profile-save-btn:focus-visible {
  outline: 3px solid var(--pi-yellow);
  outline-offset: 3px;
}
```

- [ ] **Step 2: Visual check**

In the dev server, sign in with Google as a **new** user (or delete your row from the `profiles` Supabase table first to retrigger setup). Verify the profile card matches the login overlay in motif: indigo panel with cream text, cream Pico-8 input field, 6-tile avatar grid with cyan selected state + yellow shadow, lime `DEPLOY PROFILE` save button with hard magenta shadow.

- [ ] **Step 3: Commit**

```bash
git add src/auth/auth.css
git commit -m "feat(ui): Pico-8 auth skin — profile setup"
```

---

## Task 4: auth.css — nav bar + user menu + dropdown

**Files modified:** `src/auth/auth.css` (append).

- [ ] **Step 1: Append the nav-bar block to `src/auth/auth.css`**

```css
/* ─── Nav bar ────────────────────────────────────────────────────── */
.sa-nav-bar {
  position: fixed;
  top: 14px;
  right: 16px;
  z-index: 9000;
  display: flex;
  align-items: center;
  gap: 10px;
}

.sa-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-family: var(--pi-font-display);
  font-size: 9px;
  color: var(--pi-bg-2);
  background: var(--pi-yellow);
  border: 3px solid var(--pi-ink);
  box-shadow: 3px 3px 0 var(--pi-magenta);
  cursor: pointer;
  letter-spacing: 0.14em;
  transition: transform 80ms steps(2), filter 80ms steps(2);
}

.sa-nav-btn:hover {
  transform: translate(-2px, -2px);
  filter: brightness(1.1);
}

.sa-nav-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 var(--pi-magenta);
}

.sa-nav-btn:focus-visible {
  outline: 3px solid var(--pi-cyan);
  outline-offset: 3px;
}

.sa-user-menu { position: relative; }

.sa-user-menu-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 4px;
  background: var(--pi-cream);
  color: var(--pi-bg-2);
  border: 3px solid var(--pi-ink);
  box-shadow: 3px 3px 0 var(--pi-magenta);
  cursor: pointer;
  transition: transform 80ms steps(2), filter 80ms steps(2);
}

.sa-user-menu-trigger:hover {
  transform: translate(-2px, -2px);
  filter: brightness(1.05);
}

.sa-user-menu-trigger:focus-visible {
  outline: 3px solid var(--pi-cyan);
  outline-offset: 3px;
}

.sa-user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-family: var(--pi-font-display);
  font-size: 8px;
  color: var(--pi-bg-2);
  border: 2px solid var(--pi-ink);
}

.sa-user-name {
  font-family: var(--pi-font-display);
  font-size: 9px;
  color: var(--pi-bg-2);
  letter-spacing: 0.08em;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sa-user-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 180px;
  background: var(--pi-bg-3);
  border: 3px solid var(--pi-ink);
  box-shadow: 4px 4px 0 var(--pi-magenta);
  overflow: hidden;
  z-index: 100;
}

.sa-dropdown-item {
  display: block;
  width: 100%;
  padding: 12px 14px;
  font-family: var(--pi-font-display);
  font-size: 9px;
  color: var(--pi-cream);
  background: transparent;
  border: none;
  border-bottom: 2px solid var(--pi-ink);
  text-align: left;
  cursor: pointer;
  letter-spacing: 0.12em;
  transition: background 80ms steps(2), color 80ms steps(2);
}

.sa-dropdown-item:last-child { border-bottom: none; }

.sa-dropdown-item:hover {
  background: var(--pi-cyan);
  color: var(--pi-bg-2);
}

.sa-dropdown-danger { color: var(--pi-red); }
.sa-dropdown-danger:hover {
  background: var(--pi-red);
  color: var(--pi-cream);
}
```

- [ ] **Step 2: Visual check**

Signed in, verify the top-right nav on every page (`/`, `/levels.html`, `/game.html`):
- Yellow `Leaderboard` button with black border + magenta drop-shadow.
- Cream user chip showing avatar tile + display name in Press Start 2P.
- Click the chip → indigo dropdown with Edit Profile / Sign Out; hover cycles to cyan bg (normal) or red (danger).
- All buttons nudge on hover/active.

- [ ] **Step 3: Commit**

```bash
git add src/auth/auth.css
git commit -m "feat(ui): Pico-8 auth skin — nav bar + user menu"
```

---

## Task 5: auth.css — leaderboard modal

**Files modified:** `src/auth/auth.css` (append).

- [ ] **Step 1: Append the leaderboard block to `src/auth/auth.css`**

```css
/* ─── Leaderboard ────────────────────────────────────────────────── */
.sa-leaderboard-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    repeating-linear-gradient(0deg,
      rgba(0, 0, 0, 0.22) 0, rgba(0, 0, 0, 0.22) 1px,
      transparent 1px, transparent 4px),
    rgba(29, 43, 83, 0.94);
  animation: sa-fade-in 0.15s steps(4);
  padding: 24px;
}

.sa-leaderboard-panel {
  position: relative;
  background: var(--pi-bg-3);
  color: var(--pi-cream);
  border: 3px solid var(--pi-ink);
  box-shadow: 8px 8px 0 var(--pi-magenta), 8px 8px 0 3px var(--pi-ink);
  width: 100%;
  max-width: 780px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sa-leaderboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 14px;
  border-bottom: 3px solid var(--pi-ink);
  background: var(--pi-bg-2);
}

.sa-leaderboard-header h2 {
  font-family: var(--pi-font-display);
  font-size: 14px;
  color: var(--pi-yellow);
  margin: 0;
  letter-spacing: 0.08em;
  text-shadow: 2px 2px 0 var(--pi-magenta), 3px 3px 0 var(--pi-ink);
}

.sa-leaderboard-close {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--pi-font-display);
  font-size: 12px;
  color: var(--pi-bg-2);
  background: var(--pi-pink);
  border: 3px solid var(--pi-ink);
  box-shadow: 2px 2px 0 var(--pi-magenta);
  cursor: pointer;
  transition: transform 80ms steps(2), filter 80ms steps(2);
}

.sa-leaderboard-close:hover {
  transform: translate(-2px, -2px);
  filter: brightness(1.1);
}

.sa-leaderboard-close:focus-visible {
  outline: 3px solid var(--pi-yellow);
  outline-offset: 3px;
}

.sa-leaderboard-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 22px;
  background: var(--pi-bg-2);
  border-bottom: 3px solid var(--pi-ink);
  overflow-x: auto;
  scrollbar-width: none;
}

.sa-leaderboard-tabs::-webkit-scrollbar { display: none; }

.sa-lb-tab {
  flex-shrink: 0;
  padding: 8px 14px;
  font-family: var(--pi-font-display);
  font-size: 8px;
  color: var(--pi-cream);
  background: var(--pi-bg-3);
  border: 2px solid var(--pi-ink);
  box-shadow: 2px 2px 0 var(--pi-magenta);
  cursor: pointer;
  letter-spacing: 0.1em;
  white-space: nowrap;
  transition: transform 80ms steps(2), filter 80ms steps(2);
}

.sa-lb-tab:hover {
  transform: translate(-1px, -1px);
  filter: brightness(1.1);
}

.sa-lb-tab.active {
  color: var(--pi-bg-2);
  background: var(--pi-yellow);
  box-shadow: 2px 2px 0 var(--pi-pink);
}

.sa-leaderboard-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 22px 22px;
  background: var(--pi-bg-3);
}

.sa-lb-loading,
.sa-lb-empty {
  font-family: var(--pi-font-body);
  font-size: 18px;
  color: var(--pi-pink);
  text-align: center;
  padding: 44px 0;
  letter-spacing: 0.04em;
}

.sa-lb-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.sa-lb-table thead th {
  font-family: var(--pi-font-display);
  font-size: 8px;
  color: var(--pi-cyan);
  text-align: left;
  padding: 10px 12px;
  border-bottom: 3px solid var(--pi-ink);
  letter-spacing: 0.14em;
  background: var(--pi-bg-2);
}

.sa-lb-table tbody td {
  font-family: var(--pi-font-body);
  font-size: 18px;
  color: var(--pi-cream);
  padding: 10px 12px;
  border-bottom: 2px solid var(--pi-ink);
  letter-spacing: 0.02em;
}

.sa-lb-table tbody tr:hover td {
  background: var(--pi-bg-2);
}

.sa-lb-me td {
  background: var(--pi-yellow);
  color: var(--pi-bg-2);
  font-weight: normal;
}

.sa-lb-me:hover td {
  background: var(--pi-yellow);
}

.sa-lb-player {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--pi-font-display);
  font-size: 9px;
  letter-spacing: 0.08em;
}

.sa-lb-avatar {
  display: inline-block;
  width: 22px;
  height: 22px;
  border: 2px solid var(--pi-ink);
  flex-shrink: 0;
}
```

- [ ] **Step 2: Visual check**

From any signed-in page, click the `Leaderboard` nav button. Verify the modal:
- Indigo elevated panel with hard magenta drop-shadow against a scanlined backdrop.
- Yellow Press Start 2P title with triple-layer shadow in the header.
- Pink close button (upper right) with ink border + shadow.
- Tabs sit on indigo-bg-2 strip; active tab is yellow-on-black.
- Table rows in VT323 body; the signed-in user's row highlights yellow.

- [ ] **Step 3: Commit**

```bash
git add src/auth/auth.css
git commit -m "feat(ui): Pico-8 auth skin — leaderboard modal"
```

---

## Task 6: Redesign `src/index.html` (landing)

**Files rewritten:** `src/index.html` (complete rewrite).

The landing needs its own Pico-8 chrome around the login overlay (for signed-out users) AND around the signed-in wordmark + PLAY button (for authed users). Layout follows the mockup from the brainstorm session (`pico-with-sprite.html`) trimmed to final scope.

- [ ] **Step 1: Replace `src/index.html` with the full document below**

Overwrite entirely:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stack Attack — System Architecture TD</title>
  <link rel="stylesheet" href="./auth/auth.css" />
  <style>
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
      font-family: var(--pi-font-display);
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

    .title-block { position: relative; z-index: 5; margin-top: 6vh; }
    .wordmark {
      font-family: var(--pi-font-display);
      font-size: clamp(40px, 9vw, 96px);
      line-height: 1;
      color: var(--pi-yellow);
      letter-spacing: 0.02em;
      text-shadow:
        4px 4px 0 var(--pi-pink),
        8px 8px 0 var(--pi-magenta),
        11px 11px 0 var(--pi-ink);
      margin: 0;
    }
    .wordmark em { color: var(--pi-cyan); font-style: normal; }
    .tagline {
      font-family: var(--pi-font-display);
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
      font-family: var(--pi-font-display);
      font-size: 14px;
      padding: 16px 28px;
      color: var(--pi-bg-2);
      background: var(--pi-orange);
      border: 3px solid var(--pi-ink);
      box-shadow: 5px 5px 0 var(--pi-magenta);
      letter-spacing: 0.1em;
      text-decoration: none;
      transition: transform 80ms steps(2), filter 80ms steps(2);
    }
    .cta:hover { transform: translate(-2px, -2px); filter: brightness(1.1); }
    .cta:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--pi-magenta); }
    .cta:focus-visible { outline: 3px solid var(--pi-yellow); outline-offset: 4px; }
    .cta-hint {
      font-family: var(--pi-font-body);
      font-size: 20px;
      color: var(--pi-cream);
      opacity: 0.75;
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
      border-top: 3px solid var(--pi-magenta);
      box-shadow: 0 -3px 0 var(--pi-pink), 0 -10px 0 rgba(126, 37, 83, 0.25);
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
    .queue .s1 { animation: bob 1.1s steps(2) infinite; }
    .queue .s2 { animation: bob 1.1s steps(2) infinite 0.2s; }
    .queue .s3 { animation: bob 1.1s steps(2) infinite 0.4s; }
    .queue .s4 {
      margin-left: auto;
      transform: scaleX(-1);
      animation: bob-flip 1.1s steps(2) infinite 0.6s;
    }
    @keyframes bob      { 50% { transform: translateY(-4px); } }
    @keyframes bob-flip {
      0%, 100% { transform: scaleX(-1) translateY(0); }
      50%      { transform: scaleX(-1) translateY(-4px); }
    }

    .bubble {
      position: absolute;
      left: 78px; bottom: 160px;
      z-index: 4;
      font-family: var(--pi-font-body);
      font-size: 20px;
      color: var(--pi-bg-2);
      background: var(--pi-cream);
      padding: 6px 12px;
      border: 3px solid var(--pi-ink);
      box-shadow: 4px 4px 0 var(--pi-ink);
      letter-spacing: 0.02em;
    }
    .bubble::after {
      content: "";
      position: absolute;
      left: 18px; bottom: -13px;
      width: 0; height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 10px solid var(--pi-ink);
    }
    .bubble::before {
      content: "";
      position: absolute;
      left: 20px; bottom: -10px;
      width: 0; height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-top: 8px solid var(--pi-cream);
      z-index: 1;
    }

    @media (prefers-reduced-motion: reduce) {
      .queue .s1, .queue .s2, .queue .s3, .queue .s4 { animation: none !important; }
    }

    @media (max-width: 640px) {
      .stage { padding: 20px 22px; }
      .queue { gap: 8px; }
      .queue img { width: 72px; height: 72px; }
      .bubble { left: 46px; bottom: 118px; font-size: 16px; }
      .wordmark {
        text-shadow:
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
  <script type="module" src="./landing-boot.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Visual check — signed-out**

Clear your Supabase session (sign out or `localStorage.clear()`) and open `/`. Verify:
- Pico-8 stars + scanlines + ground strip behind a login overlay that matches the rest of the Pico-8 chrome.
- Wordmark hidden under the overlay (z-index). Nav bar absent (anonymous).

- [ ] **Step 3: Visual check — signed-in**

Sign in. Verify:
- Overlay disappears. Landing shows the yellow `STACK//ATTACK` wordmark with triple shadow, cyan `SYSTEM ARCHITECTURE · TOWER DEFENCE` tagline, orange `▶ INSERT COIN` button, ground strip with bobbing client-sprite queue, cream speech bubble `GET /api/me`.
- Nav bar in the top-right shows the yellow `Leaderboard` button + cream user chip.
- PLAY navigates to `/levels.html`.

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat(ui): Pico-8 landing with client-sprite queue"
```

---

## Task 7: Redesign `src/levels.html` (level select)

**Files rewritten:** `src/levels.html` (complete rewrite).

- [ ] **Step 1: Replace `src/levels.html` with the full document below**

Overwrite entirely:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stack Attack — Select Level</title>
  <link rel="stylesheet" href="./auth/auth.css" />
  <style>
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
      font-family: var(--pi-font-display);
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
      padding: 40px 28px 56px;
    }

    .top {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-family: var(--pi-font-display);
      font-size: 10px;
      letter-spacing: 0.22em;
      color: var(--pi-pink);
    }
    .top .back {
      color: var(--pi-cream);
      text-decoration: none;
    }
    .top .back:hover { color: var(--pi-yellow); }
    .top .back:focus-visible { outline: 3px solid var(--pi-yellow); outline-offset: 3px; }

    h1.title {
      font-family: var(--pi-font-display);
      font-size: clamp(22px, 4.2vw, 36px);
      color: var(--pi-yellow);
      margin: 32px 0 32px;
      text-shadow:
        3px 3px 0 var(--pi-magenta),
        5px 5px 0 var(--pi-ink);
      letter-spacing: 0.06em;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }
    @media (min-width: 720px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }

    .card {
      position: relative;
      display: grid;
      grid-template-columns: 72px 1fr auto;
      gap: 16px;
      align-items: center;
      padding: 20px 22px;
      background: var(--pi-cyan);
      color: var(--pi-bg-2);
      border: 3px solid var(--pi-ink);
      box-shadow: 6px 6px 0 var(--pi-magenta);
      text-decoration: none;
      transition: transform 80ms steps(2), filter 80ms steps(2);
    }
    .card:hover {
      transform: translate(-2px, -2px);
      filter: brightness(1.05);
    }
    .card:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--pi-magenta); }
    .card:focus-visible { outline: 3px solid var(--pi-yellow); outline-offset: 3px; }

    .portrait {
      width: 72px; height: 72px;
      background: var(--pi-cream);
      border: 3px solid var(--pi-bg-2);
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .portrait img { width: 96px; height: 96px; margin-top: 6px; }

    .meta .num {
      font-family: var(--pi-font-display);
      font-size: 10px;
      color: var(--pi-bg-2);
      letter-spacing: 0.08em;
    }
    .meta .name {
      font-family: var(--pi-font-display);
      font-size: 16px;
      color: var(--pi-bg-2);
      margin-top: 8px;
      letter-spacing: 0.04em;
    }
    .meta .desc {
      font-family: var(--pi-font-body);
      font-size: 18px;
      color: var(--pi-bg-2);
      margin-top: 8px;
      letter-spacing: 0.02em;
      line-height: 1.3;
    }
    .meta .record {
      font-family: var(--pi-font-body);
      font-size: 15px;
      color: var(--pi-magenta);
      margin-top: 8px;
      letter-spacing: 0.04em;
    }

    .tag {
      font-family: var(--pi-font-display);
      font-size: 11px;
      padding: 10px 14px;
      background: var(--pi-lime);
      color: var(--pi-bg-2);
      border: 3px solid var(--pi-bg-2);
      box-shadow: 3px 3px 0 var(--pi-bg-2);
      letter-spacing: 0.12em;
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
          <div class="desc">A tiny service. Reads dwarf writes. Server + database + cache is enough — if you route it right.</div>
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
          <div class="desc">Peak-hour streaming. Writes, reads, and viewers all want the same hot titles. Scale before the SLA drops.</div>
          <div class="record">⭐ no record · target 99.5%</div>
        </div>
        <span class="tag">GO ▸</span>
      </a>
    </nav>
  </div>
  <script type="module" src="./levels-boot.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Visual check**

From a signed-in session, open `/levels.html`. Verify:
- Scanlines over indigo background.
- `◂ BACK` link at top-left (cream, hovers to yellow); `WORLD 1-1` pink label top-right.
- Yellow `SELECT LEVEL` Press Start 2P title with drop-shadow.
- Two cyan cards side-by-side (≥720px) or stacked (< 720px):
  - Portrait tile shows the client sprite.
  - `LV. 01 / URL SHORTENER` and `LV. 02 / BUILD NETFLIX`.
  - Lime `GO ▸` tag.
  - Hover nudges the card; active pushes it back down-right.
- Nav bar still visible in the top-right.

- [ ] **Step 3: Commit**

```bash
git add src/levels.html
git commit -m "feat(ui): Pico-8 level select with URL Shortener + Build Netflix cards"
```

---

## Task 8: Build + final verification

- [ ] **Step 1: Kill the dev server + run production build**

```bash
lsof -ti:5173 2>/dev/null | xargs kill 2>/dev/null
pnpm exec vite build 2>&1 | tail -20
```
Expected: build succeeds. `dist/` contains `index.html`, `levels.html`, `game.html`, and an `assets/` dir containing the 4 sprite PNGs (Vite may rename them with a content hash). No warnings about missing assets or fonts.

- [ ] **Step 2: Preview the production build**

```bash
pnpm exec vite preview 2>&1 | tail -5
```
Open the URL Vite prints (typically `http://localhost:4173`). Sign in. Walk landing → level select → each level → return to landing → leaderboard modal. Verify each surface renders Pico-8 as designed; none fall back to the teammate's original purple styling.

- [ ] **Step 3: Full test suite + typecheck**

```bash
pnpm typecheck 2>&1 | tail -6
pnpm test 2>&1 | tail -6
```
Expected: typecheck has only the 2 pre-existing noise lines; 703 tests pass + 6 skipped (unchanged — this pass touched no TS).

- [ ] **Step 4: Report back**

Tell the user the 6 commit SHAs made in the worktree, list the Pico-8 surfaces (login overlay, profile setup, nav bar + dropdown, leaderboard, landing, level select), and confirm the game canvas is untouched. Do **not** push, fast-forward main, or open a PR — that's the user's call per `CLAUDE.md`.

---

## Self-Review

**Spec coverage:**

| Spec / user requirement | Task |
|---|---|
| Pico-8 palette via CSS custom properties | Task 2, `:root` block |
| Press Start 2P + VT323 fonts | Task 2, `@import` and `--pi-font-*` tokens |
| Login overlay reskin | Task 2 |
| Profile setup reskin | Task 3 |
| Nav bar + user menu + dropdown reskin | Task 4 |
| Leaderboard modal reskin | Task 5 |
| Landing redesign (wordmark + sprite queue + bubble) | Task 6 |
| Level select redesign (URL Shortener + Build Netflix cards with sprite) | Task 7 |
| PixelLab client sprite committed | Task 1 |
| `image-rendering: pixelated` across auth chrome | Task 2 |
| `prefers-reduced-motion` honored | Tasks 6, 7 |
| Focus rings on all interactive elements | Tasks 2–7 |
| Game canvas (`game.html`, `cyberpunk-hud.css`, `physics-td/*`) untouched | implicit — no task modifies them |
| Build produces all 3 entrypoints | Task 8 |

**Placeholder scan:** none.

**Type consistency:** this plan touches no TypeScript; no signatures to cross-check. CSS class names are copied verbatim from the teammate's `auth.css` so the teammate's TS that references them by string continues to work.

**Boundary check:** no changes under `src/core/`, `src/capabilities/`, `src/sim/`, or `src/physics-td/`. No React, Next, or Vercel imports added anywhere.

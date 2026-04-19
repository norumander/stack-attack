# Stack Attack — Rename, Level Roster, and Pico-8 UI Pass

**Date:** 2026-04-19
**Status:** Approved — proceed straight to implementation plan
**Scope owner:** Norman (UI track). Teammate owns the game-balance / component-mechanics track.

## Summary

Three changes, in this order:

1. **Rename** the game from `BrainLift` to `Stack Attack` everywhere in the codebase and docs.
2. **Duplicate the current campaign** so the level-select surface two playable levels — `Level 01 · URL Shortener` and `Level 02 · Build Netflix` — both pointing at the same underlying waves today. Teammate will tune Level 01 into a genuinely easier campaign later.
3. **Redesign** the landing page (`src/index.html`) and level-select (`src/levels.html`) in a Pico-8 arcade aesthetic using a generated PixelLab client sprite.

No changes to gameplay, component mechanics, wave balance, or the `src/physics-td/*` runtime beyond reading a new optional URL param. The spec also serves as the handoff document between the two tracks.

## Non-goals

- No new game mechanics, wave balance, or component behavior. Teammate owns that.
- No in-game HUD redesign in this pass.
- No in-game component sprite replacement in this pass (future phase, assets-only).
- No new build tooling, test infrastructure, or dependency additions beyond Google Fonts and one generated sprite set.

## Track 1 — Rename

### Scope

Every occurrence of `BrainLift` (any casing: `BrainLift`, `brainlift`, `BRAINLIFT`, `Brainlift`, `BRAIN-LIFT`) becomes `Stack Attack` (or the casing-equivalent: `stack-attack`, `STACK ATTACK`, `Stack Attack`).

### Files touched

Confirmed by `rg "brainlift|BrainLift|BRAINLIFT"` at spec time (7 files):

| File | Change |
|---|---|
| `CLAUDE.md` | Rename title line, update any in-body references |
| `README.md` | Rename title line, update any in-body references |
| `docs/claude/game-design.md` | In-body references |
| `src/index.html` | UI copy (redesigned in Track 3, but rename happens here too for safety) |
| `src/levels.html` | UI copy (redesigned in Track 3) |
| `src/game.html` | `<title>` tag, any in-body references |
| `brainlift-system-architecture-game.md` | Move to `archive/stack-attack-concept.md`; rewrite the title/header; preserve body verbatim as research history |

### Out of rename scope

- `brainlift-tam-analysis.xlsx` — untracked local file, user's working copy; left alone.
- `.git/` history — not rewriting. Old commit messages that reference BrainLift stay as-is.
- No rename of directories, class names, or identifiers in code — none exist (confirmed by grep).

### Acceptance

- `rg -i brainlift` from repo root returns zero results (excluding `.git/`, `node_modules/`, `.superpowers/`, the untracked xlsx, and the archived doc's old filename-in-commit-history).
- `pnpm typecheck` clean.
- `pnpm test` green (expected — rename should touch no test files).

## Track 2 — Level roster (duplicate-then-diverge)

### Current state

One campaign: `CAMPAIGN_WAVES` in `src/physics-td/waves.ts`. `src/levels.html` has one playable card and one `locked` placeholder card. `/game.html` boots the single campaign regardless of query params.

### Target state

Two level cards on `levels.html`, both playable, both linking to `/game.html` with a distinguishing query param:

- `Level 01 · URL Shortener` → `/game.html?level=url-shortener`
- `Level 02 · Build Netflix` → `/game.html?level=netflix`

### Routing behavior

`src/physics-td/physics-td.ts` already parses `window.location.search` for `?wave=`. Add minimal handling for `?level=`:

- Accepted values: `"url-shortener"`, `"netflix"`, or missing.
- **Both values resolve to the same `CAMPAIGN_WAVES` today.** The param is accepted and stored on a `window.__stackAttackLevelId` marker (or similar read-only surface) so the teammate can pivot on it when they split the campaigns. No branching logic in our implementation.
- Unknown values log a warning and fall through to the default campaign.

This intentionally leaves the teammate a clean insertion point: when they split `CAMPAIGN_WAVES` into `CAMPAIGN_WAVES_URL_SHORTENER` and `CAMPAIGN_WAVES_NETFLIX`, they only need to change the selection inside `physics-td.ts` where the level id is read.

### Briefing copy

Level card copy (short, sits on the level-select card):

- **Level 01 · URL Shortener** — "A tiny service. Reads dwarf writes. Database + cache is enough — if you route it right."
- **Level 02 · Build Netflix** — "Peak-hour streaming. Writes, reads, and viewers all want the same hot keys. Scale the system before the SLA drops."

Level 02's copy replaces the current `Level 01 · System Architecture` copy. Level 01's copy is new.

### Merge-conflict hygiene

If the teammate commits changes that affect the campaign (e.g., new wave tuning in `waves.ts`), those changes flow to both levels today because both levels read the same waves. The teammate can de-duplicate on their own timetable — our UI already carries the level-id distinction end-to-end.

### Acceptance

- Clicking either level card loads the game with the corresponding `?level=...` query param.
- Game plays identically for both levels (duplication is intentional).
- `pnpm typecheck` clean.
- No new tests required — behavior is observable but unchanged.

## Track 3 — Pico-8 UI pass

### Aesthetic decision (approved)

"Pico-8 arcade" — the direction previewed in the brainstorm at `.superpowers/brainstorm/96156-1776622820/content/pico-with-sprite.html`.

Palette (CSS custom properties in both HTML files):

```
--pi-bg-2:     #1d2b53;   /* indigo base */
--pi-bg-3:     #3a3a8a;   /* indigo elevated */
--pi-cream:    #fff1e8;   /* primary text */
--pi-yellow:   #ffec27;   /* wordmark / primary accent */
--pi-orange:   #ffa300;   /* CTA */
--pi-pink:     #ff77a8;   /* secondary accent / shadow layer */
--pi-magenta:  #7e2553;   /* shadow depth */
--pi-cyan:     #29adff;   /* level card fill */
--pi-lime:     #00e436;   /* status OK */
--pi-ink:      #000000;   /* hard shadow / outline */
```

Typography (Google Fonts, combined ~30KB, `font-display: swap`):

- `Press Start 2P` — wordmark and UI labels.
- `VT323` — body copy, level descriptions, speech bubble, metadata.

`image-rendering: pixelated` globally so the sprite and any scaled raster art stays crisp.

### Assets

- `src/assets/stack-attack/client-south.png` (and `client-east.png`, `client-north.png`, `client-west.png`) — the PixelLab "Pico Client" sprite, 68×68px transparent PNGs, imported into the repo from `.superpowers/brainstorm/96156-1776622820/content/sprites/`. Committed into git (tiny — under 5KB combined). Character ID `168439bb-b390-4edc-bb29-ffe803799bcc` for regeneration traceability.
- No other generated assets in this pass.

### `src/index.html` (landing)

Replaces the current scaffold. Structure top-to-bottom:

- Thin top bar with an HP-style counter, score placeholder, and a blinking `ONLINE` status indicator.
- Wordmark `STACK ATTACK` in `Press Start 2P` 48px with triple-shadow (pink → magenta → ink) so its outline weight matches the sprite.
- Tagline `▸ SYSTEM ARCHITECTURE · TOWER DEFENCE` in cyan `Press Start 2P` 9px.
- Animated CTA: `▶ INSERT COIN` button (orange on indigo, pink drop-shadow) linking to `./levels.html`; hint text `— press any key to begin —` in `VT323`.
- Parallax ground strip with repeating tile pattern at the bottom.
- Client-sprite queue walking along the ground (4 instances of the generated sprite, one flipped via `scaleX(-1)`), with a `GET /api/me` speech bubble above the first one. Sprites bob via CSS `steps(2)` animation.
- Starfield (radial-gradient dots) and CRT scanline overlay (repeating-linear-gradient) across the whole viewport.

Layout is a flex column; viewport is `100dvh`. No JavaScript required — all animation is CSS `@keyframes` driven.

Accessibility:
- All decorative sprites marked `aria-hidden="true"`.
- CTA is a real `<a>` with visible focus ring (yellow 2px outline).
- `prefers-reduced-motion: reduce` — disable bob, blink, and button pulse animations.

### `src/levels.html` (level select)

Replaces the current scaffold. Structure:

- Top bar with `◂ BACK` link to `./index.html` and a `WORLD 1-1` style title to the right.
- `SELECT LEVEL` title in yellow `Press Start 2P` with pink+ink shadow.
- Two level cards, cyan fill on indigo board, each with:
  - 52px square portrait tile (cream background, 2px indigo inset border) showing the client sprite.
  - `LV. 01` / `LV. 02` label, level name in `Press Start 2P`, description in `VT323`, best-record meta line (`⭐ no record · target 99.5%` — placeholder for future score persistence).
  - Lime `GO ▸` action tag with ink drop-shadow.
- Both cards are `<a>` elements (full-card click target).

Level cards use a shared CSS class; only the href, name, and copy differ.

Accessibility parity with the landing page.

### What's cut from the previewed mockup

- The `ONLINE · 2P-READY` in the top bar becomes just `ONLINE` (2P mode isn't a thing, don't lie about it).
- The speech bubble stays as `GET /api/me` (not cycled through request types in this pass — defer to a later polish pass; noted in "Open questions resolved" below).
- Portrait stays at 52px (not bumped to 68px — bigger makes the card feel sprite-first rather than level-first).
- No CRT vignette on landing (scanlines alone carry enough texture).

### Acceptance

- Landing renders at 1280×720, 1920×1080, and 375×812 (mobile portrait) without layout break. Mobile can degrade the parallax queue to static — acceptable.
- `PLAY`-equivalent action on landing navigates to `/levels.html`.
- Each level card click navigates to `/game.html?level=...`.
- `prefers-reduced-motion: reduce` media query kills the three CSS animations.
- Lighthouse a11y score ≥ 95 on both pages.
- `pnpm typecheck` clean (no TS changes expected).
- `pnpm exec vite build` produces a build that still loads `src/{index,levels,game}.html` correctly (entrypoints unchanged in `vite.config.ts`).

## Risks

- **Google Fonts flash of unstyled text.** Mitigation: `font-display: swap`, short critical CSS defining fallback sizes, sprite loads in parallel so unstyled flash is brief.
- **Sprite PNG dimensions don't match CSS assumptions.** Files are 68×68 per `get_character`. CSS should size sprites via `width: 80px` container with `image-rendering: pixelated` for a 1.17× upscale; confirm visually during implementation.
- **Teammate's in-flight campaign changes merge-conflict with our rename.** Mitigation: the rename touches no files inside `src/physics-td/` (only `waves.ts` imports a constant name, which is unchanged). Collision surface is zero.

## Out-of-scope but noted for future passes

- Score persistence (`localStorage` best-SLA per level) for the meta line.
- Speech bubble cycling through real request types.
- In-game HUD Pico-8 pass.
- In-game component sprite replacement (towers, packets, sources) — assets-only, no layout changes.

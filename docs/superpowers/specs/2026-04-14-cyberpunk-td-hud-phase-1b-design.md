# Cyberpunk TD HUD — Phase 1B Design Spec

**Date:** 2026-04-14
**Status:** Approved (brainstorm)
**Branch:** `feature/cyberpunk-td-renderer` (continues from Phase 1A)
**Depends on:** Phase 1A renderer swap (this worktree)

## Context

Phase 1A replaced the TD scene renderer with a cyberpunk iso version toggled via `?renderer=iso`. Phase 1B now revamps the rest of the TD UI (HUD sidebar, briefing card, component info panel, loss modal, top-bar chrome, status banner) to match the cyberpunk aesthetic — but only when the iso renderer is active. The classic chrome keeps working when the URL param is absent.

## Goal

Produce a visually cohesive cyberpunk HUD that:
- Shares the showcase's language: dark navy `#050816` base, neon cyan `#5ef0ff` accents, Chakra Petch display + JetBrains Mono numerics, translucent panels with L-corner brackets and hairline top-edge gradients.
- Preserves every existing DOM element ID and event handler so the TD game loop, controller state bindings, click handlers, and loss-modal flow all work unchanged.
- Activates at boot time when `?renderer=iso` is set and leaves the default chrome untouched otherwise.
- Adds sprite thumbnails to palette buttons via pure CSS (no DOM mutation).

## Non-goals

- No changes to TD game logic, waves, economy, sim engine, or TD controller.
- No changes to the classic look (default `#mode=td` without the URL param stays identical).
- No new unit tests — this is a pure CSS + body-class activator change.
- No panel **position** changes — the cyberpunk version keeps the existing layout (sidebar HUD, top-right briefing, modal, etc.) and just restyles in place.
- No new DOM elements. Sprite thumbnails come from CSS `::before` + `background-image` on the existing palette buttons.
- No changes to Sandbox mode UI. The cyberpunk treatment only affects elements visible in TD mode or at the app-chrome level.

## Activation

New module `src/dashboard/cyberpunk-hud.ts` exports a single function:

```ts
export function activateCyberpunkHud(): void {
  document.body.classList.add("renderer-iso");
}
```

Called from `main.ts` at boot time when the iso renderer is detected:

```ts
import { activateCyberpunkHud } from "./cyberpunk-hud.js";

if (new URLSearchParams(location.search).get("renderer") === "iso") {
  activateCyberpunkHud();
}
```

Placed as early as possible so the cyberpunk rules apply before TD mode is shown — ideally before `createTDDashboard()` runs.

## Stylesheet scoping

All cyberpunk rules live in `src/dashboard/cyberpunk-hud.css`, loaded via a `<link>` tag in `index.html`. Every selector is prefixed with `body.renderer-iso` so the classic look remains untouched when the body class is absent.

Example:
```css
body.renderer-iso #td-hud {
  background: rgba(6, 14, 36, 0.72);
  backdrop-filter: blur(10px) saturate(1.25);
  border: 1px solid rgba(94, 240, 255, 0.32);
  /* … */
}
```

## Fonts

Google Fonts loaded via `<link>` tags in `index.html` with preconnect hints:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
/>
```

Fallbacks in CSS `font-family` lists: `"Chakra Petch", ui-sans-serif, sans-serif` and `"JetBrains Mono", ui-monospace, monospace`.

## Design tokens (palette + metrics)

Declared once at the top of `cyberpunk-hud.css` as CSS custom properties, scoped to `body.renderer-iso`:

```css
body.renderer-iso {
  --sc-bg: #050816;
  --sc-ink: #5ef0ff;
  --sc-ink-dim: rgba(94, 240, 255, 0.52);
  --sc-ink-faint: rgba(94, 240, 255, 0.18);
  --sc-panel: rgba(6, 14, 36, 0.72);
  --sc-border: rgba(94, 240, 255, 0.32);
  --sc-border-bright: rgba(94, 240, 255, 0.9);
  --sc-glow: 0 0 24px rgba(94, 240, 255, 0.18);
  --sc-text-shadow: 0 0 12px rgba(94, 240, 255, 0.55);
  --sc-danger: #ff4d4d;
  --sc-warning: #ffb74d;
  --font-display: "Chakra Petch", ui-sans-serif, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

## Per-surface treatment

### Body / app chrome

```css
body.renderer-iso {
  background: var(--sc-bg);
  color: var(--sc-ink);
  font-family: var(--font-display);
}
```

The BrainLift title and mode tabs get thin neon accent bars and monospace labels. Exact selectors TBD during implementation — driven by reading `index.html` and `styles.css` for current markup.

### `#td-hud` sidebar

- Background: translucent navy + backdrop-filter blur
- 1px cyan hairline border + subtle glow box-shadow
- L-corner brackets via four absolutely-positioned `::before`/`::after` patterns (since we can only use two pseudo-elements per element, we wrap the corners by re-purposing nested child pseudo-elements on `.td-hud__row` or add the four corner spans programmatically if needed — but per the "no DOM mutation" rule, we'll use box-shadow hacks or accept two visible corners for 1B).

Simplification for 1B: skip the 4-L-bracket treatment on `#td-hud` and use a single hairline top-edge gradient accent via `::before`. Four-corner brackets appear on the briefing card and info panel instead (which are smaller and more visually prominent).

- Wave/Phase/Budget rows: dim uppercase labels in `var(--font-display)` with letter-spacing, values in `var(--font-mono)` with `var(--sc-text-shadow)`
- Visual separator: 1px dashed `var(--sc-ink-faint)` line between rows

### Palette buttons

Each `.td-palette-btn` has `data-type="server" | "database" | "cache" | …`. New layout:

```css
body.renderer-iso .td-palette-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(10, 20, 51, 0.55);
  border: 1px solid var(--sc-border);
  color: var(--sc-ink);
  font-family: var(--font-display);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}

body.renderer-iso .td-palette-btn::before {
  content: "";
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  image-rendering: pixelated;
  filter: drop-shadow(0 0 6px rgba(94, 240, 255, 0.3));
}

body.renderer-iso .td-palette-btn[data-type="server"]::before {
  background-image: url("./assets/server.png");
}
body.renderer-iso .td-palette-btn[data-type="database"]::before {
  background-image: url("./assets/database.png");
}
body.renderer-iso .td-palette-btn[data-type="cache"]::before {
  background-image: url("./assets/cache.png");
}
body.renderer-iso .td-palette-btn[data-type="load_balancer"]::before {
  background-image: url("./assets/load_balancer.png");
}
body.renderer-iso .td-palette-btn[data-type="cdn"]::before {
  background-image: url("./assets/cdn.png");
}
body.renderer-iso .td-palette-btn[data-type="api_gateway"]::before {
  background-image: url("./assets/api_gateway.png");
}

body.renderer-iso .td-palette-btn:hover {
  background: rgba(18, 36, 72, 0.78);
  border-color: var(--sc-border-bright);
  transform: translateX(2px);
}

body.renderer-iso .td-palette-btn.placing {
  background: rgba(94, 240, 255, 0.16);
  border-color: var(--sc-border-bright);
  box-shadow: var(--sc-glow-soft, 0 0 12px rgba(94, 240, 255, 0.25));
}
```

The existing `.placing` class set by the click handler gets an "active" cyberpunk appearance for free.

### READY button

```css
body.renderer-iso #td-ready-btn {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 12px 16px;
  background: rgba(94, 240, 255, 0.12);
  border: 1px solid var(--sc-border-bright);
  color: var(--sc-ink);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  text-shadow: var(--sc-text-shadow);
  box-shadow: inset 0 1px 0 rgba(94, 240, 255, 0.3), 0 0 16px rgba(94, 240, 255, 0.2);
  animation: hud-ready-pulse 2s ease-in-out infinite;
}

@keyframes hud-ready-pulse {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(94, 240, 255, 0.3), 0 0 16px rgba(94, 240, 255, 0.18); }
  50%      { box-shadow: inset 0 1px 0 rgba(94, 240, 255, 0.5), 0 0 22px rgba(94, 240, 255, 0.3); }
}
```

When the wave is running (existing JS presumably adds a disabled/running class), we can gate the pulse off.

### Dev wave selector (`#td-dev-wave-select`)

Styled as a thin cyberpunk dropdown — navy bg, cyan border, Chakra Petch font. Inherits natively from the parent rules.

### `#td-briefing` card

Full cyberpunk panel treatment:
- Translucent navy + backdrop blur
- 1px cyan border
- L-corner brackets on all four corners (via four `<span class="hud-corner …">` spans — wait, this violates "no DOM mutation". Alternative: use four box-shadow layers on `::before` and `::after` to fake corner brackets. Simpler: use `::before` and `::after` for top-left + top-right corners only; the bottom corners get a thin hairline stripe. Accept visual asymmetry.)
- Title in large Chakra Petch with letter-spacing
- Key/value rows in mono font

### `#td-info-panel`

Same panel treatment as briefing. `td-info-panel__section-title` → neon accent bar + uppercase label. `td-info-panel__caps` bullets use cyan accent dots. `td-info-panel__stats` rows use mono font.

### `#td-loss-modal`

Red-tinted cyberpunk dialog:
- Semi-transparent red-navy background (`rgba(50, 10, 20, 0.85)`)
- Red-tinted border + danger glow
- Title in large Chakra Petch with optional subtle CSS glitch animation (skipped for 1B unless trivial)
- Retry button: cyan action style (matches READY button pattern)
- Reset button: dim/neutral style

### TD status banner (`.td-status`)

Cyberpunk pill top-left of the iso canvas:
- Translucent navy bg
- 1px cyan border
- Monospace label
- Subtle padding so it doesn't fight the canvas

## Open decisions

- **L-corner brackets using only `::before`/`::after`**: we have 2 pseudo-elements per element, which gives us 2 corner brackets out of 4. Options:
  - (a) Accept 2-corner brackets (top-left + top-right) and leave bottom unadorned
  - (b) Add corner brackets programmatically in `cyberpunk-hud.ts` by injecting 4 `<span>` children into each panel — violates "no DOM mutation" rule but is a cheap exception
  - (c) Use SVG `<svg>` backgrounds via `mask-image` to draw all 4 corners in a single pseudo-element
  
  **Decision: (a) for Phase 1B.** 2-corner treatment is distinctive enough; 4-corner perfection is Phase 1C polish.

- **Font loading strategy**: `<link>` in HTML. Pro: loads for both iso and classic (harmless; classic doesn't reference the fonts in CSS so they just sit in cache). Con: slight extra network request for classic users. Acceptable.

## Verification

Phase 1B adds **no new unit tests** (CSS only + 1 tiny JS activator).

1. `pnpm typecheck` — must be clean (mostly noop since we're just adding a single TS file + imports).
2. `pnpm test` — must stay at ≥708 passing.
3. `pnpm build` via `vite build` (or equivalent) — must succeed with both HTML entries.
4. **Manual dev smoke** at `http://localhost:5173/?renderer=iso#mode=td`:
   - Dark cyberpunk chrome, Chakra Petch font, JetBrains Mono for numeric values
   - TD sidebar HUD has cyberpunk panel look
   - Wave/Phase/Budget rows readable
   - Palette buttons show sprite thumbnails + name + cost
   - READY button pulses when idle
   - Click a palette button → button goes into placing state (cyberpunk highlight)
   - Click an empty iso tile → component places correctly (phase 1A functionality preserved)
   - Click a placed component → info panel appears with cyberpunk styling
   - Start Wave 1 → runs through to completion; loss modal (if triggered) appears with cyberpunk red panel
   - Default URL `http://localhost:5173/#mode=td` (no `?renderer=iso`) loads the classic chrome unchanged — no cyberpunk styling applied
   - Zero console errors in either mode

## Risks

1. **Specificity wars with `styles.css`.** The existing stylesheet likely uses `#td-hud .foo` selectors that match or beat `body.renderer-iso #td-hud .foo`. Mitigation: our scoped rules use `body.renderer-iso` (specificity 0,1,1 minimum) → `body.renderer-iso #td-hud` (0,2,1) → etc. which beats unprefixed `#td-hud` (0,1,0) selectors.
2. **Font FOUC on first load.** Mitigated by `font-display: swap` (Google default) and fallback font stack.
3. **Sprite thumbnail URL resolution.** CSS `url()` in the stylesheet resolves relative to the stylesheet's location. Since the stylesheet lives at `src/dashboard/cyberpunk-hud.css` and assets at `src/dashboard/assets/`, the URLs should use `./assets/server.png` and Vite will process them at build time.
4. **Palette button has both text content and `::before` content.** The flex layout needs `gap` to be correct and the button text needs to wrap alongside the icon — confirming alignment during dev smoke.
5. **Dashboard container position.** The iso renderer replaces the canvas content but the surrounding `#td-hud` aside is positioned CSS-relatively from the page. Need to ensure the cyberpunk panel positioning doesn't break when combined with the iso canvas.

## File layout

```
src/dashboard/
  cyberpunk-hud.ts     # NEW — activateCyberpunkHud()
  cyberpunk-hud.css    # NEW — all cyberpunk rules scoped under body.renderer-iso
  main.ts              # MODIFY — call activateCyberpunkHud() at boot if iso
  index.html           # MODIFY — add <link> for Google Fonts + cyberpunk-hud.css
```

Total new files: 2. Modified files: 2. No existing CSS touched.

# Implementation status

**Current stage:** Physics TD is the sole game mode. Classic TD mode, sandbox mode, and all associated infrastructure have been removed. 613 tests, typecheck clean.

## What ships

**Physics TD game** — entry point `localhost:5173/game.html` (landing page at `/` → level selector at `/levels.html` → game). Source in `src/physics-td/`. Uses the physics-based `Sim` engine (`src/sim/`) and the cyberpunk isometric renderer (`src/render/cyberpunk-topology-renderer.ts`).

**Physics sim engine** — `src/sim/` — packet-physics request simulation. `Sim` drives per-frame packet advancement, SLA evaluation, and wave lifecycle. `TrafficSource` generates typed request packets per wave composition. `SimClient` owns the traffic snake.

**Cyberpunk HUD** — `src/cyberpunk-hud.ts` + `src/cyberpunk-hud.css`. Mirror-div pattern: physics-td writes to hidden divs, HUD reflects them into the visible cyberpunk-styled overlay.

**Campaign** — `src/physics-td/waves.ts` defines `CAMPAIGN_WAVES`. `PhysicsCampaignController` manages wave lifecycle, budget, and SLA evaluation. Component factory in `component-factory.ts` defines available types and costs.

**Renderer** — `src/render/cyberpunk-topology-renderer.ts` + `src/render/cyberpunk/` — Pixi-based isometric renderer. `BrowserDriver` + `SimToRendererAdapter` in `src/sim-demo/` bridge the physics sim to the renderer each frame.

## Source layout

```
src/
├── core/           # Shared type definitions (ids, etc.)
├── sim/            # Physics sim engine — Sim, packets, capabilities
├── capabilities/   # Core capability implementations
├── index.html              # Landing page → /
├── levels.html             # Level selector → /levels.html
├── game.html               # Physics TD game → /game.html
├── physics-td/             # Game logic (campaign, UX, waves, HUD bridge)
├── render/                 # Cyberpunk renderer + cyberpunk/ subfolder
├── sim-demo/               # BrowserDriver, SimToRendererAdapter
├── cyberpunk-hud.ts        # HUD overlay controller
└── cyberpunk-hud.css
```

## Dashboard URLs

- `/` — Landing page (PLAY → `/levels.html`)
- `/levels.html` — Level selector (card → `/game.html`)
- `/game.html` — Physics TD game (append `?wave=N` to jump, 1-indexed)

## Commands

```bash
pnpm test                              # full suite (~11s, 613 tests)
pnpm test tests/unit/<name>.test.ts    # single file (~1s)
pnpm typecheck                         # strict tsc --noEmit
pnpm dev                               # Vite at localhost:5173/
pnpm exec vite build                   # production build
```

## Phase 2 candidates

- Zone visualization, stream lines, auto-scale animation
- Tier upgrades (scaling UP vs scaling OUT)
- Cross-zone replication (CAP theorem teaching)
- Player tutorial / onboarding flow

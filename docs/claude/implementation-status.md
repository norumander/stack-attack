# Implementation status

**Current stage:** Physics TD is the sole game mode. Classic TD mode, sandbox mode, and all associated infrastructure have been removed. 613 tests, typecheck clean.

## What ships

**Physics TD game** — entry point `localhost:5173/`. Source in `src/dashboard/physics-td/`. Uses the physics-based `Sim` engine (`src/sim/`) and the cyberpunk isometric renderer (`src/dashboard/render/cyberpunk-topology-renderer.ts`).

**Physics sim engine** — `src/sim/` — packet-physics request simulation. `Sim` drives per-frame packet advancement, SLA evaluation, and wave lifecycle. `TrafficSource` generates typed request packets per wave composition. `SimClient` owns the traffic snake.

**Cyberpunk HUD** — `src/dashboard/cyberpunk-hud.ts` + `src/dashboard/cyberpunk-hud.css`. Mirror-div pattern: physics-td writes to hidden divs, HUD reflects them into the visible cyberpunk-styled overlay.

**Campaign** — `src/dashboard/physics-td/waves.ts` defines `CAMPAIGN_WAVES`. `PhysicsCampaignController` manages wave lifecycle, budget, and SLA evaluation. Component factory in `component-factory.ts` defines available types and costs.

**Renderer** — `src/dashboard/render/cyberpunk-topology-renderer.ts` + `src/dashboard/render/cyberpunk/` — Pixi-based isometric renderer. `BrowserDriver` + `SimToRendererAdapter` in `src/dashboard/sim-demo/` bridge the physics sim to the renderer each frame.

## Source layout

```
src/
├── core/           # Shared type definitions (ids, etc.)
├── sim/            # Physics sim engine — Sim, packets, capabilities
├── capabilities/   # Core capability implementations
├── dashboard/
│   ├── index.html              # Entry point → localhost:5173/
│   ├── physics-td/             # Game logic (campaign, UX, waves, HUD bridge)
│   ├── render/                 # Cyberpunk renderer + cyberpunk/ subfolder
│   ├── sim-demo/               # BrowserDriver, SimToRendererAdapter
│   ├── cyberpunk-hud.ts        # HUD overlay controller
│   └── cyberpunk-hud.css
```

## Dashboard URL

- `/` — Physics TD game (the only mode)

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
- Restructure: move `src/dashboard/` contents to `src/` root (tracked as follow-on task)

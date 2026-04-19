# Implementation status

**Current stage:** Physics TD is the sole game mode. Campaign extended to 8 waves (Launch → Viral Moment). Diagnose-mode framework shipped (no levels yet). AI chatbot backend (Supabase Edge Function → Claude) shipped. Per-component live metrics + stress indicators shipped. 760 tests passing (6 skipped). Typecheck has two pre-existing known errors unrelated to current work.

## What ships

### Physics TD game
Entry point: `/game.html` (landing at `/` → level selector at `/levels.html` → game). Source in `src/physics-td/`. Built on the `Sim` engine (`src/sim/`) and the cyberpunk isometric renderer (`src/render/`).

### 8-wave Netflix campaign (`src/physics-td/waves.ts`)
`CAMPAIGN_WAVES` teaches system architecture through progressive load and chaos:

1. **Launch Day** — single-service baseline
2. **Growth Spike** — reads volume, cache lesson
3. **Going Mainstream** — writes, DB pressure
4. **Async Operations** — batch/queue/worker decoupling
5. **Things Break** — chaos schedule (component failures), circuit breakers
6. **Video Launch** — Streaming Server, stream bandwidth reservation
7. **Going Global** — multi-zone DNS/GTM geo-routing
8. **Viral Moment** — chaos + auto-scale markers, capstone load

`PhysicsCampaignController` (`campaign-controller.ts`) owns per-wave lifecycle, budget, SLA evaluation. `component-factory.ts` defines placeable types + costs. `chaos.ts` owns the scheduled chaos types; the campaign controller fires them against the live sim.

### Physics sim engine (`src/sim/`)
Real-time, packet-physics simulation. `Sim.step(dt)` advances packets along connections per frame; there is **no tick-phase model**. `TrafficSource`/snake system spawns typed packets per wave composition; `SimClient` owns the traffic snake launch cadence. Capabilities live under `src/sim/capabilities/` (worker, etc.). SLA evaluation in `sla.ts`. Edge physics + bandwidth reservation for streams in `edge-physics.ts` + `zone-latency.ts`.

### Diagnose mode framework (`src/diagnose/`)
Entry point: `/diagnose.html`. `PhysicsDiagnoseController` pre-places a starting topology, gives the player a `remediationBudget`, and partial-refunds deletes (default 0.7×). `DiagnoseLevel` schema (`diagnose-level.ts`) describes a broken inherited system for the player to fix under one revealing wave. **`DIAGNOSE_LEVELS` is currently empty** — the framework is wired end-to-end (`diagnose-boot.ts`, URL handling, controller, placeholder verification level) but no shipped content levels. Content lane ("Instagram Level 1", etc.) has not landed yet.

### AI chatbot backend
- `src/chatbot/chat-client.ts` — browser-side plumbing, POSTs game-state payload + message history to the edge function, returns a structured reply. Pure — no UI yet.
- `supabase/functions/stack-attack-chat/` — Deno edge function. Builds a Socratic tutor system prompt from `{mode, hintLevel, wave, topology, liveMetrics, recentEvents}`, calls Anthropic Claude, logs the exchange to Postgres, returns `{reply, suggestions?}`. Falls back to a stub response if `ANTHROPIC_API_KEY` is unset.
- `supabase/migrations/20260419163239_chatbot_conversations.sql` — conversation-logging table.
- UI integration in-game is not yet wired.

### Live observability (`src/physics-td/component-metrics.ts`)
Client-side per-component metrics. Listens to `SimEvent`s per step, maintains 1-second rolling windows for drops + cumulative wave totals, samples utilization from each sim component's capacity bucket. Stress thresholds encoded centrally:
- `STRESS_UTILIZATION = 0.8` (utilization >= 0.8 → "stressed")
- `DROPPING_RECENT_THRESHOLD = 1` (≥1 drop in last 1s → "dropping")

Both the info panel and the sprite-layer stress indicator read from this single source of truth.

### Component labels + info panel
`component-info-panel.ts` shows type, role, metrics, and user label. Labels are player-editable and persisted in the controller's state.

### Cyberpunk renderer (`src/render/`)
Pixi v8 isometric renderer. `cyberpunk-topology-renderer.ts` is the entry; `cyberpunk/` subfolder has per-layer modules (component layer, packet layer, snake layer). `BrowserDriver` + `SimToRendererAdapter` (`src/sim-demo/`) bridge each sim frame to the renderer.

### Auth + progress (`src/auth/`)
Supabase-backed auth, leaderboard, game-progress persistence, login overlay, profile setup, nav bar. Runs without env vars (logs a warning and disables auth features).

### Playtest harness (`src/playtest/`)
Deterministic headless simulator: `run.ts` drives a topology through a wave, `scoring.ts` evaluates against SLA, `topology-builder.ts` is a compact DSL for defining inherited topologies (used by Diagnose levels).

## Source layout

```
src/
├── core/               # Legacy tick-step engine (still compiled/tested; NOT used by Physics TD)
├── sim/                # Physics sim engine — Sim.step(dt), packets, SimClient, snake, capabilities
├── capabilities/       # Legacy tick-model capability implementations (used by core/)
├── physics-td/         # Game logic: campaign, waves, chaos, UX, component metrics, diagnose-wave
├── diagnose/           # Diagnose-mode framework: controller, level schema, boot
├── chatbot/            # Browser-side chat client plumbing
├── auth/               # Supabase auth, leaderboard, profile, game progress
├── render/             # Cyberpunk isometric Pixi renderer
├── sim-demo/           # BrowserDriver, SimToRendererAdapter (sim → renderer bridge)
├── playtest/           # Headless runner + SLA scoring + topology builder
├── index.html          # Landing
├── levels.html         # Level selector
├── game.html           # Physics TD campaign
└── diagnose.html       # Diagnose mode entry
```

Supporting layout:
```
supabase/functions/stack-attack-chat/   # Deno edge function (Socratic tutor proxy → Claude)
supabase/migrations/                     # chatbot_conversations table
```

## Dashboard URLs

- `/` — Landing (PLAY → `/levels.html`)
- `/levels.html` — Level selector
- `/game.html` — Campaign (append `?wave=N` to jump, 1-indexed)
- `/diagnose.html` — Diagnose mode (append `?level=<id>` once levels ship)

## Next candidates

- **Diagnose content levels** — Instagram Level 1 and follow-ups. Framework is ready; needs level authoring + validation.
- **Chatbot UI integration** — wire `chat-client.ts` into the in-game HUD (Socratic hint overlay); add conversation history UI.
- **Topology validator** — block simulation start if a required request type has no handler path (e.g. Client → CDN → DB with no Server). Currently the wave runs and the loss modal is generic.
- **Auto-scale visuals** — current Wave 8 fires SCALE markers but there's no animation; render instance-count changes.
- **Tier upgrades UX** — scaling UP vs OUT as a player-facing decision.
- **Cross-zone replication teaching** — CAP theorem lesson for a Wave 9/10 slot.
- **Onboarding flow** — first-wave tutorial, palette intro, cursor prompts.

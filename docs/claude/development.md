# Development

## Tech stack

TypeScript + Pixi.js v8 + Vite. Supabase (auth + edge functions + Postgres). Deno for the one edge function (`supabase/functions/stack-attack-chat/`). No React, no Next.js. The legacy tick-step engine in `src/core/` is framework-agnostic TypeScript; the Physics TD game is built on the newer real-time `Sim` engine in `src/sim/`.

TypeScript is strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Branded IDs (`ComponentId`, `ConnectionId`, `PacketId`, `RequestId`) catch cross-domain mix-ups at the type layer.

## Source layout

Top-level:
- `src/sim/` — physics sim engine (`Sim.step(dt)`, packets, snake, capabilities, SLA)
- `src/physics-td/` — game logic: campaign, waves, chaos, UX, metrics, diagnose-wave hint engine
- `src/diagnose/` — Diagnose-mode controller + level schema + framework boot
- `src/chatbot/` — browser-side chat client (no UI yet)
- `src/render/` + `src/render/cyberpunk/` — Pixi v8 isometric renderer
- `src/sim-demo/` — `BrowserDriver` + `SimToRendererAdapter` bridge sim to renderer
- `src/auth/` — Supabase auth, leaderboard, profile, game progress
- `src/playtest/` — headless runner for Diagnose topology validation
- `src/core/` + `src/capabilities/` — legacy tick-step engine (still compiled/tested; Physics TD does not use this)

See `implementation-status.md` for what each produces.

## Commands

```bash
pnpm test                              # full suite (760 tests + 6 skipped, ~5s)
pnpm test tests/unit/<name>.test.ts    # single file (~1s)
pnpm typecheck                         # strict tsc --noEmit (2 pre-existing known errors)
pnpm dev                               # Vite at localhost:5173/
pnpm exec vite build                   # production build (there IS a "build" script, this also works)
```

- **Package manager:** `pnpm` (uses `pnpm-lock.yaml`).
- **Test layout:** vitest runs `tests/**/*.test.ts`. Unit in `tests/unit/`, integration in `tests/integration/`, mode-agnostic stubs in `tests/harness/`, playtest research in `tests/playtest/` (non-blocking). See `test-harness.md` for fixtures.
- **Path aliases:** `@core/*`, `@sim/*`, `@capabilities/*`, `@harness/*`. Must be mirrored in both `tsconfig.json` `paths` and `vite.config.ts` `resolve.alias` — changing one without the other silently breaks tests or typecheck.
- **Vite multi-entry:** `vite.config.ts` declares four HTML entries: `landing`, `levels`, `game`, `diagnose`. Adding a new HTML page requires updating `rollupOptions.input`.
- **TypeScript:** strict, ESM, `moduleResolution: bundler`. Relative imports use `.js` extension on `.ts` sources. Branded ID casts (`as ComponentId`) are required in test fixtures.

## Known-good typecheck floor

Two pre-existing errors unrelated to current work. Clean typecheck = exactly these two lines:

- `tests/unit/pull-from-buffers.test.ts:81` — `requestsPerTick` not on `FixedIntensityConfig`.
- `tests/unit/game/sim-to-renderer-adapter.test.ts:8` — missing `@dashboard/render/topology-renderer` alias (dashboard was removed, this test file wasn't).

If `pnpm typecheck` reports anything else, your changes introduced it.

## Session start — always fetch origin

`git fetch origin && git rev-list --count HEAD..origin/main`. If nonzero, rebase/branch off the new main before starting work. Critical when multiple agents are active — stale baselines silently create merge conflicts and duplicate fixes.

## Branching and pushing

- **Push feature branches at slice boundaries** (`git push -u origin feature/<name>`), not after every commit. Only when tests are green.
- **Before starting a new feature branch:** `git ls-remote origin 'refs/heads/feature/*'` to surface in-flight work that might conflict.
- **Tag a rollback anchor** (`git tag <stage>-pre-merge`) before non-trivial merges.

## Debugging heuristics

- **Vite forwards browser `console.warn` / `console.error` to dev server stdout.** Use `console.warn` (not `console.log`) for diagnostic output that should reach the terminal during `pnpm dev`. Tag with a prefix like `[sim]` / `[campaign]` for grep filtering.
- **Renderer bugs: dump sim events first, theorize second.** When the renderer looks wrong (wrong color, wrong packet on wrong edge), write a short unit test that runs a targeted `Sim.step(dt)` sequence and dumps `sim.lastStepEvents`. If the event sequence is correct, the bug is in the renderer bridge (`src/sim-demo/sim-to-renderer.ts`) or a Pixi layer, not the sim.
- **Pixi v8 API quirks:** `await app.init({...})` is async; `Graphics` uses `g.rect(x,y,w,h).fill(color)`; `Text` is `new Text({ text, style })`. No `beginFill`/`drawRect`.

# Development

## Tech stack

React + TypeScript + Pixi.js planned for the UI stage (not yet built). Simulation layer is **pure TypeScript, framework-agnostic** — no React, Next.js, or Vercel imports allowed until the UI stage. TypeScript's type system enforces the capability pattern at compile time; branded IDs and strict settings catch whole classes of bugs at the type layer.

## Source layout

- `src/core/` — engine, state, component, capability, types, mode interfaces, registry
- `src/core/engine/` — one file per tick step (29 files), plus helpers (rng, throughput, visit-order, etc.)
- `src/modes/sandbox/` — `SandboxModeController`, zone management, scenario system
- `src/modes/td/` — `TDModeController`, `TDEconomy`, `TDTrafficSource`, wave definitions
- `src/capabilities/` — concrete capability implementations (e.g. `ProcessingCapability`)
- `src/dashboard/` — Vite sandbox + TD dashboard

## Commands

```bash
pnpm test                              # run full suite (~6s, 645 tests)
pnpm test tests/unit/<name>.test.ts    # run a single file (~1s)
pnpm typecheck                         # strict tsc --noEmit
pnpm dev                               # start Vite dashboard
```

- **Package manager:** `pnpm` (uses `pnpm-lock.yaml`).
- **Test layout:** vitest runs `tests/**/*.test.ts`. Unit in `tests/unit/`, integration in `tests/integration/`, mode-agnostic stubs in `tests/harness/`. See `test-harness.md` for fixtures.
- **Path aliases:** `@core/*`, `@capabilities/*`, `@harness/*`. Must be mirrored in both `tsconfig.json` paths and `vitest.config.ts` resolve.alias — changing one without the other silently breaks tests or typecheck.
- **TypeScript:** strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. ESM — relative imports use `.js` extension on `.ts` sources (bundler moduleResolution). Branded IDs (`RequestId`, `ComponentId`, etc.) require `as RequestId` casts in test fixtures.
- **Specs and plans:** designs in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`. Phase 1 is built in sequential stages with explicit exit criteria — write the next stage's plan only after the previous stage merges and its interfaces are locked.
- **Phase 1 scope reminder:** pure TypeScript simulation. Vercel-plugin skill suggestions that fire on `package.json`/`tsconfig.json` writes are false positives in this phase.

## Session start — always fetch origin

`git fetch origin && git rev-list --count HEAD..origin/main`. If nonzero, rebase/branch off the new main before starting work. This is critical when multiple agents (yours and teammates') are active — stale baselines silently create merge conflicts and duplicate fixes. Re-fetch at the start of each new slice when executing a multi-task plan, not after every commit.

## Branching and pushing

- **Push feature branches proactively at slice boundaries.** When a meaningful unit of work completes (e.g. "Slice A done, all tests green"), `git push -u origin feature/<name>` (first push) or `git push` (subsequent). Not after every commit — too noisy. This makes WIP discoverable: teammates (and their agents) can `git ls-remote origin 'refs/heads/feature/*'` to see live branches before starting parallel work on the same files. Only push when tests are green.
- **Before starting a new feature branch:** `git ls-remote origin 'refs/heads/feature/*'` to surface any in-flight work that might conflict. If a teammate already has a branch touching the files you'd touch, coordinate before branching.
- **Tag a rollback anchor** (`git tag <stage>-pre-merge`) before non-trivial merges.

## Debugging heuristics

- **Vite forwards browser `console.warn` / `console.error` to dev server stdout.** Use `console.warn` (not `console.log`) for diagnostic output that should reach the terminal during `pnpm dev`. Tag with a prefix like `[td-tick]` / `[td-phase]` for grep filtering. Lets the controller debug the dashboard from the dev server log instead of needing copy-paste from browser DevTools.
- **Renderer bugs: dump the engine events first, theorize second.** When the dashboard looks wrong (wrong color, wrong component pulsing, dots on the wrong edge), write a one-tick unit test that constructs the suspect topology, runs `engine.tick(mc)` once, and dumps `state.lastTickEvents` filtered to the relevant request. If the event sequence is correct, the bug is in `state-to-renderer.ts` or `pixi-topology-renderer.ts` — not the engine. Stage 3c's "orange edges on cyan reads" bug took three wrong fixes (pool state, stroke bleed, temporal stagger) before a Wave-2 write-trace diagnostic test proved the engine emitted exactly one SERVED-at-Database with no spurious FORWARDEDs, which pointed directly at the renderer's simultaneous-spawn composite.
- **Wave duration ≠ total run ticks.** `WaveDefinition.duration` is the traffic-generation window only. The engine continues ticking after traffic stops until `isWaveDrained` returns true (queue empties or times out via TTL). UI tick counters must compute `tickInWave = state.currentTick - waveStartTick` and either cap at `wave.duration` or show a separate "draining" indicator past that point.

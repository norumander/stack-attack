# Stack Attack: System Architecture Tower Defense Game

A tower defense game that teaches system architecture through gameplay. Traffic is the enemy, infrastructure components are the towers, a live economy makes architecture decisions feel like business decisions. Strategy game first — the learning is the surprise.

**Current stage:** Physics TD is the shipping mode — 8-wave Netflix campaign (Launch → Viral Moment) covering reads, writes, async/batch, chaos, streaming, multi-zone routing, and auto-scale markers. Supporting systems landed: per-component live metrics + stress indicators (`component-metrics.ts`), component labels + info panel, Diagnose-mode framework (`src/diagnose/` — controller + level schema shipped, content levels not yet), AI chatbot backend (Supabase Edge Function → Claude, UI not yet wired), and a topology-builder DSL in `src/playtest/` for Diagnose levels. 760 tests passing (6 skipped). Typecheck has two pre-existing known errors — see `docs/claude/development.md`.

## Context hub

This file is intentionally small. Pull the chunk you need:

| File | Contents | Pull it when |
|---|---|---|
| `docs/claude/game-design.md` | Game concept, core design principles | Design discussions, framing new features |
| `docs/claude/implementation-status.md` | What ships, source layout, next candidates | Orienting before touching code |
| `docs/claude/development.md` | Tech stack, commands, test layout, path aliases, TypeScript config | Any dev task |
| `docs/claude/worktree-gotchas.md` | `node_modules` symlink, pnpm-after-merge, never-remove-current, subagent drift | Starting a new worktree or dispatching subagents |

## Always-apply rules

- **Use git worktrees for code changes.** Project-local at `.worktrees/<branch-name>`. See `docs/claude/worktree-gotchas.md` — especially "never `git worktree remove` the worktree you're currently in."
- **Only one `pnpm dev` per session.** Vite silently falls back to port 5174 if 5173 is held by another worktree — kill the old server via `lsof -ti:5173 | xargs kill` before starting a new one, or the browser will be pointing at stale code.
- **Session start: fetch origin.** `git fetch origin && git rev-list --count HEAD..origin/main`. If nonzero, rebase/branch off the new main before starting work. Critical when multiple agents are active.
- **Never commit unless explicitly asked.** New commits over amending. Never `--no-verify`, never force-push to main.
- **No React, Next.js, or Vercel imports in `src/core/` or `src/capabilities/`.** Enforced by `tests/unit/engine-pixi-isolation.test.ts`.
- **Ignore Vercel plugin hook noise.** The plugin injects Next.js / verification skill reminders on `vite` / `pnpm dev|build` regex matches — this is a local Vite + Pixi project, not Vercel/Next. Those reminders are false positives.
- **Pre-existing typecheck noise (2 lines):** `tests/unit/pull-from-buffers.test.ts:81` has a known unrelated error (`requestsPerTick` on `FixedIntensityConfig`), and `tests/unit/game/sim-to-renderer-adapter.test.ts:8` imports a missing `@dashboard/render/topology-renderer` alias. Clean typecheck = just those two lines.
- **`tests/playtest/*` is research/analysis, not production tests.** Can be deleted or rewritten without blocking a feature — separate from the `tests/unit/` and `tests/integration/` contract surface.

## Quickstart

```bash
pnpm test                              # full suite (~6s)
pnpm test tests/unit/<name>.test.ts    # single file (~1s)
pnpm typecheck                         # strict tsc --noEmit
pnpm dev                               # Vite dashboard
pnpm exec vite build                   # production build (no "build" script in package.json)
```

Dashboard URLs:
- `/` — Landing page (PLAY button → `/levels.html`)
- `/levels.html` — Level selector (one level card → `/game.html`)
- `/game.html` — Physics TD game (append `?wave=N` to jump, 1-indexed)

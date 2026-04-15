# BrainLift: System Architecture Tower Defense Game

A tower defense game that teaches system architecture through gameplay. Traffic is the enemy, infrastructure components are the towers, a live economy makes architecture decisions feel like business decisions. Strategy game first — the learning is the surprise.

**Current stage:** Phase 1, Stage 5b complete. TD mode is playable through Wave 10 — all 10 waves shipped. 762 tests, typecheck clean.

## Context hub

This file is intentionally small. Pull the chunk you need:

| File | Contents | Pull it when |
|---|---|---|
| `docs/claude/game-design.md` | Game concept, two modes, core design principles, nav to brainlift/architecture/wave-progression specs | Design discussions, framing new features |
| `docs/claude/implementation-status.md` | What ships (capability library, registry, TD stack, sandbox, stage summaries), next candidates, stage-history nav | Orienting before touching code |
| `docs/claude/development.md` | Tech stack, source layout, commands, test layout, path aliases, TypeScript config, Phase 1 scope, session-start rule, push/branch policy, rollback tags, Vite console tip, renderer-bug heuristic, wave-duration heuristic | Any dev task |
| `docs/claude/worktree-gotchas.md` | `node_modules` symlink, pnpm-after-merge, never-remove-current, subagent drift | Starting a new worktree or dispatching subagents |
| `docs/claude/simulation-tick.md` | 10-step tick reference + Stage 2a/2b/2c engine contract gotchas | Engine work, tick debugging |
| `docs/claude/test-harness.md` | `tests/harness/` fixtures + harness gotchas | Writing or fixing tests |
| `docs/claude/td-stage-gotchas.md` | Stage 3a/3b/3c + post-3b cleanup gotchas (TD controller, registry, dashboard, Pixi renderer) | TD mode, dashboard, or registry work |

## Always-apply rules

- **Use git worktrees for code changes.** Project-local at `.worktrees/<branch-name>`. See `docs/claude/worktree-gotchas.md` — especially "never `git worktree remove` the worktree you're currently in."
- **Only one `pnpm dev` per session.** Vite silently falls back to port 5174 if 5173 is held by another worktree — kill the old server via `lsof -ti:5173 | xargs kill` before starting a new one, or the browser will be pointing at stale code.
- **Session start: fetch origin.** `git fetch origin && git rev-list --count HEAD..origin/main`. If nonzero, rebase/branch off the new main before starting work. Critical when multiple agents are active.
- **Never commit unless explicitly asked.** New commits over amending. Never `--no-verify`, never force-push to main.
- **Pure TypeScript simulation in Phase 1.** No React, Next.js, or Vercel imports in `src/core/` or `src/capabilities/`. Enforced by `tests/unit/engine-pixi-isolation.test.ts`.
- **Ignore Vercel plugin hook noise.** The plugin injects Next.js / verification skill reminders on `vite` / `pnpm dev|build` regex matches — this is a local Vite + Pixi project, not Vercel/Next. Those reminders are false positives.

## Quickstart

```bash
pnpm test                              # full suite (~6s)
pnpm test tests/unit/<name>.test.ts    # single file (~1s)
pnpm typecheck                         # strict tsc --noEmit
pnpm dev                               # Vite dashboard
pnpm exec vite build                   # production build (no "build" script in package.json)
```

Dashboard URLs:
- `/` — classic sandbox
- `/#mode=td` — classic TD mode
- `/?renderer=iso#mode=td` — cyberpunk iso renderer + HUD overlay

# Worktree gotchas

Global rule (from `~/.claude/CLAUDE.md`): always use a git worktree for code changes.

Project-local convention: `git worktree add .worktrees/<branch> -b <branch>`. `.worktrees/` is gitignored.

## `node_modules` shortcut

`ln -sf /Users/normanettedgui/development/capstone/node_modules .worktrees/<name>/node_modules` lets a fresh worktree run `pnpm test` / `pnpm typecheck` immediately without a separate install. Remove the symlink before `git worktree remove` (or use `--force`).

## `pnpm install` required after merging a branch that added a dep

`pnpm add` in a worktree only updates that worktree's `node_modules`; main's copy still lacks the package even though `package.json` has it. The `node_modules` symlink above avoids this, but once you've replaced the symlink with a real install (e.g. because the worktree did its own `pnpm add`), the dep is trapped in the worktree until main explicitly installs.

Stage 3c's `pixi.js@8.17.1` hit this: merge landed cleanly, 645/645 tests green, then typecheck exploded on `Cannot find module 'pixi.js'`. After merging such a branch, run `pnpm install` in the main repo before `pnpm typecheck`.

## Never `git worktree remove` the worktree you're currently in

The Bash tool's shell spawns from its last cwd — once that directory is gone, every subsequent command (including `cd /elsewhere && ...`) hard-fails with "Working directory no longer exists" and the session has to restart.

Do worktree cleanup from a **different** cwd: run `git -C /Users/normanettedgui/development/capstone worktree remove .worktrees/<name>` with the Bash tool's current cwd already outside the worktree, or delegate to a subagent.

## Subagents and worktree drift

When dispatching subagents to work in a specific worktree, include the absolute path in EVERY git command in their prompt (e.g. `git -C /path/to/.worktrees/<branch> commit ...`). Subagents have their own shell state and may `cd` away from the worktree mid-task without realizing it, then commit to whatever branch the new cwd is on.

Stage 3b's CLAUDE.md update commit landed on `main` instead of `feature/stage-3b-spec` for exactly this reason.

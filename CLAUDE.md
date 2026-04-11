# BrainLift: System Architecture Tower Defense Game

## What This Is

A tower defense game that teaches system architecture through gameplay. User traffic is the enemy, infrastructure components are the towers, and a live economy (revenue per request, operational costs, budget constraints) makes architecture decisions feel like business decisions.

The game must stand on its own as a strategy game first. The learning is the long-term payoff; the fun is what gets players there. Position as a strategy game, let the architecture depth be the surprise.

**KSP analogy:** KSP doesn't teach aerospace engineering, but after playing it every orbital mechanics concept has an experiential anchor. We do the same for system architecture. A player who finishes this game and later encounters caching, load balancing, or sharding in a tutorial already has the intuition.

## Implementation status

**Current:** Phase 1, Stage 2a complete (merged into `main` at `b3fd0bc`). Stage 1 baseline (type contracts, `Component`, `SimulationState`, registries, `ModeController`/`EconomyStrategy`/`TrafficSource` interfaces, stub `ProcessingCapability`) plus full Stage 2a tick loop: 12-step `Engine.tick`, fixed-point `processPending` with throughput gate, real `deliverStaged` with backpressure/FORWARD/RESPOND/DROP/QUEUE_HOLD/SPAWN handling, strict cascade, TTL with parent-child cascades, active streams, per-tick metrics. Sandbox mode from a parallel branch also merged. 267 tests. **Next:** Stage 2b (fill in `updateCondition`/`injectChaos`/`deductUpkeep` stubs in `src/core/engine/stubs.ts`, condition effects, economy math).

## Two Modes, One Engine

- **TD Mode** (ships first): Game-first. Components expose limited capabilities through placement, connection, and upgrades. Waves test the player's architecture under pressure. Build → watch → assess → repeat. No mid-wave intervention.
- **Sandbox Mode** (designed-for from day one, built later): Full capability set unlocked. Player configures traffic, triggers chaos, explores tradeoffs without economic pressure.

Both modes share the same component system. A Database in TD has `StorageCapability(tier=1)` and flavor text; in Sandbox it exposes `SchemaCapability`, `ReplicationCapability`, and `QueryCapability`. The ModeController determines the aperture; components never know which mode they're in.

## Core Design Principles (one-liners)

- **Fun first** — learning is byproduct; anything that feels pedagogical gets cut.
- **Real terminology from day one** — "cache" not "memory cache." Montessori principle: the real word connects to every tutorial and job posting outside the game.
- **Tradeoffs, not right answers** — multi-axis scoring (cost, performance, reliability). The best architecture is the cheapest one that still performs under worst-case load.
- **Build → Watch → Assess** — no mid-wave intervention. Maps to how real engineering works (deploy, observe, diagnose, iterate). Auto-battler loop.
- **Wrong intuitions on purpose** — caches don't always help, load balancers don't always matter, queues trade latency for throughput. Open-ended levels with valid-tradeoff Pareto frontiers.

See `brainlift-system-architecture-game.md` for depth on purpose, SPOVs, and research grounding.

## Design documents (read on demand)

CLAUDE.md is a navigation hub. Pull detail from these when the task requires it:

- **`component-architecture.md`** — object model, 7 core abstractions, 4-phase execution pipeline (INTERCEPT/PROCESS/REPLICATE/OBSERVE), engine sub-interfaces (EngineConsultable/EngineBufferable), 10-step simulation tick, 13-component registry with key capabilities, extensibility contract, zones/multi-region, auto-scaling. Authoritative for engine design target.
- **`wave-progression-strategy.md`** — two scaling axes (intensity + diversity), 7 request types, 10-wave progression with architectural lessons, boss waves, economic pressure curve.
- **`brainlift-system-architecture-game.md`** — purpose, SPOVs, research insights, market analysis, design theory.
- **`docs/superpowers/specs/2026-04-10-tower-defense-foundation-design.md`** — Stage 1 foundation type contracts.
- **`docs/superpowers/specs/2026-04-10-stage-2a-tick-loop-core-design.md`** — Stage 2a engine contracts (1344 lines, authoritative for the implemented tick loop).
- **`docs/superpowers/plans/`** — implementation plans per stage.

## Simulation tick (10 steps, fixed order for determinism)

Quick reference. Full semantics in `component-architecture.md` and Stage 2a spec.

1. **INJECT TRAFFIC** — TrafficSource generates new requests.
2. **RE-EMIT QUEUED** — `reEmitQueued` drains `EngineBufferable` partitions back into pending / stagedOutcomes.
3. **PROCESS PENDING** — `processPending` + `deliverStaged` in a fixed-point loop (throughput-gated, quiesces or throws `FixedPointRunaway`).
3b. **OVERLOADED SWEEP** — leftover pending items get `OVERLOADED` events.
4b. **UPDATE ACTIVE STREAMS** — decrement `remainingDuration`, release on completion.
5. **CHECK TTL** — scan pending + blocked-pool for expired requests; fire parent/child cascades.
6. **UPDATE CONDITION** — stub in 2a.
6b. **INJECT CHAOS** — stub in 2a.
7. **DEDUCT UPKEEP** — stub in 2a.
8. **RECORD METRICS** — snapshot `perComponentThisTick` + pending/blocked/stream counts into `metricsHistory`.
9. **RESET PER-TICK STATE** — clear counters, bandwidth load, capability per-tick state. Asserts `stagedOutcomes` is empty.
10. **ADVANCE TICK** — `state.currentTick += 1`.

### Stage 2a engine contract gotchas

- `Engine` is constructor-bound to state: `new Engine(state)` + `engine.tick(mc)`. The Stage 1 `new Engine()` + `engine.tick(state, mc)` signature is gone.
- `deliverStaged` no longer treats `PASS` as FORWARD. Test components that need to forward must carry a real capability (e.g. `new ProcessingCapability(id, { outcomeKind: "FORWARD" })`); bare `makeComponent` clients fall through to PASS and requests are lost.
- `checkTTL` does not scan bufferable partitions (known limitation). Expired buffered requests get a one-tick grace period and time out on the next tick's pending scan. Closing this gap needs an `EngineBufferable.removeRequest(id)` interface extension.

## Tech Stack

React + TypeScript + Pixi.js planned for the UI stage (not yet built). Simulation layer is **pure TypeScript, framework-agnostic** — no React, Next.js, or Vercel imports allowed until the UI stage. TypeScript's type system enforces the capability pattern at compile time; branded IDs and strict settings catch whole classes of bugs at the type layer.

## Development workflow

```bash
pnpm test                              # run full suite (~3s, 267 tests)
pnpm test tests/unit/<name>.test.ts    # run a single file (~1s)
pnpm typecheck                         # strict tsc --noEmit
git worktree add .worktrees/<branch> -b <branch>   # isolated feature work
```

- **Package manager:** `pnpm` (uses `pnpm-lock.yaml`).
- **Test layout:** vitest runs `tests/**/*.test.ts`. Unit in `tests/unit/`, integration in `tests/integration/`, mode-agnostic stubs in `tests/harness/`.
- **Test harness fixtures** (`tests/harness/`):
  - `fixtures.ts` — `makeComponent`, `makePort`, `makeConnection`
  - `test-capabilities.ts` — `ForwardingCapability`, `RespondingCapability`, `BlockingDbCapability`, `TwoBlockingSpawnsCapability`, `DroppingCapability`, `TestQueueCapability` (EngineBufferable)
  - `random-topology.ts` — `makeRandomTopology(rng)` deterministic linear chains for property tests
  - `noop-mode-controller.ts`, `noop-economy.ts`, `fixed-intensity-traffic-source.ts` — minimal mode/traffic stubs
- **Path aliases:** `@core/*`, `@capabilities/*`, `@harness/*`. Must be mirrored in both `tsconfig.json` paths and `vitest.config.ts` resolve.alias — changing one without the other silently breaks tests or typecheck.
- **TypeScript:** strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. ESM — relative imports use `.js` extension on `.ts` sources (bundler moduleResolution). Branded IDs (`RequestId`, `ComponentId`, etc.) require `as RequestId` casts in test fixtures.
- **Specs and plans:** designs in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`. Phase 1 is built in sequential stages with explicit exit criteria — write the next stage's plan only after the previous stage merges and its interfaces are locked.
- **Phase 1 scope reminder:** pure TypeScript simulation. Vercel-plugin skill suggestions that fire on `package.json`/`tsconfig.json` writes are false positives in this phase.
- **Worktrees:** project-local at `.worktrees/<branch-name>` (gitignored).

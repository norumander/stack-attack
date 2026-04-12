# BrainLift: System Architecture Tower Defense Game

## What This Is

A tower defense game that teaches system architecture through gameplay. User traffic is the enemy, infrastructure components are the towers, and a live economy (revenue per request, operational costs, budget constraints) makes architecture decisions feel like business decisions.

The game must stand on its own as a strategy game first. The learning is the long-term payoff; the fun is what gets players there. Position as a strategy game, let the architecture depth be the surprise.

**KSP analogy:** KSP doesn't teach aerospace engineering, but after playing it every orbital mechanics concept has an experiential anchor. We do the same for system architecture. A player who finishes this game and later encounters caching, load balancing, or sharding in a tutorial already has the intuition.

## Implementation status

**Current stage:** Phase 1, Stage 2c complete. 406 tests, typecheck clean.

**What Stage 2c delivered** (merged into `main`):
- `EngineBufferable` gains `peekBuffered` + `removeRequest`; `checkTTL` Scan 3 expires buffered requests; cascade functions scan bufferables for siblings/children.
- SCALE side effects processed in `deliverStaged` with `minInstances`/`maxInstances` clamping and `SCALED` event emission; per-component `instanceCount` in metrics snapshot.
- `selectEgressConnection` computes real `effectiveTier` via `modeController`; new `RoutingCapability` in `src/capabilities/routing/` with T1 round-robin / T2 least-load / T3 condition-weighted.

**Next:** Stage 3 — no spec yet. Candidate work: implement remaining 23 capabilities and 14 component registry entries. Write the spec only after revisiting scope; Stage 3 is large and may need decomposition.

**History:** Stage-by-stage detail lives in `docs/superpowers/specs/` and `docs/superpowers/plans/` (see nav hub below).

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
- **`docs/superpowers/plans/2026-04-10-tower-defense-foundation-stage-1.md`** — Stage 1 implementation plan.
- **`docs/superpowers/specs/2026-04-10-stage-2a-tick-loop-core-design.md`** — Stage 2a engine contracts (1344 lines, authoritative for the implemented tick loop).
- **`docs/superpowers/plans/2026-04-10-stage-2a-tick-loop-core.md`** — Stage 2a implementation plan.
- **`docs/superpowers/specs/2026-04-11-stage-2b-condition-chaos-upkeep-design.md`** — Stage 2b condition/chaos/upkeep contracts.
- **`docs/superpowers/plans/2026-04-11-stage-2b-condition-chaos-upkeep.md`** — Stage 2b implementation plan (16 TDD tasks).
- **`docs/superpowers/specs/2026-04-12-stage-2c-ttl-scale-routing-design.md`** — Stage 2c bufferable TTL, SCALE processing, RoutingCapability contracts.
- **`docs/superpowers/plans/2026-04-12-stage-2c-ttl-scale-routing.md`** — Stage 2c implementation plan (13 TDD tasks).

## Simulation tick (10 steps, fixed order for determinism)

Quick reference. Full semantics in `component-architecture.md` and Stage 2a spec.

1. **INJECT TRAFFIC** — TrafficSource generates new requests.
2. **RE-EMIT QUEUED** — `reEmitQueued` drains `EngineBufferable` partitions back into pending / stagedOutcomes.
3. **PROCESS PENDING** — `processPending` + `deliverStaged` in a fixed-point loop (throughput-gated, quiesces or throws `FixedPointRunaway`).
3b. **OVERLOADED SWEEP** — leftover pending items get `OVERLOADED` events.
4b. **UPDATE ACTIVE STREAMS** — decrement `remainingDuration`, release on completion, credit stream revenue at `STREAM_COMPLETED`.
5. **CHECK TTL** — scan pending + blocked-pool for expired requests; fire parent/child cascades.
6. **UPDATE CONDITION** — decay/recover `component.condition` from per-tick drop/timeout/overloaded/backpressured counters.
6b. **INJECT CHAOS** — sweep expired → insert new from `mc.getScheduledChaos` → re-apply instant effects (`component_failure`, `zone_outage`).
7. **DEDUCT UPKEEP** — sum `getUpkeepCost × getUpkeepMultiplier` across components, debit economy, resolve insolvency → `setCondition(id, 0)`.
8. **RECORD METRICS** — snapshot `perComponentThisTick` + pending/blocked/stream counts + `revenueEarnedThisTick`/`upkeepPaidThisTick`/per-component `condition` into `metricsHistory`.
9. **RESET PER-TICK STATE** — clear counters, bandwidth load, capability per-tick state. Asserts `stagedOutcomes` is empty.
10. **ADVANCE TICK** — `state.currentTick += 1`.

### Stage 2a engine contract gotchas

- `Engine` is constructor-bound to state: `new Engine(state)` + `engine.tick(mc)`. The Stage 1 `new Engine()` + `engine.tick(state, mc)` signature is gone.
- `deliverStaged` no longer treats `PASS` as FORWARD. Test components that need to forward must carry a real capability (e.g. `new ProcessingCapability(id, { outcomeKind: "FORWARD" })`); bare `makeComponent` clients fall through to PASS and requests are lost.
- `checkTTL` now scans bufferable partitions (Stage 2c closed this gap). See Stage 2c gotchas below for the `EngineBufferable.peekBuffered`/`removeRequest` interface extension.
- `reEmitQueued` re-tags re-emitted staged outcomes with `sourceComponentId = the buffer holder`, not the original forwarder. When designing backpressure topologies, buffered requests re-enter the pipeline as if they originated at the buffer component, which affects how downstream routing/egress selection sees them.

### Stage 2b engine contract gotchas

- **One file per tick step.** `updateCondition`, `injectChaos`, `deductUpkeep` each live in their own file under `src/core/engine/` (matching `process-pending.ts`, `check-ttl.ts`, etc.). No "stubs.ts" umbrella.
- **`condition-effects.ts` is the single source of truth** for reading active `ConditionEffect`s off a `Component`. Never re-implement `getActiveConditionEffects`/`getUpkeepMultiplier`/`getThroughputMultiplier`/`getDropProbability`/`getLatencyMultiplier` inline — import from there.
- **`effective-bandwidth.ts` is the sole `Connection.latency` reader** in `src/core/engine/` (it hosts both `getEffectiveBandwidth` and `getEffectiveLatency`). Enforced by a grep invariant test in `tests/unit/effective-latency.test.ts`. Route new latency reads through `getEffectiveLatency(state, connId)`.
- **Drop-probability RNG uses a per-request key** (`` `tick-${T}|${componentId}|drop|${reqId}` ``), not the shared component RNG from `buildProcessContext`. This keeps healthy-path (condition=1.0 → dropP=0 → no RNG call) Stage 2a replay determinism byte-identical. Don't consolidate these RNG streams.
- **`deliverStaged` requires `modeController`** as its final parameter. Tests calling it directly must construct a `NoOpModeController` (`tests/harness/noop-mode-controller.ts`). The production path threads it through `runFixedPointLoop`.

### Stage 2c engine contract gotchas

- **`EngineBufferable` requires `peekBuffered` + `removeRequest`.** The `isEngineBufferable` type guard now checks for `peekBuffered` in addition to `enqueueForRetry`. Implementations that lack the new methods will not pass the guard. Inline mocks in test files must stub both methods.
- **`peekBuffered()` must return a defensive copy.** Callers iterate the returned array while calling `removeRequest()`. A live view would corrupt during iteration. `TestQueueCapability` uses a `Map<RequestId, ...>` internally for O(1) removal and returns `[...buffer.values()]` from `peekBuffered`.
- **`selectEgressConnection` takes `modeController`, not `ProcessContext`.** The old placeholder `ProcessContext` with `effectiveTier: 0` is gone. The function computes the real effective tier for the discovered `EngineConsultable` capability via `getEffectiveTier(source, cap.id, modeController)` and builds a fresh context inline.
- **SCALE side effects target `sourceComponentId` only.** No `targetComponentId` field exists on the `SideEffect` type. Cross-component scaling (if needed in Stage 3) requires extending the type.
- **SCALE takes effect on the next `processPending` pass within the same tick.** `setInstanceCount` mutates `component.instanceCount` synchronously inside `deliverStaged`, but `processPending` captures `rawCap = componentThroughputPerTick(component)` once at the top of its per-component loop — so throughput doesn't re-read within the same pass. The next iteration of the `runFixedPointLoop` picks up the new budget. Upkeep scales on the same tick via step 7 (`deductUpkeep` reads `instanceCount` directly).
- **`deliverStaged` side-effects loop checks SCALE before SPAWN.** The previous `if (se.kind !== "SPAWN") continue;` skip pattern is preserved for SPAWN, but a new `if (se.kind === "SCALE") { ... continue; }` block runs before it.
- **`RoutingCapability` lives at phase `INTERCEPT` with `canHandle() => false`.** It's invisible in the processing pipeline. The engine discovers it solely via `isEngineConsultable()` in `egress-selection.ts`. Same pattern as `TestQueueCapability`.
- **T3 routing scores `condition * max(0, 1 - load/bandwidth)`.** When all scores are 0 (fully saturated), falls back to round-robin using the capability's own cursor (not the engine's `state.roundRobinCursor`).
- **Recursive grandchild cascade gap persists.** `applyStrictCascade`'s recursive path for when a cancelled sibling is itself a blocking parent still does not scan pending/bufferables for grandchildren (`TODO(stage-2b)` in `cascade.ts`). Grandchildren stuck in bufferables time out via Scan 3 on the next tick.
- **New files:** `src/capabilities/routing/routing-capability.ts`, `tests/harness/scaling-capability.ts`.

## Tech Stack

React + TypeScript + Pixi.js planned for the UI stage (not yet built). Simulation layer is **pure TypeScript, framework-agnostic** — no React, Next.js, or Vercel imports allowed until the UI stage. TypeScript's type system enforces the capability pattern at compile time; branded IDs and strict settings catch whole classes of bugs at the type layer.

**Source layout:**
- `src/core/` — engine, state, component, capability, types, mode interfaces, registry
- `src/core/engine/` — one file per tick step (29 files), plus helpers (rng, throughput, visit-order, etc.)
- `src/modes/sandbox/` — `SandboxModeController`, zone management, scenario system
- `src/capabilities/` — concrete capability implementations (e.g. `ProcessingCapability`)

## Development workflow

```bash
pnpm test                              # run full suite (~3s, 406 tests)
pnpm test tests/unit/<name>.test.ts    # run a single file (~1s)
pnpm typecheck                         # strict tsc --noEmit
git worktree add .worktrees/<branch> -b <branch>   # isolated feature work
```

- **Package manager:** `pnpm` (uses `pnpm-lock.yaml`).
- **Test layout:** vitest runs `tests/**/*.test.ts`. Unit in `tests/unit/`, integration in `tests/integration/`, mode-agnostic stubs in `tests/harness/`.
- **Test harness fixtures** (`tests/harness/`):
  - `fixtures.ts` — `makeComponent`, `makePort`, `makeConnection`
  - `test-capabilities.ts` — `ForwardingCapability`, `RespondingCapability`, `BlockingDbCapability`, `TwoBlockingSpawnsCapability`, `DroppingCapability`, `TestQueueCapability` (EngineBufferable)
  - `scaling-capability.ts` — `TestScalingCapability` emits SCALE side effect per request (Stage 2c+)
  - `random-topology.ts` — `makeRandomTopology(rng)` deterministic linear chains for property tests
  - `noop-mode-controller.ts`, `noop-economy.ts`, `fixed-intensity-traffic-source.ts` — minimal mode/traffic stubs
  - `test-economy.ts` — `TestEconomyStrategy` with `creditLog`/`debitLog` + configurable `revenuePerRequest`/`insolvencyRule`
  - `test-chaos-controller.ts` — `TestChaosController` wraps `NoOpModeController` with a scripted `Map<tick, ChaosEvent[]>`
- **Test harness gotchas:**
  - `NoOpModeController` constructor takes `{ targetEntryPointId, intensity, requestType }` (from `FixedIntensityConfig`), not `{ requestsPerTick, originComponentId }`.
  - `FixedIntensityTrafficSource` hardcodes `ttl: 10` on generated requests — not configurable. TTL-sensitive tests must live within that window or inject requests manually.
  - Populate `state.visitOrder` before running engine steps in unit tests: `state.visitOrder.push(...computeVisitOrder(state.components))`. Not `buildVisitOrder`.
  - Heterogeneous capability maps need explicit typing: `new Map<CapabilityId, Capability>()` + `.set(...)`. Inline `new Map([[a, capA], [b, capB]])` narrows to the first capability subclass.
  - `readonly` fields on `Component` (e.g. `minInstances`, `maxInstances`) are TS-only; tests can override at runtime via `(comp as { maxInstances: number }).maxInstances = 5`.
- **Path aliases:** `@core/*`, `@capabilities/*`, `@harness/*`. Must be mirrored in both `tsconfig.json` paths and `vitest.config.ts` resolve.alias — changing one without the other silently breaks tests or typecheck.
- **TypeScript:** strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. ESM — relative imports use `.js` extension on `.ts` sources (bundler moduleResolution). Branded IDs (`RequestId`, `ComponentId`, etc.) require `as RequestId` casts in test fixtures.
- **Specs and plans:** designs in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`. Phase 1 is built in sequential stages with explicit exit criteria — write the next stage's plan only after the previous stage merges and its interfaces are locked.
- **Phase 1 scope reminder:** pure TypeScript simulation. Vercel-plugin skill suggestions that fire on `package.json`/`tsconfig.json` writes are false positives in this phase.
- **Worktrees:** project-local at `.worktrees/<branch-name>` (gitignored).

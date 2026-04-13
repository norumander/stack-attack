# BrainLift: System Architecture Tower Defense Game

## What This Is

A tower defense game that teaches system architecture through gameplay. User traffic is the enemy, infrastructure components are the towers, and a live economy (revenue per request, operational costs, budget constraints) makes architecture decisions feel like business decisions.

The game must stand on its own as a strategy game first. The learning is the long-term payoff; the fun is what gets players there. Position as a strategy game, let the architecture depth be the surprise.

**KSP analogy:** KSP doesn't teach aerospace engineering, but after playing it every orbital mechanics concept has an experiential anchor. We do the same for system architecture. A player who finishes this game and later encounters caching, load balancing, or sharding in a tutorial already has the intuition.

## Implementation status

**Current stage:** Phase 1, Stage 3a complete. 466 tests, typecheck clean.

**What Stage 3a delivered** (merged into `main`):
- 5 production capabilities: `ProcessingCapability` (rewritten from Stage 1 stub — reads only, bounded throughput), `ForwardingCapability` (configurable `handledTypes` + `throughputPerTier`, emits source-side FORWARDED events), `StorageCapability` (writes only), `CachingCapability` (INTERCEPT, hit=RESPOND / miss=PASS, FIFO eviction, cache-on-miss shortcut), `MonitoringCapability` (OBSERVE ceremonial).
- 4 registered component types in `src/modes/td/td-component-entries.ts`: Server (Processing + Forwarding + Monitoring), Database (Storage + Monitoring), Cache (Caching + Forwarding + Monitoring), LoadBalancer (Routing + Forwarding + Monitoring). Bootstrap via `registerTDDefaults()`.
- New `src/modes/td/` mode stack: `TDEconomy`, `TDTrafficSource` (distinguishable payload pool for realistic cache working set), `TDModeController` (full `ModeController` interface; `evaluateOutcome` returns proper `OutcomeReport { verdict, score, notes }`).
- 3 wave definitions: `WAVE_1` (10 req/tick reads), `WAVE_2` (25 req/tick 70/30 mix), `WAVE_3` (50 req/tick, TTL 8).
- 4 integration tests in `tests/integration/td/`: Wave 1 passes with single Server, Wave 2 passes with Server→Database + write-routing verified via capability-emitted FORWARDED events at source, Wave 3 lone-server **loses** as required, Wave 3 cache-rescue and LB-rescue **both win** (learning arc validated).
- Throughput tuning: Server = Processing(20) + Forwarding-for-writes(12) = 32/tick; Cache/LB Forwarding = 55/tick; Database Storage = 25/tick. Wave 3 cache rescue hits ~65% (682 hits of 1050 reads); LB rescue distributes 49.9%/50.1% round-robin.
- Zero engine modifications — all new behavior lives in capabilities and mode code.

**Stage 3a engine contract gotchas**:
- **`PROCESSED` events are capability-emitted, never engine-emitted.** The engine declares `"PROCESSED"` in `RequestEventType` but never emits one. `ProcessingCapability` and `StorageCapability` emit their own PROCESSED events inside `process()` so integration tests can count "who handled this request." If a capability returns `events: []`, nothing counts it as processed.
- **`FORWARDED` events come from two sources.** The engine's `deliverStaged` emits a `FORWARDED` event at the target component with `capabilityId: null` (delivery-side). `ForwardingCapability` emits its own `FORWARDED` at the source component with `capabilityId: this.id` (source-side). Integration test helpers filter `ev.capabilityId !== null` to count source-side "who originated this forward."
- **PASS at PROCESS phase is a silent drop.** `deliverStaged`'s switch statement has `default: return false` for any outcome that isn't RESPOND/FORWARD/DROP/QUEUE_HOLD. A component whose PROCESS phase has no matching `canHandle` capability produces `outcome: PASS` and the request vanishes with no event. This is why Stage 3a needs `ForwardingCapability` as an explicit primitive — "let the request fall through to egress" is not a pipeline behavior.
- **`componentThroughputPerTick` sums all PROCESS capabilities on a component.** A Server with `ProcessingCapability(throughput=20)` + `ForwardingCapability(throughput=12)` has a total budget of 32 req/tick, shared between reads and writes. `ForwardingCapability` is configurable per-instance via `throughputPerTier` so the same class can contribute 12 on a Server (writes only) or 55 on a LoadBalancer (all traffic).
- **Registry-instantiated capability instances are ceremony in Stage 3a.** Integration tests build components via `buildServer` / `buildDatabase` / `buildCache` / `buildLoadBalancer` helpers in `tests/integration/td/helpers.ts`, which construct real `Component` objects with per-instance capability configuration. The registry factories (in `registerTDDefaults`) are only exercised by `ComponentRegistry.validate()` — they never run in an actual wave simulation.
- **`SandboxModeController.tryPlace` and `TDModeController.tryPlace` are stubs.** They increment counters and return fake IDs without touching `state.components`. Integration tests place components directly via `state.placeComponent()`. `tryPlace` exists for eventual UI-driven placement but is not exercised at test time.

**Next:** Stage 3b — TBD. Candidates (no spec yet):
- **UI stage** (React + Pixi.js). The whole point of Stage 3a was to prove the engine was worth rendering. Now validated.
- **Intra-wave satisfaction pressure.** Stage 3a gates on `dropThreshold` at wave-end only. No mid-wave satisfaction bar / lives / per-drop revenue penalty. Needs its own brainstorm to choose the mechanic — best designed once the UI can show live feedback.
- **Remaining ~18 capabilities + ~9 components** from `component-architecture.md`: Auth, RateLimit, CircuitBreaker, Replication, Sharding, Search, Streaming, Blob, Batch, Queue-production, Filter, GeoRouting, AutoScale, SSL, Compression, Retry, Registration, HealthCheck, Logging + CDN, APIGateway, ServiceRegistry, Worker, CircuitBreaker component, DNSGlobalTrafficManager, BlobStorage, StreamingMediaServer, Message Queue.

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

# Simulation tick

10-step reference for the engine tick loop. Full semantics in `component-architecture.md` and the Stage 2a spec.

## 10 steps (fixed order for determinism)

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

## Stage 2a engine contract gotchas

- `Engine` is constructor-bound to state: `new Engine(state)` + `engine.tick(mc)`. The Stage 1 `new Engine()` + `engine.tick(state, mc)` signature is gone.
- `deliverStaged` no longer treats `PASS` as FORWARD. Test components that need to forward must carry a real capability (e.g. `new ProcessingCapability(id, { outcomeKind: "FORWARD" })`); bare `makeComponent` clients fall through to PASS and requests are lost.
- `checkTTL` now scans bufferable partitions (Stage 2c closed this gap). See Stage 2c gotchas below for the `EngineBufferable.peekBuffered`/`removeRequest` interface extension.
- `reEmitQueued` re-tags re-emitted staged outcomes with `sourceComponentId = the buffer holder`, not the original forwarder. When designing backpressure topologies, buffered requests re-enter the pipeline as if they originated at the buffer component, which affects how downstream routing/egress selection sees them.

## Stage 2b engine contract gotchas

- **One file per tick step.** `updateCondition`, `injectChaos`, `deductUpkeep` each live in their own file under `src/core/engine/` (matching `process-pending.ts`, `check-ttl.ts`, etc.). No "stubs.ts" umbrella.
- **`condition-effects.ts` is the single source of truth** for reading active `ConditionEffect`s off a `Component`. Never re-implement `getActiveConditionEffects`/`getUpkeepMultiplier`/`getThroughputMultiplier`/`getDropProbability`/`getLatencyMultiplier` inline — import from there.
- **`effective-bandwidth.ts` is the sole `Connection.latency` reader** in `src/core/engine/` (it hosts both `getEffectiveBandwidth` and `getEffectiveLatency`). Enforced by a grep invariant test in `tests/unit/effective-latency.test.ts`. Route new latency reads through `getEffectiveLatency(state, connId)`.
- **Drop-probability RNG uses a per-request key** (`` `tick-${T}|${componentId}|drop|${reqId}` ``), not the shared component RNG from `buildProcessContext`. This keeps healthy-path (condition=1.0 → dropP=0 → no RNG call) Stage 2a replay determinism byte-identical. Don't consolidate these RNG streams.
- **`deliverStaged` requires `modeController`** as its final parameter. Tests calling it directly must construct a `NoOpModeController` (`tests/harness/noop-mode-controller.ts`). The production path threads it through `runFixedPointLoop`.

## Stage 2c engine contract gotchas

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

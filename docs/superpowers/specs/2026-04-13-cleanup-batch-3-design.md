# Cleanup Batch 3 — TD test consolidation, single-wave shim removal, engine helpers

**Status:** Draft. Pick up in a fresh session.
**Branch off:** `main` at or after commit `726c7fd` (post-Batch-1-2 merge).
**Test baseline:** 582 tests, typecheck clean.

## Context

Batches 1 and 2 of the post-Stage-3b code review pass have shipped. This
spec covers Batch 3 — the higher-blast-radius P1 refactors that touch
`tests/integration/td/helpers.ts` and the `TDModeController` option union,
both of which are used by every TD wave test.

Read first:
- `CLAUDE.md` — full project context, especially the "Post-3b cleanup pass
  gotchas" section.
- `tests/integration/td/helpers.ts` — `runWave`, `buildServer`,
  `buildDatabase`, `buildCache`, `buildLoadBalancer`, `wire`.
- `src/modes/td/td-mode-controller.ts` — the `TDMultiWaveOptions` /
  `TDSingleWaveOptions` discriminated union and `STUB_REGISTRY`.
- `src/modes/td/register-td-defaults.ts` — the production registry
  factories that already match `helpers.ts:buildX` byte-for-byte (this is
  the smell P1-9 targets).
- `tests/harness/td-fixtures.ts` — `makeRng`, `bootTDRegistry`,
  `makeTDController` (Batch 2 added these).
- `src/core/engine/cascade.ts` — the duplicated pending+bufferable scan
  block (P1-11).
- `src/dashboard/main.ts:bootTDMode` and
  `tests/integration/td/campaign-headless.test.ts` — both reconstruct
  `new Engine(state)` per wave for visit-order refresh (P1-15).

## Goals

Five P1 items, ordered for execution. Each can land as its own commit.
The first two are linked (10 enables 9); 11, 13, 15 are independent.

### P1-10 — Delete the single-wave back-compat shim

**The smell.** `TDModeController` has a discriminated union:

```ts
export type TDModeControllerOptions =
  | TDMultiWaveOptions
  | TDSingleWaveOptions;
```

Discriminated via `"waves" in options`. The single-wave path uses a
`STUB_REGISTRY` at the top of `td-mode-controller.ts` that throws on
`tryCreate`. Two consumers:

1. `tests/integration/td/helpers.ts:runWave` — passes
   `{wave, economy, entryPointId, rng}` (no registry).
2. `tests/unit/td-mode-controller.test.ts` — **already deleted in
   Batch 2** (P0-5).

So `runWave` is the only remaining consumer. Once `runWave` migrates to
the multi-wave shape (which it can do trivially — pass `[wave]`), the
shim can be deleted entirely.

**Plan.**

1. Rewrite `runWave` to construct `TDModeController` with
   `{waves: [wave], economy, entryPointId, rng, componentRegistry}`.
   Source the registry from `bootTDRegistry()` (already in
   `tests/harness/td-fixtures.ts`).
2. Verify all four wave tests
   (`tests/integration/td/wave-1-trivial-server.test.ts`,
   `wave-2-server-database.test.ts`, `wave-3-traffic-spike.test.ts`,
   `wave-3-learning-arc.test.ts`) still pass — `runWave` is the only
   thing they use.
3. Delete `STUB_REGISTRY`, `TDSingleWaveOptions`, the discriminated
   union, and the `"waves" in options` branch in the constructor.
   `TDModeControllerOptions` becomes a single type alias for the
   multi-wave shape.
4. Update CLAUDE.md gotcha list — remove the "single-wave back-compat
   shim" mention.

**Tradeoff.** `runWave` becomes one line longer per call site (pass the
registry). The class loses ~25 lines and a sharp edge.

**Watch out for.** The discriminated union also affects the constructor
signature inference in any test that uses object spread — none today,
but grep `new TDModeController({` to be sure. `runWave`'s seed path
uses `makeRng(1)` which is now in `@harness/td-fixtures`.

### P1-9 — Helpers ↔ registry construction unification

**The smell.** CLAUDE.md flags this explicitly:

> `registerTDDefaults` now produces TD-tuned capability factories that
> match `helpers.ts:buildServer/...` byte-for-byte — a dashboard-placed
> Server has the same runtime behavior as a harness-built one.

Two sources of truth for the same component shape. Stage 3b proved they
match by tuning them in lockstep, but any future change to one must be
mirrored to the other or the dashboard and the wave tests silently
diverge.

**The shapes that are duplicated.** `helpers.ts` exports:
- `buildServer(id)` → `Component` with Processing(`{handledTypes:["api_read"], throughputPerTier:20, emitProcessedEvent:true}`) + Forwarding(`{handledTypes:["api_write"], throughputPerTier:12, emitForwardedEvent:true}`) + Monitoring.
- `buildDatabase(id)` → Storage(`{throughputPerTier:25, emitProcessedEvent:true}`) + Monitoring.
- `buildCache(id)` → Caching + Forwarding(`{handledTypes:["api_read","api_write"], throughputPerTier:55, emitForwardedEvent:true}`) + Monitoring.
- `buildLoadBalancer(id, egressCount)` → Routing + Forwarding(same shape as Cache) + Monitoring.

`registerTDDefaults` constructs the same capability instances via the
factory closures registered with `CapabilityRegistry`.

**Plan.**

1. Migrate `buildServer/Database/Cache` to call
   `compRegistry.create(type, {x:0,y:0}, null)` and return the resulting
   `Component`. The factory closures already build the right
   capabilities; `helpers.ts` just needs the registry.
2. `buildLoadBalancer` is harder — it takes `egressCount` and the
   registry's `LOAD_BALANCER` entry has a fixed port count. Either:
   - (a) extend the registry entry with a `portConfig` callback so the
     factory accepts the egress count, OR
   - (b) leave `buildLoadBalancer` as-is and migrate only the other
     three. (Probably this — touching `LOAD_BALANCER`'s factory ripples
     into the dashboard.)
3. Update each `buildX` to accept a `compRegistry` parameter.
4. Update `runWave` (post-P1-10) to thread `compRegistry` through to
   each `buildX` call site in the wave tests.
5. Delete the now-unused capability imports from `helpers.ts`.
6. Update CLAUDE.md gotcha — remove "byte-for-byte" sync language.

**Tradeoff.** Wave tests become slightly less isolated (they now
depend on `registerTDDefaults` correctness), but divergence risk drops
to zero. The `buildLoadBalancer` exception is a known limitation that
Stage 3c can clean up alongside multi-port disambiguation.

**Watch out for.** The `buildX` functions return
`{component, ingressPortId, egressPortId(s)}` — the registry-built
component still exposes `ports`, so callers can derive these via
`component.ports.find(p => p.direction === ...)`. Keep the same return
shape so `wire()` doesn't change.

### P1-11 — Cascade scan dedup

**The smell.** `src/core/engine/cascade.ts` has the same
"find a request id by scanning pending then bufferables, then remove
it" block in two places:

- `applyStrictCascade` lines ~58–87
- `cascadeParentTimeoutToChildren` lines ~147–175

Both walk `state.pending`, then the `EngineBufferable` partitions on
every visit-order component, and remove the request from whichever
partition holds it.

**Plan.**

1. Extract `findAndRemoveRequestById(state, id): ComponentId | null`
   into `cascade.ts` (or `src/core/engine/find-request.ts` if it ends
   up shared with `check-ttl.ts`).
2. Both call sites become a single call.
3. Tests should not need updating — `tests/unit/cascade*.test.ts` cover
   the contracts, not the internal scan logic.

**Tradeoff.** One layer of indirection in two error paths. Worth it for
the deduplication.

### P1-13 — Wave 3 test overlap

**The smell.** `tests/integration/td/campaign-headless.test.ts` plays
Waves 1–3 end-to-end via the registry path — it covers the same
win/lose verdicts as `wave-3-traffic-spike.test.ts` and
`wave-3-learning-arc.test.ts`.

**Audit before deleting.** Read all three files and identify:
- What `wave-3-traffic-spike.test.ts` asserts that
  `campaign-headless.test.ts` doesn't.
- What `wave-3-learning-arc.test.ts` asserts that
  `campaign-headless.test.ts` doesn't.

The original review said `wave-3-learning-arc.test.ts` has unique
fairness asserts (per-component processed counts + distribution) that
`campaign-headless` doesn't have. `wave-3-traffic-spike.test.ts` is
suspected to be fully subsumed.

**Plan.**

1. Verify the audit findings by running each test file in isolation
   and reading the assertions.
2. If `wave-3-traffic-spike.test.ts` is fully subsumed → delete it.
3. If `wave-3-learning-arc.test.ts` has unique asserts → keep, but
   consider extracting just those asserts into a smaller focused file.
4. Document the deletions in CLAUDE.md (count delta).

**Watch out for.** Don't delete a test that exercises a code path no
other test covers, even if the verdict assertion is duplicated. Read
every assertion before nuking.

### P1-15 — `state.recomputeVisitOrder()` helper

**The smell.** `Engine` constructor is currently the only place
`visitOrder` is computed (via `computeVisitOrder(state.components)`).
Two production call sites reconstruct `new Engine(state)` per wave just
to refresh the visit order:

- `src/dashboard/main.ts:bootTDMode` — `engine = new Engine(state);`
  inside the `onPhaseChange` handler when entering simulate.
- `tests/integration/td/campaign-headless.test.ts` — same pattern.

**Plan.**

1. Add `state.recomputeVisitOrder()` to `SimulationState` — it calls
   `computeVisitOrder(this.components)` and writes the result to
   `this.visitOrder`.
2. The `Engine` constructor still calls it on construction (no behavior
   change there).
3. Dashboard and `campaign-headless.test.ts` swap
   `engine = new Engine(state)` for `state.recomputeVisitOrder()` and
   reuse the existing engine instance.
4. Test: a unit test asserting that `recomputeVisitOrder` after
   `placeComponent` gives the same ordering as a fresh `Engine`.
5. Update CLAUDE.md gotcha — note that visit-order refresh now has a
   first-class API.

**Tradeoff.** Splits the "visit order is computed exactly once"
invariant across two call sites, but the invariant is already violated
de-facto by the reconstruct-per-wave pattern. The helper makes the
intent explicit.

**Watch out for.** The dashboard's per-wave reset also passes the live
engine to `tdLoop.reset(engine, state, controller)`. With this change,
the same engine reference can be reused — `simLoop.reset` accepts a
fresh engine but doesn't have to. Verify `SimLoop.reset` doesn't
require a new instance.

## Out of scope

- New test infrastructure beyond `tests/harness/td-fixtures.ts`.
- Any change to `runFixedPointLoop`, `processPending`, or the deeper
  engine pipeline.
- Stage 3c features (auth waves, rate-limit waves, tier upgrades,
  multi-port disambiguation, cross-wave budget carry-over, etc.).
- The `forwarding-pipe` vs `forwarding` capability id split between TD
  Client and sandbox Client (P1-12 from the original review).

## Suggested execution order

1. **P1-10** first — cleanest deletion, unblocks P1-9.
2. **P1-9** second — depends on P1-10 because `runWave` becomes the
   migration vehicle.
3. **P1-11**, **P1-13**, **P1-15** in any order — independent.

Run `pnpm test && pnpm typecheck` after each item. Commit per item.
Push at slice boundaries (after P1-10+9 land, then after the rest).

## Definition of done

- 580ish tests green (count may drift down by 1–3 from P1-13 deletions).
- `pnpm typecheck` clean.
- `STUB_REGISTRY` and `TDSingleWaveOptions` deleted.
- `helpers.ts` no longer imports capability classes directly.
- `state.recomputeVisitOrder()` exists and is used by the dashboard +
  `campaign-headless.test.ts`.
- CLAUDE.md updated to reflect post-batch-3 contracts.

## Open questions for the new session

- **Should `buildLoadBalancer` migrate to the registry?** Depends on
  whether extending `LOAD_BALANCER`'s factory to accept variable egress
  count is cleaner than leaving `buildLoadBalancer` as a one-off. Pick
  whichever feels less invasive.
- **Is there a third place that scans pending+bufferables that should
  fold into `findAndRemoveRequestById`?** Check `check-ttl.ts` while
  doing P1-11.
- **Does `SimLoop.reset` strictly need a fresh engine, or can it accept
  the same instance?** Affects whether P1-15 fully eliminates the
  reconstruct-per-wave pattern.

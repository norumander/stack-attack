# Stage 2b — Condition, Chaos, Upkeep (Design)

**Status:** Design
**Date:** 2026-04-11
**Depends on:** Stage 2a tick loop core (merged at `b3fd0bc`)
**Supersedes:** — (first spec for this stage)

## 1. Context and motivation

Stage 2a landed the full 12-step tick loop with real `processPending` /
`deliverStaged`, strict cascade, TTL, active streams, and per-tick metrics.
Three steps were deliberately stubbed as no-ops and tagged for Stage 2b:

- Step 6 — `updateCondition`
- Step 6b — `injectChaos`
- Step 7 — `deductUpkeep`

In addition, Stage 2a explicitly deferred revenue crediting and populated the
economy-facing `TickMetrics` fields (`revenueEarned`, `upkeepPaid`) with
neutral defaults of `0`. The Stage 2a spec also left two engine-visible
adapters (`getEffectiveBandwidth`, `getEffectiveLatency`) as raw pass-throughs
with a contract that "2b will add chaos-induced reductions by modifying only
the adapter bodies — delivery code never branches on chaos state."

Stage 2b closes that loop. After 2b, the engine has a working economy: real
requests generate real revenue, real components accrue real upkeep, real
chaos bites real connections, and condition is a number that actually
changes things. This is the last piece needed before TD mode can have a
win/lose condition.

The stage is scoped to the minimum set of changes that makes the economy
loop *function*. Mode-specific balance tuning (what the TD budget curve
actually looks like, what the boss-wave chaos schedule is) is a Phase 2
concern and stays out.

## 2. Goals

1. Condition decays and recovers from real per-tick behavior and is visible
   in metrics.
2. Every `ConditionEffect` kind (`latency_multiplier`, `drop_probability`,
   `throughput_multiplier`, `upkeep_multiplier`) has exactly one application
   site in the engine and is covered by a unit test.
3. Every `ChaosEvent` kind (`component_failure`, `zone_outage`,
   `connection_sever`, `latency_injection`) is scheduled through
   `ModeController.getScheduledChaos`, tracked in `state.activeChaos`, and
   visible to the engine only through the two effective-* adapters or
   condition writes.
4. `deductUpkeep` sums real component upkeep (honoring `upkeep_multiplier`
   effects), debits the economy, and routes insolvency back to condition.
5. Successful responses credit the economy exactly once via
   `EconomyStrategy.creditRevenue`, and streams credit at
   `STREAM_COMPLETED`.
6. `TickMetrics.revenueEarned`, `TickMetrics.upkeepPaid`, and the
   per-component `condition` field are populated from real values, not
   zeros.
7. No changes to the 12-step tick ordering and no changes to the
   externally-published `ModeController` or `EconomyStrategy`
   interfaces. 2b is purely additive behavior behind existing Stage 1
   contracts. **Exception:** two internal surfaces are touched:
   (a) `ActiveStream` gains a `readonly request: Request` field so
   STREAM_COMPLETED can credit revenue without a side-channel lookup;
   (b) the `EngineSteps.updateActiveStreams` step-function signature
   gains a `ModeController` parameter so it can call
   `mc.economy.creditRevenue`. Neither is a public contract — they live
   in `src/core/types/stream.ts` and `src/core/engine/engine.ts`
   respectively.

## 3. Non-goals

- **Auto-scaling.** `AutoScaleCapability` and SCALE side effects stay out;
  the insolvency path does not mutate `instanceCount`.
- **Placement / upgrade economy flows.** `debitPlacement` and
  `debitUpgrade` on `EconomyStrategy` exist already and are called by
  `ModeController.tryPlace` / `tryUpgrade`. 2b does not touch them.
- **Bufferable TTL hole.** The Stage 2a known limitation around
  `EngineBufferable.removeRequest(id)` stays unclosed. Expired buffered
  requests still get the one-tick grace period and time out on the next
  tick's pending scan.
- **Mode balance numbers.** No TD or Sandbox tuning constants — revenue
  amounts, upkeep rates, insolvency rules are expressed in the test harness,
  not the core engine.
- **HUD / renderer surfaces.** Condition bars, chaos banners, budget UI —
  all deferred to the UI stage.
- **Condition `triggerWindow`.** The architecture doc mentions a
  consecutive-failure window; the current `ConditionProfile` type omits it
  and 2b does not add it. `decayRate` is the sole sensitivity knob.
  See §10 for rationale.
- **Condition effects on non-PROCESS capabilities.** A degraded INTERCEPT
  or OBSERVE capability still runs normally. Only PROCESS-phase throughput
  and DROP rolls are affected by `throughput_multiplier` and
  `drop_probability`.

## 4. Architecture overview

Stage 2b adds no new tick steps, no new interfaces, and one new engine
internal module (`condition-effects.ts`). The change surface is:

```
src/core/engine/
  stubs.ts                  → replaced: real updateCondition / injectChaos / deductUpkeep
  condition-effects.ts      → new: getActiveConditionEffects helper + effect lookups
  process-pending.ts        → modified: throughput_multiplier + drop_probability hooks
  deliver-staged.ts         → modified: creditRevenue at RESPONDED;
                                        conn.latency reads routed through getEffectiveLatency
  active-streams.ts         → modified: creditRevenue at STREAM_COMPLETED;
                                        signature gains ModeController param
  return-path.ts            → modified: conn.latency reads routed through getEffectiveLatency
  effective-bandwidth.ts    → modified: honor connection_sever;
                                        update existing getEffectiveLatency in place to honor
                                        latency_injection + latency_multiplier (no new file)
  engine.ts                 → modified: EngineSteps.updateActiveStreams signature +
                                        dispatch pass ModeController through
  metrics-builder.ts        → modified: real revenueEarned / upkeepPaid / condition
  reset-per-tick.ts         → modified: clear new transient revenue/upkeep fields

src/core/types/
  stream.ts                 → modified: ActiveStream gains readonly request: Request

src/core/state/
  simulation-state.ts       → modified: two transient scalar fields

tests/
  unit/condition-update.test.ts        → new
  unit/condition-effects.test.ts       → new
  unit/chaos-injection.test.ts         → new
  unit/upkeep-deduction.test.ts        → new
  unit/revenue-crediting.test.ts       → new
  integration/2b-economic-death-spiral.test.ts → new
  harness/test-economy.ts              → new: TestEconomyStrategy
  harness/test-chaos-controller.ts     → new: TestChaosController
```

The only `src/core/types/` change is adding `request: Request` to
`ActiveStream`. `src/core/{component,capability,mode,registry}` are
untouched. The capability layer and mode interfaces are stable — the
`ActiveStream` field addition is an internal structural change used only
by the engine and never appears in the `Capability` or `ModeController`
contracts.

### 4.1 Data flow

```
tick boundary
 │
 ├─ steps 1..5 (Stage 2a, unchanged)
 │
 ├─ step 6 updateCondition
 │    reads  : state.perComponentThisTick (drops/timeouts/overloaded/backpressured)
 │    writes : component.condition (clamped via state.setCondition)
 │
 ├─ step 6b injectChaos
 │    reads  : mc.getScheduledChaos(currentTick)
 │    writes : state.activeChaos (sweep expired, insert new)
 │             component.condition (instant kinds: component_failure, zone_outage)
 │
 ├─ step 7 deductUpkeep
 │    reads  : component.getUpkeepCost + getActiveConditionEffects
 │    writes : state.upkeepPaidThisTick
 │             mc.economy.debitUpkeep(total)
 │             component.condition (via resolveInsolvency → setCondition(id, 0))
 │
 ├─ step 8 recordMetrics
 │    reads  : state.revenueEarnedThisTick, state.upkeepPaidThisTick,
 │             component.condition
 │    writes : state.metricsHistory (append)
 │
 ├─ step 9 resetPerTickState
 │    writes : state.revenueEarnedThisTick = 0
 │             state.upkeepPaidThisTick    = 0
 │             (plus the existing Stage 2a resets)
 │
 └─ step 10 advanceTick
```

Revenue crediting is *not* a tick step. It happens inline inside
`deliverStaged` on `RESPONDED` and on `STREAM_COMPLETED`, accumulating into
`state.revenueEarnedThisTick`. Step 8 reads the accumulator, step 9 clears
it. This matches the Stage 2a note that 2b should "add chaos-aware overrides
by changing the adapter body, not by changing delivery call sites" —
crediting is the one exception because it has no adapter analogue, but it
is still a single-site change inside `deliverStaged`.

## 5. Module design

### 5.1 `condition-effects.ts` (new)

One module, three exported pure functions. No state. Single source of truth
for reading effects off a component.

```ts
// src/core/engine/condition-effects.ts

import type { Component } from "../component/component.js";
import type { ConditionEffect } from "../types/condition.js";

/**
 * Return the effects currently active on a component based on its
 * condition value and the thresholds in its conditionProfile.
 *
 * Tier selection rule (exact, in order):
 *   if (condition <= criticalThreshold)  return criticalEffects;
 *   if (condition <= degradedThreshold)  return degradedEffects;
 *   return [];
 *
 * Thresholds are condition VALUES (higher = healthier). Boundary
 * behavior: exactly-at-threshold is the lower tier (critical wins at
 * condition == criticalThreshold; degraded wins at
 * condition == degradedThreshold). Defaults from the architecture doc
 * are degradedThreshold = 0.7, criticalThreshold = 0.3, so
 * condition 0.7 → degraded, 0.3 → critical, 0.71 → healthy.
 */
export function getActiveConditionEffects(
  component: Component,
): readonly ConditionEffect[];

/**
 * Product of all upkeep_multiplier effects active on a component.
 * Returns 1.0 when no upkeep multipliers apply (healthy, or effects
 * without an upkeep multiplier kind).
 */
export function getUpkeepMultiplier(component: Component): number;

/**
 * Product of all throughput_multiplier effects. Returns 1.0 when none.
 */
export function getThroughputMultiplier(component: Component): number;

/**
 * Sum of drop_probability effects, clamped to [0, 1]. Returns 0 when
 * none. Multiple drop effects stack additively (not multiplicatively)
 * because "the chance I drop" is more intuitive as a sum.
 */
export function getDropProbability(component: Component): number;

/**
 * Product of latency_multiplier effects. Returns 1.0 when none.
 */
export function getLatencyMultiplier(component: Component): number;
```

**Rationale for a single lookup module.** Each effect kind has exactly one
application site, but the read path is the same everywhere: *which tier of
effects is active (healthy/degraded/critical), and which subset has the
kind I care about?* Centralizing the threshold decision here prevents drift
between `deductUpkeep` and `process-pending` and makes it trivial to unit
test the tier boundaries without standing up a full engine.

**Threshold semantics.** The existing `ConditionProfile` defines
`degradedThreshold` and `criticalThreshold` as `number` with no comment on
direction. 2b fixes a direction: higher `condition` is healthier.
`degradedThreshold = 0.7` means "degraded when condition falls to 0.7 or
below." `criticalThreshold = 0.3` means "critical at 0.3 or below." These
are *values*, not *losses*. The default profile in
`component-architecture.md` (line 572) uses `0.7` / `0.3`, which matches.

### 5.2 `updateCondition` (step 6)

```ts
// src/core/engine/stubs.ts — replaces the 2a no-op

export function updateCondition(
  state: SimulationState,
  _mc: ModeController,
): void {
  for (const id of state.visitOrder) {
    const comp = state.components.get(id);
    if (!comp) continue;
    const counters = state.perComponentThisTick.get(id);
    const badTick =
      counters !== undefined &&
      counters.drops + counters.timeouts +
        counters.overloaded + counters.backpressured > 0;
    const delta = badTick
      ? -comp.conditionProfile.decayRate
      : comp.conditionProfile.recoveryRate;
    state.setCondition(id, comp.condition + delta);
  }
}
```

`state.setCondition` clamps to `[0, 1]`. Iterating `state.visitOrder`
guarantees deterministic order — same as the processing pass — so a
capability that reads `component.condition` during PROCESS on the next tick
sees a value derived from a deterministic update sequence this tick.

**Why read per-tick counters directly.** The counters are populated by
`processPending`, `deliverStaged`, `overloadedSweep`, and `checkTTL` — all
steps 3..5. Step 6 runs after all of them, and step 9 (reset) runs after
step 8 (metrics), so the counters are still valid here. No extra bookkeeping
and no temporary failure counter on `Component`.

**Dead components.** `state.setCondition` already early-returns if the
component has been removed. No guard needed in the loop body.

### 5.3 `injectChaos` (step 6b)

```ts
export function injectChaos(
  state: SimulationState,
  mc: ModeController,
): void {
  // 1. Sweep expired entries BEFORE inserting new ones.
  //    A same-tick re-arm (component_failure on id=X firing twice in
  //    successive ticks) must not trip over a stale entry.
  for (const [key, entry] of state.activeChaos) {
    if (entry.expiresAtTick <= state.currentTick) {
      state.activeChaos.delete(key);
    }
  }

  // 2. Pull newly scheduled events. Contract: getScheduledChaos must
  //    return events in a stable, caller-independent order. Asserted in
  //    tests, not enforced in code.
  const events = mc.getScheduledChaos(state.currentTick);
  for (const event of events) {
    const key = chaosKey(event);
    const expiresAtTick = computeExpiry(event, state.currentTick);
    state.activeChaos.set(key, { event, expiresAtTick });
  }

  // 3. RE-APPLY instant-condition chaos for every still-active entry,
  //    not just newly-inserted ones. This is the critical difference
  //    from a naive "apply once on insert" design: without re-apply,
  //    a zone_outage with durationTicks=5 would zero condition on
  //    tick T, then step 6 on tick T+1 would let recoveryRate nudge
  //    it upward during the outage window. Re-applying each tick
  //    keeps the component/zone pinned at 0 until the chaos entry
  //    naturally expires via the sweep in (1).
  for (const entry of state.activeChaos.values()) {
    switch (entry.event.kind) {
      case "component_failure":
        state.setCondition(entry.event.componentId, 0);
        break;
      case "zone_outage":
        for (const comp of state.components.values()) {
          if (comp.zone === entry.event.zone) {
            state.setCondition(comp.id, 0);
          }
        }
        break;
      // connection_sever and latency_injection are adapter-only —
      // no re-apply needed; the adapters read activeChaos each call.
    }
  }
}
```

**Key helpers (internal to `stubs.ts` or a sibling `chaos.ts`):**

- `chaosKey(event)` — a deterministic string key. `"component:<id>"` for
  `component_failure`, `"zone:<zone>"` for `zone_outage`, `"sever:<id>"` for
  `connection_sever`, `"latency:<id>"` for `latency_injection`. Kind
  prefixes are distinct so a `connection_sever` and a `latency_injection`
  targeting the same connection id coexist instead of colliding. Two entries
  of the same kind against the same target collapse to one — the *later*
  one wins. This is intentional: a new `latency_injection` on a connection
  supersedes the existing one rather than stacking, because stacking would
  require iterating all entries per adapter call.
- `computeExpiry(event, tick)` — returns `tick + event.durationTicks` for
  every kind that has a `durationTicks` field (`zone_outage`,
  `connection_sever`, `latency_injection`) and `tick + 1` for
  `component_failure` (which has no duration field; a one-tick grace
  means the entry is swept on the next tick and, if the mode wants a
  longer outage, it must re-schedule the event). `zone_outage` uses its
  `durationTicks` to keep re-applying condition=0 across the window, so
  the zone is genuinely out for the declared duration.

**Ordering rationale.** Sweep first, then insert, then re-apply. Sweep
first matters when a duration event naturally expires on the same tick a
new one arrives — the old entry would otherwise block the new insert if
keys collide. Re-apply last (after insert) guarantees a new
`component_failure` inserted this tick gets its condition write applied
in the same pass, alongside any still-active entries from previous ticks.
A single loop doing the re-apply covers both cases uniformly.

### 5.4 `deductUpkeep` (step 7)

```ts
export function deductUpkeep(
  state: SimulationState,
  mc: ModeController,
): void {
  let total = 0;
  for (const comp of state.components.values()) {
    const activeCaps = mc.getActiveCapabilities(comp);
    const effectiveTiers = computeEffectiveTiers(comp, mc);
    const baseCost = comp.getUpkeepCost(activeCaps, effectiveTiers);
    const mult = getUpkeepMultiplier(comp);
    total += baseCost * mult;
  }

  mc.economy.debitUpkeep(total);
  state.upkeepPaidThisTick = total;

  const insolventIds = mc.economy.resolveInsolvency(state.asReader());
  for (const id of insolventIds) {
    state.setCondition(id, 0);
  }
}
```

**`computeEffectiveTiers` reuse.** This helper already exists at
`src/core/component/effective-tier.ts` with signature
`(component: ComponentReader, modeController: ModeController) → ReadonlyMap<CapabilityId, number>`.
The engine-side call site passes the component and the mode controller —
no `activeCaps` argument (the helper computes effective tier for *every*
capability on the component and `getUpkeepCost` selects the active
subset itself). Reuse as-is; no engine-layer re-export needed.

**Iteration order.** `state.components` is a `Map`, which iterates in
insertion order. Insertion order is stable (placement order, which in a
deterministic simulation is deterministic), so upkeep summation is
deterministic without needing `visitOrder`. The insolvent ID list from
`resolveInsolvency` is whatever order the economy returned — the engine
applies it as given.

**What insolvency does.** 2b's contract: insolvency writes `condition = 0`
on each listed component. It does not remove the component, does not
cancel in-flight requests, does not touch pending queues. A condition-0
component will drop everything next tick via `drop_probability = 1.0` if
the registry's `criticalEffects` includes a drop (the default does —
"random_drop_20pct" will need updating in the registry, see §10), or it
will simply continue to process normally but accumulate more failures and
stay at 0 via repeated decay. Either way, the engine does not mutate
topology from the economy path.

### 5.5 Revenue crediting

Two call sites. Both depend on the `ActiveStream` type carrying the
originating `Request` (see §5.5a) and on `updateActiveStreams` gaining a
`ModeController` parameter (see §5.5b).

**(a) Non-stream responses — inside `deliverStaged`.** At the point
where a top-level non-stream request is being responded to, add a
credit call. Stage 2a's `deliverStaged` RESPOND branch handles both
stream and non-stream requests in the same block: stream requests emit
`STREAM_STARTED` and *then fall through* to emit `RESPONDED`
(see `deliver-staged.ts:81-130`). To avoid double-crediting streams
once at RESPONDED and again at STREAM_COMPLETED, the credit must be
gated on `request.streamDuration == null`:

```ts
if (request.streamDuration == null
    && !state.childToParent.has(request.id)) {
  const credited = mc.economy.creditRevenue(request);
  state.revenueEarnedThisTick += credited;
}
```

The two guards express two independent rules:
- `streamDuration == null` → this request is not a stream, so revenue
  is owed at RESPONDED. Stream revenue is owed at STREAM_COMPLETED.
- `!childToParent.has(request.id)` → this request is not a
  SPAWNed child of a blocking parent, so it is the top-level
  customer-facing request that earns revenue.

This is the only modification to `deliverStaged` behavior in 2b
(besides routing `conn.latency` reads through the adapter — §5.6).

**(b) Streams — inside `updateActiveStreams`.** When a stream's
`remainingDuration` hits zero and `STREAM_COMPLETED` is emitted, add:

```ts
if (!state.childToParent.has(stream.requestId)) {
  const credited = mc.economy.creditRevenue(stream.request);
  state.revenueEarnedThisTick += credited;
}
```

**Why both sites.** The Stage 2a spec §532 explicitly notes: "non-stream
requests (at RESPONDED) is deferred to 2b. 2a emits `STREAM_STARTED`,
`STREAM_COMPLETED`, and `RESPONDED` events so 2b's consumer can pick
both sites." Picking both is correct: a stream that runs to completion
delivered value. Stage 2a does not yet have a stream-severance path
(a chaos-driven sever does not retroactively cancel active streams —
it only affects bandwidth reads for *new* reservations), so in 2b the
only way a stream fails to reach STREAM_COMPLETED is TTL expiry on
the parent request — which is also a no-credit path because
`updateActiveStreams` never runs for a request that's already been
released. The no-double-credit property falls out of the two
single-emit sites.

**Child requests do not credit.** Only the *top-level* request that the
traffic source injected earns revenue. A child request SPAWNed by a
blocking capability does not. Cascade tracks parent-child via
`state.childToParent`; `creditRevenue` is called only when the request
id is NOT a key in that map — i.e. it is a root. Note: `childToParent`
maps child→parent, so "is not a key" means "is not a child."

**Idempotency.** `deliverStaged` emits `RESPONDED` exactly once per
top-level request (Stage 2a invariant). `STREAM_COMPLETED` is emitted
exactly once per stream at `updateActiveStreams` time. The economy
cannot be double-credited along the success path because both sites are
single-emit.

### 5.5a `ActiveStream` gains `request: Request`

Current type (in `src/core/types/stream.ts`):

```ts
export interface ActiveStream {
  readonly requestId: RequestId;
  readonly connectionId: ConnectionId;
  readonly originComponentId: ComponentId;
  readonly baseRevenue: number;
  remainingDuration: number;
  reservedBandwidth: number;
}
```

Stage 2b adds one field:

```ts
readonly request: Request;
```

The site that constructs an `ActiveStream` is the RESPOND→STREAM_STARTED
branch in `deliverStaged` (Stage 2a). That branch already has the full
`Request` in scope, so the field is trivially populated. No engine-wide
refactor — just one additional property at one construction site.

**Why not use `baseRevenue`?** The `baseRevenue` field exists as a
Stage 2a-reserved placeholder (Stage 2a spec §468 flags it with a
`// credited in 2b` comment). The cleanest approach would be to precompute
`baseRevenue` at STREAM_STARTED and credit the number at STREAM_COMPLETED,
skipping the `creditRevenue(request)` call entirely — but this assumes
revenue is a pure function of the `Request` that can be computed eagerly.
That's true for the current `creditRevenue` signature but over-constrains
the economy: it forbids time-of-completion-dependent pricing (e.g., "full
revenue if completed within deadline, half otherwise"). Carrying the
`Request` on the stream preserves `creditRevenue`'s authority to decide
the amount at completion time. `baseRevenue` stays on the type as a
hint/debug field; 2b does not rely on it.

### 5.5b `updateActiveStreams` gains a `ModeController` parameter

Current signature (in `src/core/engine/active-streams.ts`):

```ts
export function updateActiveStreams(state: SimulationState): void;
```

Stage 2b signature:

```ts
export function updateActiveStreams(
  state: SimulationState,
  mc: ModeController,
): void;
```

And in `src/core/engine/engine.ts`, the `EngineSteps` interface
changes `updateActiveStreams` to `(state, mc) => void`, and the tick
dispatch in `Engine.tick` passes `mc` through at step 4b. This is an
internal step-function-plumbing change, not a change to the
`ModeController` or `EconomyStrategy` interface. Any test that injects a
custom `updateActiveStreams` through `EngineSteps` must update its
signature; the Stage 2a test suite has one such injection site in
`tests/unit/engine-tick-ordering.test.ts` (line 16, the
`new Engine(state, { ... updateActiveStreams: record(...) ... })`
block). The implementation plan must audit and update this one site
— and grep for any other `new Engine(state, { ... })` callers that
override `updateActiveStreams`.

### 5.6 Effective-adapter updates

Both `getEffectiveBandwidth` and `getEffectiveLatency` already exist in
`src/core/engine/effective-bandwidth.ts` (Stage 2a shipped both as raw
pass-throughs in a single file). Stage 2b modifies the bodies in place.
No new file.

**`getEffectiveBandwidth(connectionId)`:**

```ts
// Before any of the Stage 2a discounts, check chaos.
for (const entry of state.activeChaos.values()) {
  if (entry.event.kind === "connection_sever"
      && entry.event.connectionId === connectionId) {
    return 0;
  }
}
// ... existing Stage 2a formula unchanged
// (bandwidth - connectionLoadThisTick - active-stream reservations) ...
```

**`getEffectiveLatency(connectionId)`:**

```ts
const conn = state.connections.get(connectionId);
if (!conn) return 0;
let latency = conn.latency;

// Chaos: latency_injection adds. The §5.3 collapse rule guarantees at
// most one latency_injection entry per connection key, so this loop
// can early-return after the first hit.
for (const entry of state.activeChaos.values()) {
  if (entry.event.kind === "latency_injection"
      && entry.event.connectionId === connectionId) {
    latency += entry.event.extraLatency;
    break;
  }
}

// Condition: the source component's latency_multiplier applies to its
// outgoing connection latency. Connection.source.componentId is a
// ComponentId; look it up in state.components and read its active
// latency_multiplier effects via getLatencyMultiplier.
const fromComp = state.components.get(conn.source.componentId);
if (fromComp) {
  latency *= getLatencyMultiplier(fromComp);
}
return latency;
```

**Delivery-site audit — new work in 2b.** Stage 2a's claim that all
delivery code reads through the bandwidth adapter is accurate. The
*latency* side was never enforced because the adapter was a no-op
pass-through. A grep of `src/core/engine/` currently finds two direct
`conn.latency` reads outside the adapter itself:

1. `src/core/engine/deliver-staged.ts:302` — constructs a `TRAVERSED`
   event with `latencyAdded: conn.latency`.
2. `src/core/engine/return-path.ts:26` — computes reverse-path latency
   with `returnLatency += conn?.latency ?? 0`.

Both sites must be converted to `getEffectiveLatency(state, connId)` as
part of Stage 2b. After the conversion, a test-level invariant check
(grep assertion in CI, or a simple TypeScript lint rule) enforces that
no file under `src/core/engine/` reads `.latency` on a `Connection`
except `effective-bandwidth.ts` itself. This matches the bandwidth
invariant Stage 2a §419 established and is the only way the
chaos+condition latency overrides bite at every call site.

### 5.7 `process-pending.ts` changes

Two hooks, both inside the existing per-component loop:

1. **Throughput multiplier.** The per-component throughput budget is
   produced by `componentThroughputPerTick(component)` in
   `src/core/engine/throughput.ts`. 2b does *not* modify
   `throughput.ts` — instead, the call site in `process-pending.ts`
   takes the helper's return value and multiplies by
   `getThroughputMultiplier(comp)` before the throughput gate:

   ```ts
   const rawBudget = componentThroughputPerTick(comp);
   const budget = Math.max(0, Math.floor(rawBudget * getThroughputMultiplier(comp)));
   ```

   Keeping the hook at the call site (rather than inside the helper)
   preserves `componentThroughputPerTick` as a pure function and lets
   tests exercise it independently of condition effects. A multiplier
   of 0 means the component processes nothing this tick — requests
   stay in `pending` and eventually get swept by `overloadedSweep`.

2. **Drop roll.** Immediately *after* popping a request from `pending` and
   *before* invoking `comp.process(request, ctx)`, check
   `getDropProbability(comp)`. If `rng.next() < p`:
   - append a `DROP` event with reason `"condition_drop"` to the request
   - increment `perComponentThisTick[id].drops`
   - stage a DROP outcome (so downstream bookkeeping treats it like any
     other DROP)
   - skip the pipeline call
   - continue the loop

   The roll consumes one RNG value per attempted request on a degraded
   component. Deterministic because `DeterministicRng` is seeded.

**Ordering vs throughput gate.** The throughput gate runs first (you can
only attempt up to `throughputBudget` requests per tick). The drop roll
happens inside the accepted slice — a "lost" request still counts against
throughput. This models a degraded component that burns capacity on
failing work, which is the point: a degraded server doesn't magically
process its non-dropped requests faster.

### 5.8 `metrics-builder.ts` changes

Current Stage 2a hardcodes:

```ts
revenueEarned: 0,
upkeepPaid: 0,
// and per-component condition: 1.0 in the snapshot builder
```

Stage 2b replaces these with:

```ts
revenueEarned: state.revenueEarnedThisTick,
upkeepPaid: state.upkeepPaidThisTick,
// per-component snapshot reads component.condition directly
```

No schema change to `TickMetrics`. No new fields.

### 5.9 `reset-per-tick.ts` changes

Add two resets:

```ts
state.revenueEarnedThisTick = 0;
state.upkeepPaidThisTick = 0;
```

Both run after step 8 (metrics snapshot) so the metric has real values.
This is the same ordering rule Stage 2a uses for `connectionLoadThisTick`.

### 5.10 `SimulationState` changes

Add two transient scalar fields:

```ts
// src/core/state/simulation-state.ts
class SimulationState {
  // ... existing fields ...
  revenueEarnedThisTick = 0;
  upkeepPaidThisTick = 0;
}
```

Both are reset in `resetPerTickState`. Both are cleared to `0` in the
constructor by default (TypeScript field initializer). No reader-interface
exposure — metrics-builder already has raw `SimulationState` access.

## 6. Test harness additions

### 6.1 `tests/harness/test-economy.ts`

```ts
export class TestEconomyStrategy implements EconomyStrategy {
  budget: number;
  readonly creditLog: Array<{ requestId: RequestId; amount: number }> = [];
  readonly debitLog: number[] = [];

  constructor(opts: {
    budget?: number;
    revenuePerRequest?: number | ((r: Request) => number);
    insolvencyRule?: (state: SimulationStateReader) => ComponentId[];
  });

  // ... implements all 7 EconomyStrategy methods ...
}
```

**Why a test implementation.** The production TD/Sandbox economies don't
exist yet (they're Phase 2 / Stage 3 work). 2b needs an economy that tests
can introspect. The test implementation is the *only* caller of
`creditRevenue`/`debitUpkeep` in 2b's test suite, which keeps the spec
honest: if the engine calls these methods, the test sees it; if it doesn't,
the test sees that too.

### 6.2 `tests/harness/test-chaos-controller.ts`

```ts
export class TestChaosController implements ModeController {
  private readonly schedule: Map<number, readonly ChaosEvent[]>;

  constructor(opts: {
    schedule?: Record<number, readonly ChaosEvent[]>;
    economy?: EconomyStrategy;
    // ... other ModeController knobs, defaults match NoOpModeController ...
  });

  getScheduledChaos(tick: number): readonly ChaosEvent[] {
    return this.schedule.get(tick) ?? [];
  }

  // ... rest delegates to NoOpModeController defaults ...
}
```

**Composition over inheritance.** `TestChaosController` is a thin wrapper
that accepts a `NoOpModeController` as its base behavior and overrides
only `getScheduledChaos`. No subclassing. Tests that need both an economy
and a chaos schedule compose the two via constructor options.

## 7. Test plan

### 7.1 Unit: `condition-update.test.ts`

- bad tick (1 drop) → condition decays by `decayRate`
- bad tick (1 backpressure) → same
- bad tick (1 timeout) → same
- bad tick (1 overloaded) → same
- clean tick → condition recovers by `recoveryRate`
- clean tick at condition = 1.0 → clamped to 1.0
- bad tick at condition = 0.0 → clamped to 0.0
- mixed: some components bad, others clean → each updates independently
- order: iteration follows `state.visitOrder`

### 7.2 Unit: `condition-effects.test.ts`

- `getActiveConditionEffects` at condition 0.9 → `[]` (healthy)
- at condition 0.7 → `degradedEffects`
- at condition 0.3 → `criticalEffects`
- at condition 0 → `criticalEffects`
- `getUpkeepMultiplier` with two upkeep effects of 1.5 and 2.0 → 3.0
- `getThroughputMultiplier` with no effects → 1.0
- `getDropProbability` with two effects (p=0.2 and p=0.5) → 0.7
- `getDropProbability` with three effects summing > 1 → clamped to 1
- `getLatencyMultiplier` with no effects → 1.0
- full-stack test: component with `drop_probability: 1.0` in criticalEffects
  degraded to 0 → `processPending` drops every incoming request

### 7.3 Unit: `chaos-injection.test.ts`

- `component_failure` → condition goes to 0 same tick, entry in
  `activeChaos`, expires next tick
- `zone_outage` → every component in zone to 0 same tick
- `zone_outage` across three components in zone → all three
- `connection_sever` → `getEffectiveBandwidth(id)` returns 0 during window,
  returns raw value after expiry
- `latency_injection` → `getEffectiveLatency(id)` adds extra during
  window, reverts after
- `connection_sever` + `latency_injection` on same connection → sever wins
  for bandwidth, latency still adds (they're independent dimensions)
- two `latency_injection` events on the same connection → later wins (per
  §5.3 collapse rule)
- sweep-before-insert: expiring and new chaos on same key same tick →
  new entry lands
- `getScheduledChaos` called exactly once per tick

### 7.4 Unit: `upkeep-deduction.test.ts`

- single component, no multiplier → total = component.getUpkeepCost
- component degraded with 2.0 upkeep_multiplier → total = 2 × base
- two components → total = sum
- `economy.debitUpkeep` called once per tick with the total
- `state.upkeepPaidThisTick` equals the total
- insolvency returns [id1, id2] → both set to condition = 0
- insolvency returns [] → no condition writes
- insolvency order: respects the list returned by `resolveInsolvency`

### 7.5 Unit: `revenue-crediting.test.ts`

- RESPONDED → `creditRevenue(request)` called once
- `state.revenueEarnedThisTick` accumulates across multiple responses
  in a tick
- STREAM_COMPLETED → `creditRevenue(stream.request)` called once
- stream request at RESPONDED (same tick as STREAM_STARTED) →
  `creditRevenue` NOT called (gated on `streamDuration == null`)
- child request (key in `childToParent`) → `creditRevenue` NOT called
- parent request completing normally → `creditRevenue` called exactly once
- revenue metric in `metricsHistory` matches `revenueEarnedThisTick`
  before reset

### 7.6 Integration: `2b-economic-death-spiral.test.ts`

End-to-end story: place a single processing component with a small budget,
feed high traffic, watch the economy fail.

```
Tick 0: place Server. budget = 100.
Tick 1–5: traffic arrives, Server processes, revenue credited, upkeep
  deducted, budget slowly drops.
Tick 6: traffic spikes beyond throughput. Drops + overloaded begin.
Tick 7: Server condition decays below degradedThreshold. Upkeep multiplier
  kicks in. Revenue falls, upkeep rises.
Tick 8: budget goes negative. resolveInsolvency returns [server.id].
  Server condition → 0.
Tick 9: Server is critical. drop_probability = 1.0. Every incoming
  request drops. Revenue = 0. Upkeep still charged.
Tick 10: traffic stops (test drives that). Condition recovers one notch.
Tick 11: confirmed determinism — rerun same seed gets identical sequence.
```

This is the test that confirms the loop *closes*: condition → upkeep →
insolvency → condition → drops → condition. It is the only integration
test in 2b; every other test is a unit.

### 7.7 Property tests (extends Stage 2a property suite)

- conservation: every credited revenue amount equals the sum of
  per-request-type revenues reported by `TestEconomyStrategy`
- determinism: seeded run × 2 produces byte-identical metrics history,
  including revenue, upkeep, condition sequence
- no-double-credit: for every request id that appears in RESPONDED or
  STREAM_COMPLETED, `creditLog` contains at most one matching entry

## 8. Invariants added in Stage 2b

1. **Condition monotonic per tick.** A single tick applies exactly one of
   `-decayRate` or `+recoveryRate` to each component. Both values are
   non-negative in `ConditionProfile`; the sign comes from the engine.
2. **Effect scope single-site.** Each `ConditionEffect` kind has exactly
   one application site in `src/core/engine/`. Asserted by grep-discipline
   at review time, not by runtime check.
3. **Chaos reads are adapter-only.** No file in `src/core/engine/`
   reads `state.activeChaos` except `stubs.ts` (`injectChaos`) and
   `effective-bandwidth.ts` (which hosts both `getEffectiveBandwidth`
   and `getEffectiveLatency`).
4. **Revenue roots only.** `creditRevenue` is called only for requests that
   are not values in `state.childToParent`.
5. **Insolvency writes only condition.** `deductUpkeep` never touches
   `state.components`, `state.connections`, `state.pending`, or
   `state.activeStreams` — it calls `setCondition(id, 0)` on returned ids
   and nothing else.
6. **Metric field provenance.** `revenueEarned` and `upkeepPaid` in
   `TickMetrics` come from `state.*ThisTick` accumulators, not from any
   other source.
7. **Per-component condition snapshot.** The `condition` field on a
   `TickMetrics` per-component entry is read from `component.condition`
   at step 8, *after* step 6 and step 6b have run. Step 9's reset does
   not touch `component.condition`.

## 9. Exit criteria

Stage 2b is considered done when:

1. All three stubs in `src/core/engine/stubs.ts` have real implementations.
2. `condition-effects.ts` exists and is the only module reading
   `conditionProfile` thresholds.
3. `effective-bandwidth.ts` is the sole `connection.latency` reader
   in the delivery code path (it hosts both adapters). All other
   delivery sites read latency through `getEffectiveLatency`.
4. `effective-bandwidth.ts` (specifically `getEffectiveBandwidth`)
   honors `connection_sever` and returns 0 for severed connections.
5. `deliverStaged` credits revenue at RESPONDED.
6. `updateActiveStreams` credits revenue at STREAM_COMPLETED.
7. `metrics-builder.ts` returns real values for `revenueEarned`,
   `upkeepPaid`, and per-component `condition`.
8. Two transient fields on `SimulationState` are reset in
   `resetPerTickState`.
9. All test files listed in §6 exist and pass, including the
   death-spiral integration test.
10. Full suite (Stage 2a + Stage 2b) passes. Test count ≥ 267 + ~40.
11. `pnpm typecheck` clean.
12. Only `src/core/types/stream.ts` is modified outside
    `src/core/engine/` and `src/core/state/` — the `ActiveStream`
    interface gains `readonly request: Request`. No other file under
    `src/core/{types,mode,capability,component,registry}` is touched.
13. No change to `ModeController` or `EconomyStrategy` interfaces.
14. The only step-function signature change is
    `EngineSteps.updateActiveStreams`, which gains a `ModeController`
    parameter. No change to the 12-step tick ordering.
15. No direct `connection.latency` or `connection.bandwidth` read
    survives anywhere in `src/core/engine/` except inside
    `effective-bandwidth.ts` itself. Enforced by grep/CI assertion.

## 10. Open questions and deferred decisions

### 10.1 Resolved in this spec

- **Condition trigger window.** Dropped. `decayRate` is sufficient.
  Revisit if playtesting shows oscillation (healthy → degraded → healthy
  in two ticks under noisy load). If it happens, add a rolling bad-tick
  counter on `Component` and gate decay behind a threshold.
- **Latency multiplier application.** The outgoing connection of a
  degraded from-component is the target. Alternative (per-hop additive
  inside the component) was considered and rejected because the engine
  tracks latency on connections, not inside components.
- **Stacking rule for duration chaos events.** Later wins per key; no
  stacking. Rejected stacking because it would require iterating all
  active-chaos entries on every adapter call.
- **Drop probability stacking.** Additive-sum, clamped to 1.0. Rejected
  multiplicative because "a component at 50% drop + another 50% drop
  effect = 75% drop" is less intuitive than "100% drop."
- **Revenue for child requests.** Only roots credit. This matches the
  story: the customer paid for one request, not for the cascade.

### 10.2 Deferred to Stage 2c or later

- **`EngineBufferable.removeRequest(id)`** — closes the TTL-in-queue hole.
  Not needed for the economy loop to function.
- **Auto-scaling integration.** `AutoScaleCapability` needs to observe
  the per-tick counters that 2b reads. When 2c adds SCALE side effects,
  the `updateCondition` loop gains a reader.
- **Economy balance tuning.** Default `conditionProfile` values, default
  TD upkeep rates, default Sandbox chaos schedules — all live in the
  registry and mode controllers, not in the engine.
- **Condition-aware routing.** `RoutingCapability` tier 3 is supposed to
  be condition-aware (skip degraded components). The `selectConnection`
  path inside the engine does not yet read `component.condition`. 2b
  does not add this because no production `RoutingCapability` tier 3
  exists to exercise it.

### 10.3 Known shortcomings that Stage 2b does not fix

- **`EngineBufferable.removeRequest(id)` gap.** Still open, same as
  Stage 2a. See §3.
- **Condition-aware routing.** `RoutingCapability` tier 3 is supposed
  to skip degraded components but no tier-3 `RoutingCapability` has
  been implemented yet, so there is nothing for 2b to wire up. A future
  stage that adds tier-3 routing will read `component.condition` inside
  `selectConnection` — the data is there, just unconsumed.

## 11. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Drop-probability RNG consumption changes replay determinism for existing Stage 2a tests | Medium | RNG is only consumed when `drop_probability > 0`; existing tests use healthy components (condition = 1.0) so `p = 0` → no RNG call → no replay drift. Verify in CI by running Stage 2a tests against Stage 2b build before touching them. |
| Condition-aware latency multiplier changes effective latency in existing tests | Medium | Same story — healthy components return multiplier 1.0, existing tests unaffected. Add an invariant assertion in the death-spiral test. |
| `resolveInsolvency` is called with `state.asReader()` which only exposes `components` as `ReadonlyMap<ComponentId, ComponentReader>` — the TestEconomyStrategy may need richer reader access | Low | Extend `SimulationStateReader` only if the test implementation actually needs it. Prefer passing specific values via constructor. |
| Chaos-key collisions when two different chaos kinds target the same connection | Low | §5.3 rule: keys are kind-prefixed (`sever:` for `connection_sever` vs `latency:` for `latency_injection`), so no collision. Asserted in `chaos-injection.test.ts`. |
| `state.activeChaos` map iteration order affects determinism | Low | JS `Map` preserves insertion order. Insertion order is driven by `getScheduledChaos` return order, which the contract requires to be stable. Sweep-before-insert preserves this. |
| Revenue-crediting-inside-`deliverStaged` means a test that stubs `deliverStaged` will skip crediting | Low (theoretical) | No test stubs `deliverStaged`. Flag at review. |

## 12. Implementation sequencing

The writing-plans skill will break this into tasks. Rough order:

1. Add transient state fields + reset logic (no behavior change).
2. Create `condition-effects.ts` with pure functions and unit tests.
3. Implement `updateCondition` + unit tests.
4. Implement `injectChaos` + unit tests (no adapter changes yet).
5. Update the existing `getEffectiveLatency` in `effective-bandwidth.ts`
   to honor `latency_injection` chaos and `latency_multiplier`
   condition effects. In the same pass, convert the two direct
   `conn.latency` reads (deliver-staged.ts:302, return-path.ts:26) to
   `getEffectiveLatency` calls + unit tests for the adapter.
6. Update `getEffectiveBandwidth` in `effective-bandwidth.ts` to honor
   `connection_sever` + unit tests.
7. Hook `throughput_multiplier` and `drop_probability` in
   `process-pending.ts` + unit tests.
8. Implement `deductUpkeep` with `TestEconomyStrategy` + unit tests.
9. Add revenue crediting in `deliverStaged` and `updateActiveStreams` +
   unit tests.
10. Update `metrics-builder.ts` + verify Stage 2a tests still pass.
11. Write `2b-economic-death-spiral` integration test.
12. Run full suite + typecheck + property tests.

Each step should leave the tree green. The order maximizes the number of
steps that can be landed independently on `main` if needed.

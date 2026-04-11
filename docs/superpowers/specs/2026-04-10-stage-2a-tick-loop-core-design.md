# Stage 2a: Tick Loop Core — Design Spec

**Status:** Draft
**Date:** 2026-04-10
**Supersedes/extends:** `2026-04-10-tower-defense-foundation-design.md`
**Follows from:** `2026-04-10-tower-defense-foundation-stage-1.md`

## 1. Context

Stage 1 merged: all type contracts live under `src/core/`, the `Component` class
has a pipeline runner, `SimulationState` and the registries exist, abstract
`ModeController` / `EconomyStrategy` / `TrafficSource` interfaces are defined,
a stub `ProcessingCapability` exists, and a walking-skeleton `Engine` passes a
`Client → Server` smoke test (93 tests). The walking-skeleton tick loop runs
three steps: `injectTraffic → processPending → advanceTick`.

Stage 2a turns that walking skeleton into a **real simulation core**: the full
10-step tick loop, fixed-point processing, throughput gating, delivery with
backpressure, TTL/timeout with cascade semantics, blocking and non-blocking
SPAWNs with instant response transport, active streams, and per-tick metrics.

Stage 2a is deliberately scoped to produce a **deterministic, testable,
end-to-end simulation loop** without the degradation model. Condition/health
effects, chaos injection, and upkeep/economy deduction are deferred to Stage
2b. Revenue crediting and all mode-level scoring that depends on revenue are
also deferred; 2a emits the events that 2b will consume but does not populate
`revenueEarned` or `upkeepPaid` in metrics (neutral defaults of 0). This split
is motivated by the dependency story: 2a produces behavior that 2b reacts to,
so landing 2a first gives 2b a trusted substrate to build on.

## 2. Goals

At the end of Stage 2a, the engine supports:

- Same-tick multi-hop processing through realistic topologies
  (`Client → LB → Server → DB → RESPOND → Client` resolves in one tick under
  no-load)
- Throughput-limited components that overflow into OVERLOADED outcomes under
  sustained load
- Connection bandwidth checks with backpressure to `EngineBufferable`
  (QueueCapability stub is sufficient; real Queue component lands later) or
  DROP with `BACKPRESSURED` reason if no bufferable exists
- Request TTL with recursive cascade between blocking parents and children
- Active streams that reserve bandwidth on their full path for their full
  duration, creating congestion for other requests
- Per-tick metrics suitable for renderer HUDs and mode outcome scoring
- Byte-identical deterministic replay given the same seed, topology, and
  traffic schedule

## 3. Non-goals (deferred to Stage 2b)

The following are stubbed in Stage 2a — the tick step and its call site exist,
but the function body is a no-op (or returns a neutral value). 2b fills in the
bodies without re-ordering anything.

- **Step 6 — `updateCondition`**: component health degradation/recovery math,
  `applyConditionEffects` interpreter, and the four application sites.
- **Step 6b — `injectChaos`**: `applyChaosEvent` for the four chaos kinds,
  chaos-adjusted bandwidth/latency, suppression semantics, activeChaos sweep.
- **Step 7 — `deductUpkeep`**: upkeep accumulation, economy debit, insolvency
  resolution and the condition-critical handoff.

The bandwidth adapter used by delivery (`getEffectiveBandwidth`) is shaped so
that 2b adds chaos-aware overrides by changing the adapter body, not by
changing delivery sites. Same for latency on connections.

Phase 2 concerns (React, Pixi/canvas, actual rendering) are explicitly out of
scope for all of Phase 1.

## 4. Tick loop structure

The canonical 10-step tick is preserved. 2a implements all non-stubbed steps;
2b fills in steps 6, 6b, and 7.

```
Tick(currentTick):
  1.  injectTraffic()               // 2a real
  2.  reEmitQueued()                // 2a real
  for iter in 1..FIXED_POINT_CAP:   // FIXED_POINT_CAP = 256
    progressed = processPending()   // step 3: visit + process, stages outcomes
    deliverStaged()                 // step 4a: drain staged → downstream pending
    if not progressed: break
  if iter == FIXED_POINT_CAP:
    throw FixedPointRunaway(...)    // loud bug detector; never a silent truncate
  4b. updateActiveStreams()         // 2a real
  5.  checkTTL()                    // 2a real
  6.  updateCondition()             // 2a STUB (no-op)
  6b. injectChaos()                 // 2a STUB (no-op)
  7.  deductUpkeep()                // 2a STUB (no-op)
  8.  recordMetrics()               // 2a real
  9.  resetPerTickState()           // 2a real
  10. advanceTick()                 // 2a real
```

Steps 3 and 4a are preserved as **distinct functions** but wrapped together
inside the fixed-point loop. Each iteration: process everything you can in one
visit pass, then deliver everything staged, then check for quiescence. Steps
4b, 5, 8, 9, and 10 run **once per tick** after the loop quiesces — they are
per-tick concerns, not per-iteration concerns.

### 4.1 Why stub rather than skip

Stubbing (rather than conditionally skipping in 2a) guarantees 2a tests
exercise the exact same tick shape 2b will. 2b's job becomes purely additive:
fill in function bodies without touching the ordering. This also means
`Engine.tick()` is structurally complete at the end of 2a, so the step-order
invariant is locked in by construction.

## 5. Fixed-point processing (step 3 + step 4a inside the loop)

### 5.1 Visitation order

Components are sorted once per wave by `(zone, placementTick, componentId)`.
Component IDs are branded, globally unique, and stable, so tie-breaking is
deterministic. The sorted list is cached on `SimulationState` and rebuilt when
components are added/removed (not during a running wave in TD mode, but
Sandbox mode may rebuild between ticks).

### 5.2 The process/deliver inner loop

```
iter = 0
while iter < FIXED_POINT_CAP:
  progressed = false

  # --- step 3: processPending (visit all components, stage outcomes) ---
  # Must drain for all components before deliverStaged runs this iteration.
  # No interleaving: delivery is deferred to the end of the iteration.
  for component in state.visitOrder:
    while state.pending.get(component.id).length > 0
          and state.perComponentThisTick.get(component.id).processed
              < componentThroughputPerTick(component):
      req = state.dequeuePending(component.id)
      result = component.process(req, ctx)   // runs INTERCEPT → PROCESS → REPLICATE → OBSERVE
      state.stagedOutcomes.push({
        sourceComponentId: component.id,
        request: req,
        result,                              // ProcessResult: { outcome, sideEffects, events }
      })
      state.incrementProcessedCount(component.id)
      progressed = true

  # --- step 4a: deliverStaged (drain staged queue in FIFO order) ---
  while state.stagedOutcomes.length > 0:
    staged = state.stagedOutcomes.shift()
    moved = deliverStaged(staged)            // see §6 for the full outcome handling
    if moved: progressed = true

  if not progressed: break
  iter += 1

if iter == FIXED_POINT_CAP:
  throw new FixedPointRunaway(state, iter)
```

`componentThroughputPerTick(c) = Σ cap.getThroughputPerTick(c) * c.instanceCount`
for every PROCESS-phase capability on `c`. Components with no PROCESS-phase
capabilities (pure INTERCEPT/REPLICATE/OBSERVE, e.g. CDN as a short-circuit
Cache) have an effective throughput of `Infinity` — the gate does not apply.

**`progressed` flag definition (precise):** `progressed = true` iff (a) any
request was dequeued from any component's pending during processPending this
iteration, OR (b) `deliverStaged` returned `moved = true` for any staged
entry. `deliverStaged` returns `moved = true` when the request landed in a
new location (downstream pending, buffer, resolved, dropped terminal, blocked
pool). It returns `moved = false` only for true no-op staged entries (which
should never happen in practice; `moved = false` is reserved as a safety
value). The definition intentionally treats *terminal* deliveries (DROP,
RESOLVED) as progress so that a tick which only drops requests still makes
progress and converges.

Key properties:

- **Quiescence is the normal exit.** The 256 cap is a bug trap, never a
  silent truncation. Any test or production run that hits it is a failing
  condition. `FixedPointRunaway` is an `Error` subclass that carries the
  `SimulationState` snapshot and the iteration count for postmortem.
- **Throughput gate counter is per-tick and persists across iterations.** The
  loop reads `state.perComponentThisTick.get(c.id).processed` every iteration
  and tests against `componentThroughputPerTick(c)`. The counter is only
  cleared in step 9 of the next tick. A component with `throughputPerTick =
  3` processes at most three requests across the entire tick, not three per
  iteration.
- **Delivery populates downstream pending within the same tick.** That is
  what makes the fixed-point loop actually converge: component A processes a
  request and stages a FORWARD to B, `deliverStaged` places it in B's
  pending, the next iteration visits B and processes it. Without this every
  hop would cost one tick.
- **Processing and delivery are not interleaved within one iteration.**
  processPending visits every component and stages every outcome before
  deliverStaged runs. This preserves determinism under the fixed visitation
  order — if deliverStaged could fire mid-visit, downstream components would
  see traffic mid-iteration that depends on upstream visit order.

### 5.3 Throughput gate and OVERLOADED

The throughput limit lives on the **component**, not per-capability.
Although the Stage 1 `Capability` interface exposes
`getThroughputPerTick?(tier: number): number`, only one PROCESS capability
runs per request (first `canHandle()` match), so component-scoped counters
are equivalent with less bookkeeping. The gate reads from the existing
`SimulationState.perComponentThisTick` counter structure (field name
`processed`) so no new counter field is introduced.

`componentThroughputPerTick(c)` is the helper defined in §10.1 — the sum
of `cap.getThroughputPerTick(c.getEffectiveTier(cap.id))` across every
PROCESS-phase capability on `c`, multiplied by `c.instanceCount`.
Summation (rather than max) matches the intuition that multiple PROCESS
capabilities on one component contribute independently — a component with
two PROCESS capabilities of 3 each can handle 6 requests per tick total.
The approximation cost (a component with multiple PROCESS capabilities
could over-serve one capability at the expense of another) is acceptable;
in the Phase 1 registry every component has a single PROCESS-phase
capability in practice.

**Fallbacks:**
- If a component has no PROCESS-phase capabilities, or if any
  PROCESS-phase capability does not implement `getThroughputPerTick`,
  `componentThroughputPerTick(c)` is `Infinity`. The gate comparison
  `processed < Infinity` is always true, so the gate is effectively
  disabled. Pure-INTERCEPT components (e.g. a hypothetical standalone
  Cache) do not rate-limit at this layer.
- The `Infinity` sentinel is the JavaScript `Number.POSITIVE_INFINITY`
  value. Comparisons and arithmetic with it behave as expected for the
  gate's `<` check.

**How "leftover in pending at end of tick" and "throughput gate" are the
same thing:** the gate in §5.2 stops `processPending` from dequeuing once
`perComponentThisTick.processed >= componentThroughputPerTick(c)`. Any
requests still sitting in `state.pending[c.id]` when the fixed-point loop
quiesces are exactly the requests that couldn't get through the gate this
tick. There is no separate "overload check" — the post-loop sweep in §5.3
just attributes OVERLOADED events to those leftover requests.

**OVERLOADED accounting runs once, after the fixed-point loop quiesces:**

```
for componentId in state.visitOrder:
  leftover = state.pending.get(componentId).length
  if leftover > 0:
    counters = state.perComponentThisTick.get(componentId)
    counters.overloaded += leftover
    for req in state.pending.get(componentId):
      state.appendEvent(req.id, {
        type: "OVERLOADED",
        tick: state.currentTick,
        componentId, capabilityId: null, connectionId: null, latencyAdded: 0
      })
    // pending requests remain in pending for next tick
```

**OVERLOADED fires every tick the request is still stuck.** A request that
sits pending for three consecutive ticks receives three OVERLOADED events —
one per tick it was unable to be processed. This is the simplest rule and
matches "metrics are fresh per tick." Cumulative OVERLOADED counts are a
straightforward reduce over `metricsHistory`. OVERLOADED is a counter event,
not a terminal state; the request stays in pending and eventually processes
or times out.

## 6. Delivery, backpressure, streams

### 6.1 Staged outcomes

`processPending` produces staged entries of shape:

```ts
type StagedOutcome = {
  sourceComponentId: ComponentId;   // component that produced the result
  request: Request;                 // the request that was processed
  result: ProcessResult;            // existing type: { outcome, sideEffects, events }
};
```

`deliverStaged(staged): boolean` walks the `ProcessResult` and returns
`moved`:

1. Append every event in `result.events` to `state.requestLog[request.id]`
   (authoritative history).
2. Interpret the primary outcome (`result.outcome.kind`): one of `RESPOND`,
   `FORWARD`, `DROP`, `QUEUE_HOLD`, or `PASS`.
3. Process every side effect (`result.sideEffects`): `SPAWN` (blocking or
   non-blocking) and `SCALE`. `SCALE` is honored in 2a by mutating
   `component.instanceCount` (no gradual ramp).
4. Return `true` iff any of the following happened: a request landed in a
   new runtime location (pending / blocked / bufferable / active-stream),
   or a request became terminal (RESOLVED / DROPPED / CHILD_FAILED /
   SIBLING_CANCELLED), or a blocking-SPAWN side effect created a child, or
   a non-blocking-SPAWN side effect created a child, or a SCALE side
   effect changed `instanceCount`. Return `false` only for the pure
   `PASS` case with no side effects (a rare "nothing happened" case that
   indicates a probable capability bug; the engine still appends any
   events but contributes no progress). `moved = false` is a safety
   value; practical capabilities should never produce it.

### 6.1.1 Egress selection for FORWARD

`FORWARD` outcomes do not carry a target — the producing component
decides the target by consulting its egress connections. The engine picks
a connection using this rule:

```
function selectEgressConnection(sourceComponentId, request, state, ctx):
  egresses = state.connections.values()
    .filter(c => c.sourceComponentId == sourceComponentId)
  if egresses.length == 0:
    return null  // FORWARD degrades to DROP(NO_EGRESS)

  # If the source component owns an EngineConsultable capability (e.g.
  # RoutingCapability, GeoRoutingCapability, CircuitBreakerCapability),
  # delegate to it.
  consultable = findFirst(source.capabilities, isEngineConsultable)
  if consultable != null:
    return consultable.selectConnection(request, egresses, ctx)

  # Fallback: round-robin across egress connections.
  # State: state.roundRobinCursor: Map<ComponentId, number>, default 0.
  cursor = state.roundRobinCursor.get(sourceComponentId) ?? 0
  egressesSorted = egresses.sortedByConnectionIdAscending()
  chosen = egressesSorted[cursor % egressesSorted.length]
  state.roundRobinCursor.set(sourceComponentId, cursor + 1)
  return chosen.id
```

Round-robin state lives in `SimulationState.roundRobinCursor:
Map<ComponentId, number>`, incremented on each fallback-selected FORWARD,
reset to 0 at the start of every wave. The deterministic sort by
`ConnectionId` ensures round-robin ordering is reproducible. Multiple
`EngineConsultable` capabilities on one component: the first match in
capability declaration order wins (deterministic).

**Primary outcome handling:**

| Outcome      | Delivery behavior                                                                                                                                                                      |
|--------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `PASS`       | No-op in delivery. The pipeline short-circuited (e.g. INTERCEPT → PASS → PROCESS handled it downstream). This branch should never actually be staged as a terminal outcome; asserts.   |
| `RESPOND`    | Walk return path via event log (§7.4), append `RESPONDED` event at origin, mark resolved. Instant. If `request.streamDuration != null`, also register an `ActiveStream` (§6.4). |
| `FORWARD`    | Select an egress connection (see "Egress selection" below). Consume bandwidth via `getEffectiveBandwidth`. If within budget → place in target's pending + `FORWARDED` event + `TRAVERSED` event with the selected `connectionId`. If exceeded → §6.2. If the source has no egress connections at all → `DROP` with `reason = NO_EGRESS`. |
| `DROP`       | Append `DROPPED` event on the source component. Increment `source.counters.drops` (and only the source — never the target, even if the request was about to be forwarded). Terminal. |
| `QUEUE_HOLD` | Hand the `(request, result)` pair to the **source component's own** `EngineBufferable.enqueueForRetry(request, result)` — QUEUE_HOLD is always self-directed, the source is itself a Queue. It goes into the Queue's `awaitingPipeline` buffer and is re-emitted in step 2 of the next tick, re-entering the Queue's own pipeline. If the source component has no `EngineBufferable` (i.e. it isn't actually a Queue), that's a registry bug and asserts. If the bufferable's `enqueueForRetry` returns `false` (buffer full), degrade to `DROP(reason=QUEUE_FULL)` and increment `counters.drops` on the source. Emit `QUEUED` event. |

### 6.2 Backpressure path

When a `FORWARD` outcome exceeds the effective bandwidth on its chosen
connection, the engine tries to hand the request to the **target component's**
`EngineBufferable`, passing the already-computed `ProcessResult` so
re-delivery does not re-run the target's pipeline (this matches the parent
spec's `awaitingDelivery` invariant):

1. If the target component has an `EngineBufferable` capability, call
   `bufferable.enqueueForRetry(request, originalResult)`.
2. If `enqueueForRetry` returns `true`:
   - Append `BACKPRESSURED` event on the request.
   - Increment `target.counters.backpressured`.
   - The request (paired with its `ProcessResult`) sits in the target's
     `awaitingDelivery` list until step 2 of the next tick, at which point
     `emitReady()` returns it in the `awaitingDelivery` partition and
     delivery re-attempts without re-running the pipeline.
3. If `enqueueForRetry` returns `false` (bufferable full), or if the target
   has no `EngineBufferable`:
   - Append `DROPPED` event with `reason = BACKPRESSURED` at the target.
   - Increment `target.counters.drops`.

**Counter attribution is always on the target**, not the source: backpressure
is about what the target can absorb. This matches the parent spec's rule that
each outcome increments exactly one counter on exactly one component per
tick.

**Backpressure is always a delivery concern, never a processing concern.**
The producing component's pipeline already decided the outcome. Delivery just
decides whether the outcome can be realized on the chosen connection this
tick.

### 6.2.1 How step 2 drains both buffer partitions

Step 2 (`reEmitQueued`) runs **once per tick**, before the fixed-point loop
opens. It iterates components in `state.visitOrder` (deterministic),
and for each component that owns an `EngineBufferable` capability, calls
`emitReady()` and handles the two partitions:

- **`awaitingPipeline: Request[]`** — requests that were placed in a
  QUEUE (via `QUEUE_HOLD`) and are now ready to enter the Queue
  component's own pipeline. Each is appended to the **tail** of the
  Queue component's own `pending` array (standard FIFO
  `enqueuePending`). The fixed-point loop in step 3 will pick them up
  when it visits the Queue component. Appending to tail — not front —
  preserves the global pending order: requests that were already
  waiting in the Queue's own pending (if any) are processed before the
  newly re-emitted ones.
- **`awaitingDelivery: { request, result }[]`** — requests that were
  backpressured with their already-computed `ProcessResult`. Each is
  pushed to `state.stagedOutcomes` **before** step 3 begins, so the
  first iteration's `deliverStaged` re-attempts delivery without
  re-running the source pipeline. If delivery fails a second time, the
  same backpressure path (§6.2) applies — the request can be
  re-buffered up to whatever cap the bufferable implements.

When multiple bufferable components emit in the same step 2, they are
processed in `state.visitOrder` — the same deterministic order used by
step 3 — so re-emission across components is deterministic.

### 6.3 The bandwidth and latency adapters

All bandwidth and latency reads in delivery go through two Engine methods:

```ts
class Engine {
  getEffectiveBandwidth(connectionId: ConnectionId): number;
  getEffectiveLatency(connectionId: ConnectionId): number;
}
```

In 2a, the bandwidth adapter returns:

```
connection.bandwidth
  - state.connectionLoadThisTick.get(connectionId)      // this tick's prior FORWARDs
  - Σ stream.reservedBandwidth for stream in state.activeStreams where stream.connectionId = connectionId
```

The latency adapter returns `connection.latency` in 2a (raw pass-through).

**All delivery sites must read through these methods** — no direct
`connection.bandwidth` or `connection.latency` reads in the delivery code
path. 2b will add chaos-induced reductions (`connection_sever` → effective
bandwidth 0; `latency_injection` → additional latency delta) by modifying
only the adapter bodies. Delivery code never branches on chaos state.

**Freshness within a single iteration.** The adapters read directly from
`state.activeStreams` and `state.connectionLoadThisTick`. A stream
registered earlier in the same iteration (by an earlier staged outcome)
is **immediately visible** to later bandwidth reads in the same
iteration: `deliverStaged` drains `state.stagedOutcomes` in FIFO order,
and any RESPOND→STREAM_STARTED that mutates `state.activeStreams` is
observed by later FORWARD deliveries in the same drain. Similarly, a
FORWARD that consumes bandwidth updates
`state.connectionLoadThisTick` immediately, so a second FORWARD on the
same connection in the same iteration sees the reduced remaining budget.

The adapters are the only 2a-visible surface where 2b will hook in its
chaos-override logic without touching delivery call sites.

**No double-counting of active-stream reservations.** The `bandwidth`
adapter subtracts `connectionLoadThisTick` (per-tick one-shot load) and
active-stream reservations independently. A stream registered at tick T
contributes to `activeStreams` — it does not also populate
`connectionLoadThisTick`. Stream bandwidth is an "evergreen" reservation;
FORWARD bandwidth is one-shot. They never overlap on the same slot.

### 6.4 Active streams (step 4b)

**Stream registration is a side effect of delivering a `RESPOND` outcome**
on a request whose `request.streamDuration != null`. In `deliverStaged`:

```
if outcome.kind == RESPOND and request.streamDuration != null:
  connectionId = pickStreamConnection(request, sourceComponentId, state)
  if connectionId == null:
    // No valid connection to reserve on — the stream can't exist.
    // Degrade the RESPOND to a DROP.
    appendEvent(request.id, { type: "DROPPED", reason: "NO_STREAM_EGRESS", ... })
    counters[sourceComponentId].drops += 1
    return moved = true

  state.registerActiveStream({
    requestId: request.id,
    connectionId,
    originComponentId: request.origin,
    baseRevenue: 0,                             // credited in 2b
    remainingDuration: request.streamDuration,
    reservedBandwidth: request.streamBandwidth ?? 0,
  })
  appendEvent(request.id, { type: "STREAM_STARTED", componentId: sourceComponentId, ... })
  // After registration, the normal RESPOND return-path walk still runs — the
  # client sees a RESPONDED event and the request is marked resolved. The
  # stream runs independently on its reserved connection until step 4b.
```

**`pickStreamConnection(request, sourceComponentId, state)` algorithm:**

```
function pickStreamConnection(request, sourceComponentId, state):
  # Prefer the last forward-path hop: the connection the request arrived on.
  # Walk the request log backward looking for the most recent TRAVERSED event.
  events = state.getEventsFor(request.id)
  for event in events.reverse():
    if event.type == "TRAVERSED" and event.connectionId != null:
      return event.connectionId
  # No forward path exists (the request was resolved at its entry component).
  # Fall back to the source component's first egress connection by sorted id.
  egresses = state.connections.values()
    .filter(c => c.sourceComponentId == sourceComponentId)
    .sortedByConnectionIdAscending()
  if egresses.length > 0:
    return egresses[0].id
  return null  // no valid connection → caller degrades to DROP
```

The "last forward-path hop" rule matches intuition: a stream served by a
StreamingServer reserves bandwidth on the connection the request used to
reach it, which is typically the last hop toward the origin. The sorted
fallback is deterministic because `ConnectionId` is a branded string.

Step 4b runs once per tick, **after** the fixed-point loop quiesces:

```
for stream in state.activeStreams.values():
  stream.remainingDuration -= 1
  if stream.remainingDuration == 0:
    state.releaseActiveStream(stream.requestId)
    state.appendEvent(stream.requestId, { type: "STREAM_COMPLETED", ... })
```

**Stream bandwidth model:** while active, a stream reserves
`reservedBandwidth` on a single connection (`stream.connectionId`) for the
full remaining duration. `getEffectiveBandwidth(connId)` subtracts the sum
of reservations on that connection before returning the value delivery
uses. This matches the existing `ActiveStream` shape in
`src/core/types/stream.ts` and the existing
`getActiveStreamsOnConnection(connId)` reader in `SimulationStateReader`.

**Rationale for single-connection reservation:** real streaming is
multi-hop and adaptive. Modeling it that way would explode complexity for
no teaching value. Reserving on one connection (the last hop in the stream
path) gives players a clean "this connection is saturated because of a
stream" signal. Topologies with deeper stream pipelines can add more
StreamingServer components on different connections to achieve the same
effect.

Streams are **exempt from step 5 TTL checks once active** (§7.3).

**Revenue crediting for streams** (per-tick while active) and for
non-stream requests (at RESPONDED) is deferred to 2b. 2a emits
`STREAM_STARTED`, `STREAM_COMPLETED`, and `RESPONDED` events so 2b's
economy code has clean consumption points.

## 7. SPAWN + response transport

### 7.1 Request lifecycle states

```
                   ┌──────────────────────────────────────┐
                   ▼                                      │
 injected ─► pending ─► blocked ─► (unblocked: front-of-pending)
                │         │
                │         ├──► CHILD_FAILED (terminal)
                │         │
                │         └──► TIMED_OUT (terminal)
                │
                ├──► buffered(awaitingPipeline) ─► pending (next tick step 2)
                │                              └─► TIMED_OUT (terminal)
                │
                ├──► buffered(awaitingDelivery) ─► (re-staged next tick step 2)
                │                              └─► TIMED_OUT (terminal)
                │
                ├──► active-stream ─► resolved (step 4b, when remainingDuration=0)
                │
                ├──► RESOLVED   (terminal)
                ├──► DROPPED    (terminal)
                └──► TIMED_OUT  (terminal)
```

Terminal states are never re-entered. Every non-terminal request is in
exactly one runtime location at a time — that is the implementation of
"state":

- **pending:** present in `state.pending.get(componentId)` for exactly one
  component.
- **blocked:** present in `state.blockedParents.get(request.id)` with a
  non-empty `blockedOn` set.
- **buffered (awaitingPipeline):** present in some bufferable's
  `awaitingPipeline` list (QUEUE_HOLD).
- **buffered (awaitingDelivery):** present in some bufferable's
  `awaitingDelivery` list (BACKPRESSURED).
- **active-stream:** present in `state.activeStreams.get(request.id)`.
- **resolved / dropped / timed_out:** terminal. Present in no runtime
  location; only in `state.requestLog`.

Property tests in §11.3 enforce the "exactly one location" invariant.

**SPAWN is a `SideEffect`**, not a primary outcome. `deliverStaged`
processes the primary outcome first (RESPOND / FORWARD / DROP / QUEUE_HOLD)
and then walks `result.sideEffects` and delivers each `SPAWN` with
`blocking: true | false`.

Every SPAWN creates a child request with
`child.ttl = min(parent.createdAt + parent.ttl - state.currentTick, childProvidedTtl)`
— the remaining parent TTL floors the child's TTL so the parent cannot
outlive itself through its children. `child.parentId = parent.id`. The
child enters the target component's pending.

### 7.2 Non-blocking SPAWN (typically from REPLICATE phase)

Fire-and-forget. Used for event fanout and replication writes.

- The parent has already produced its own primary outcome (usually RESPOND
  or FORWARD) in the same `ProcessResult`. The SPAWN side effect is
  processed independently.
- Child enters its target's pending as a fully independent request. It has
  its own lifecycle, own TTL, own eventual outcome.
- **Parent does not track child.** The parent does not enter the blocked
  pool. Child failure does not affect parent.
- **Child RESPOND does not propagate back to the parent.** When the child
  RESPONDs, it walks its own return path (origin = the component that
  spawned it, recorded in the child's origin field at spawn time, not the
  original client). A non-blocking child's RESPOND event is appended to its
  own log and the child is marked resolved; no further action is taken.
  Non-blocking children do not generate external replies to the original
  client.

### 7.3 Blocking SPAWN (PROCESS phase only)

Used for synchronous downstream calls:
`Server → blocking SPAWN → Database → RESPOND → Server re-processes with data → RESPOND`.

- Parent's PROCESS phase produces a `ProcessResult` with
  `outcome.kind = "PASS"` (the parent is not yet done) and
  `sideEffects: [{ kind: "SPAWN", request: child, blocking: true }]`.
- `deliverStaged` notices the blocking SPAWN side effect and:
  1. Creates the child request (applying TTL inheritance as in §7.1).
  2. Places the child into the target component's pending.
  3. Moves the parent into `state.blockedParents`:
     ```
     state.blockedParents.set(parent.id, {
       request: parent,
       originComponentId: sourceComponentId,   // where the parent was being processed
       blockedOn: new Set([child.id]),
       childResponses: new Map(),              // filled in as children RESPOND
     })
     ```
  4. Records an inverse lookup: `state.childToParent.set(child.id, parent.id)`.
- **Multiple blocking SPAWNs in one ProcessResult** extend the parent's
  `blockedOn` set and create additional `childToParent` entries.

- **When a blocking child RESPONDs**, `deliverStaged` runs the RESPOND path
  normally (appending RESPONDED event, walking return-path for scoring),
  then checks `state.childToParent.get(child.id)`. If the child has a
  parent:
  1. Look up the parent entry in `state.blockedParents`.
  2. **Late-arriving response handling:** if the parent entry is missing
     (because the parent was already transitioned to CHILD_FAILED by an
     earlier sibling failure, or the parent already timed out), also
     clean up `state.childToParent` for this child and return. The
     child's RESPOND still resolves normally as a completed request; the
     cleanup just prevents dangling references. No further action.
  3. Otherwise: append a `CHILD_RESOLVED` event to the parent's request
     log with metadata `{ childId: child.id }`. Store a
     `ChildResponseSnapshot` in `parent.childResponses.set(child.id, ...)`
     — the snapshot captures the child's final `outcome`, the full child
     event log at time of RESPOND, and the child's `returnLatency`.
  4. Remove `child.id` from `parent.blockedOn` and from
     `state.childToParent`.
  5. If `parent.blockedOn` is now empty:
     - Remove the parent entry from `state.blockedParents`.
     - Re-enter the parent into `state.pending[parent.originComponentId]`
       at the **front** of the queue (array `unshift`). Front insertion
       means the next iteration of the fixed-point loop visits the
       unblocked parent before any FIFO-ordered newcomers — critical for
       same-tick round-trips.
     - On re-processing, `ProcessContext.childResponses` is populated
       from `parent.childResponses` so the parent's capability can read
       the child results. Capabilities that don't care about child
       responses simply ignore the map.

- **Under normal load** the full round-trip happens in one tick — that is
  the whole reason fixed-point matters. Under load that forces the child
  into backpressure/queue, the parent remains in `blockedParents` across
  tick boundaries.

- **Multi-child partial failure (strict sibling cancellation):** if any
  blocking child transitions to a terminal failure (`DROP` or `TIMED_OUT`
  or `CHILD_FAILED`), the parent immediately:
  1. Transitions to terminal `CHILD_FAILED` state (append `CHILD_FAILED`
     event at `parent.originComponentId`, increment `counters.drops`).
  2. **Cancels all remaining blocking siblings.** For every other child in
     `parent.blockedOn`, the engine removes it from wherever it sits
     (pending queue, blocked pool, buffer) and marks it `DROP` with
     `reason = SIBLING_CANCELLED`, emitting `DROPPED` events and
     incrementing `counters.drops` at the site the cancellation hit. This
     prevents wasted work and keeps the lifecycle invariant clean.

  Rationale: strict cascade is simpler than partial-success and matches
  real backend behavior ("DB query failed → API call failed"). Capabilities
  may opt into fallback behavior later (a future `FallbackCapability`), but
  the engine default is fail-fast with sibling cancellation.

### 7.4 Response transport (return path reconstruction)

- Every request carries an append-only log in `state.requestLog[request.id]`.
- When `deliverStaged` handles a `RESPOND` outcome, it reconstructs the
  return path by walking the log forward through `TRAVERSED` events in the
  order they were appended. Every `TRAVERSED` event carries a
  `connectionId`. The return path is the reverse of that sequence — each
  connection becomes a return hop for latency bookkeeping.
- If the request was fully resolved locally (no `TRAVERSED` events, e.g. a
  Server directly RESPONDed without calling anything), the return path is
  empty and the return latency is 0. This is the normal case for cache
  hits.
- Return is **instant**: the origin is marked resolved in the same tick a
  `RESPONDED` event is appended at `request.origin`. The event's metadata
  carries:
  ```ts
  metadata: {
    returnLatency: number;              // Σ getEffectiveLatency over reverse path
    returnPath: ConnectionId[];         // reverse order, for diagnostics/scoring
    forwardLatency: number;             // Σ latencyAdded on forward events, for diagnostics
  }
  ```
  It does not consume a tick.
- A blocking-child RESPOND walks **only the child's own return path** —
  the child's request log. The parent's return path is reconstructed
  later, from the parent's own log, when the parent itself eventually
  RESPONDs (after re-processing with the child's snapshot in
  `ProcessContext.childResponses`).
- Responses **never fail**. No bandwidth check, no backpressure, no TTL
  check on the return path.
- Return latency uses the same `getEffectiveLatency` adapter as forward
  latency, so 2b's chaos overrides (e.g. `latency_injection`) apply
  symmetrically to response transport without extra code.

**Rationale for instant/never-fail returns:** modeling return-path failure
adds complexity for almost no teaching value. Players think about
*request* congestion, not response congestion. The asymmetry is deliberate
and simplifies scoring, chaos modeling, and metrics.

## 8. TTL and timeouts (step 5)

Runs once per tick, after the fixed-point loop and after
`updateActiveStreams`. Walks all non-terminal requests across every runtime
location and checks `request.createdAt + request.ttl <= state.currentTick`.

### 8.1 Locating requests for TTL scanning

Because `Request` is immutable and has no "current location" field, step 5
scans the runtime location structures themselves. The order of scanning is
deterministic and matches §7.1:

```
for componentId in state.visitOrder:
  for req in state.pending.get(componentId):     // pending
    if expired(req): timeoutInPending(req, componentId)

for entry in state.blockedParents.values():      // blocked pool
  if expired(entry.request):
    timeoutBlockedParent(entry)

for componentId in state.visitOrder:             // bufferables (both partitions)
  for cap in component.capabilities where cap implements EngineBufferable:
    for req in cap.awaitingPipeline:
      if expired(req): timeoutInBuffer(req, componentId, "awaitingPipeline")
    for entry in cap.awaitingDelivery:
      if expired(entry.request):
        timeoutInBuffer(entry.request, componentId, "awaitingDelivery")
```

Active streams are **not scanned** — they are exempt per §8.3.

### 8.2 Timeout handlers and cascade

```
timeoutInPending(req, componentId):
  removeFromPending(req, componentId)
  markTerminal(req, "TIMED_OUT", componentId)
  counters[componentId].timeouts += 1
  cascadeChildTimeoutToParent(req)   // if req was a blocking child
  cascadeParentTimeoutToChildren(req) // if req was a parent with blocking children

timeoutBlockedParent(entry):
  markTerminal(entry.request, "TIMED_OUT", entry.originComponentId)
  counters[entry.originComponentId].timeouts += 1
  state.blockedParents.delete(entry.request.id)
  cascadeParentTimeoutToChildren(entry.request)  // down-cascade

timeoutInBuffer(req, componentId, partition):
  removeFromBuffer(req, componentId, partition)
  markTerminal(req, "TIMED_OUT", componentId)
  counters[componentId].timeouts += 1
  cascadeChildTimeoutToParent(req)
```

**`cascadeParentTimeoutToChildren(parent)`** — down-cascade. If the parent
is in `state.blockedParents` (or was just removed), iterate
`entry.blockedOn` and for each child that is still non-terminal, remove it
from wherever it sits and mark it `TIMED_OUT` with counter attribution at
the component location. Recursive — a blocking grandchild also cascades.

**`cascadeChildTimeoutToParent(child)`** — up-cascade. Look up
`state.childToParent.get(child.id)`. If a parent entry exists in
`state.blockedParents`, apply the strict-cascade rule from §7.3: the
parent transitions to `CHILD_FAILED`, and every other child still in
`parent.blockedOn` at the moment the cascade fires ("remaining siblings")
is located (pending queue, blocked pool, or bufferable) and marked
terminal with `reason = SIBLING_CANCELLED`. If a sibling has already
reached a terminal state (because, say, two independent children timed
out in the same step 5 scan), the cancellation is a no-op for that one.
If the parent is no longer in `state.blockedParents` (late-arriving
timeout after parent already CHILD_FAILED via a different sibling), the
up-cascade is a no-op and `state.childToParent` is cleaned up for this
child.

**Cascade order is deterministic:**
- Up-cascade runs before down-cascade for a given timed-out request (so
  parents see the failure before siblings are touched).
- `blockedOn` is stored as a JavaScript `Set<RequestId>`. Per
  **ECMAScript 2015+ spec (§24.1 Map/Set Objects)**, Set iteration follows
  insertion order, which the engine relies on for deterministic cascade
  ordering. Children are inserted into `blockedOn` in the order their
  SPAWN side effects appear in the parent's `ProcessResult.sideEffects`
  array. If 2a ever runs on a non-compliant JavaScript runtime (none
  exist for our target), the cascade determinism would need to be
  re-verified.
- Recursive traversal is pre-order depth-first.

Recursion is bounded by the finite request tree.

### 8.3 Active streams exempt from TTL

Once a request transitions to an active stream (via the stream-registration
side effect of a RESPOND in §6.4), it is exempt from step 5 TTL checks. Active
streams run on their own `remainingDuration` countdown decremented in step 4b.
The initial TTL only governs whether the request reached its target alive:

- A stream request with `streamDuration = 20` and `ttl = 30` that reaches its
  StreamingServer on tick 5 registers as an active stream on tick 5 and
  completes on tick 25. TTL would nominally expire at tick 30, but the stream
  is exempt as soon as it registers.
- The same request with `ttl = 5` that reaches its StreamingServer on tick 3
  registers on tick 3 and completes on tick 23 — still fine, because it
  registered before TTL expired.
- The same request with `ttl = 2` that spends 3 ticks in pending times out
  normally on tick 2 via the pending-path timeout in §8.2. It never registers
  as a stream.

**Step ordering guarantees this works:** a RESPOND outcome handled during
step 3/4a in tick `T` registers the stream *before* step 5 of tick `T` runs
TTL checks, so a request that would time out "right at the moment of
registration" registers successfully and then becomes exempt in the same
tick. This is a deliberate modeling choice — the alternative (streams can
time out mid-play) is confusing to players and adds no teaching value.

## 9. Metrics and per-tick reset

### 9.1 Step 8 — recordMetrics

Stage 1 already defines `TickMetrics` in `src/core/types/metrics.ts`.
Stage 2a **extends** that shape with the additional per-component fields
`timedOut`, `pendingAtEndOfTick`, and `blockedAtEndOfTick`, and populates
neutral defaults for the 2b-owned fields. The final 2a shape:

```ts
export interface TickMetrics {
  readonly tick: number;

  // top-level (already present in Stage 1; 2a populates all of them)
  readonly requestsProcessed: number;
  readonly requestsResolved: number;
  readonly requestsDropped: number;
  readonly requestsOverloaded: number;
  readonly requestsBackpressured: number;
  readonly requestsTimedOut: number;

  // 2b-owned, neutral defaults in 2a
  readonly revenueEarned: number;     // 0 in 2a
  readonly upkeepPaid: number;        // 0 in 2a
  readonly avgLatency: number;        // computed from resolved-request latencies in 2a

  readonly perComponent: ReadonlyMap<
    ComponentId,
    {
      // Existing Stage 1 fields — past-participle naming
      processed: number;
      dropped: number;
      overloaded: number;
      backpressured: number;
      condition: number;             // existing; 2a populates 1.0 (healthy), 2b populates real value
      // NEW in 2a — all past-participle / camelCase to match existing style
      timedOut: number;
      pendingAtEndOfTick: number;
      blockedAtEndOfTick: number;
    }
  >;
}
```

**Naming convention:** `TickMetrics.perComponent` uses past-participle
field names (`processed`, `dropped`, `overloaded`, `backpressured`,
`timedOut`) as the reader-facing shape. The internal
`SimulationState.perComponentThisTick` counter struct uses different field
names (`processed`, `drops`, `timeouts`, `overloaded`, `backpressured`)
because it's a plain counter bag. `recordMetrics` in step 8 is the single
site that translates between the two naming styles:

```ts
function buildPerComponent(state: SimulationState): Map<ComponentId, ...> {
  const result = new Map();
  for (const [id, c] of state.components) {
    const raw = state.perComponentThisTick.get(id) ?? defaultCounters();
    const pending = state.pending.get(id)?.length ?? 0;
    const blocked = countBlockedAt(state, id);
    result.set(id, {
      processed: raw.processed,
      dropped: raw.drops,            // rename drops → dropped
      overloaded: raw.overloaded,
      backpressured: raw.backpressured,
      timedOut: raw.timeouts,        // rename timeouts → timedOut
      pendingAtEndOfTick: pending,
      blockedAtEndOfTick: blocked,
      condition: 1.0,                // 2b populates
    });
  }
  return result;
}
```

The split is deliberate: the counter bag uses terse verb-plural names
optimized for hot-path increments, while the metrics snapshot uses
reader-friendly past-participle names. Do not unify them.

`recordMetrics` appends one snapshot per tick to
`state.metricsHistory: TickMetrics[]`. The 2a implementation reads directly
from `state.perComponentThisTick`, `state.pending`, `state.blockedParents`,
and `state.activeStreams` to build the snapshot.

`avgLatency` is computed as the mean of forward-path latencies for requests
resolved (`RESPONDED` or terminal non-timeout) during this tick. Latency is
already recorded in `RequestEvent.latencyAdded`; the average is over the
sum across each resolved request's log entries for this tick. Requests
that did not resolve contribute nothing.

**Fresh per tick, not cumulative.** Cumulative views are a simple reduce
over `metricsHistory`. Mode controllers score per-tick and per-wave
separately; renderers show current state; fresh-per-tick means every tick
is independently auditable.

**Updating the existing `TickMetrics` interface** is part of Stage 2a's
type-surface changes (§10). Adding the three new per-component fields is a
source-compatible change — readers that don't use them are unaffected.

### 9.2 Step 9 — resetPerTickState

- Clear per-tick counters on every component (already captured into the
  metrics snapshot).
- Assert `stagedOutcomes.isEmpty()` as a sanity check — `deliverStaged`
  should have drained it.
- Call `Capability.resetPerTickState?()` on every capability that implements
  the optional hook.
- Reset per-tick bandwidth consumption on every connection. Stream
  reservations persist; one-shot FORWARD consumption does not.

## 10. Interfaces and API changes

### 10.1 Capability interface (unchanged from Stage 1)

Stage 1's `Capability` interface
(`src/core/capability/capability.ts`) already exposes the two hooks Stage 2a
needs. Stage 2a does not modify the interface:

```ts
// existing in Stage 1, reproduced for reference
export interface Capability {
  readonly id: CapabilityId;
  readonly phase?: Phase;
  canHandle(requestType: string): boolean;
  process(request: Request, context: ProcessContext): ProcessResult;
  getUpkeepCost(tier: number): number;
  getThroughputPerTick?(tier: number): number;  // already exists
  getStats(): CapabilityStats;
  configure?(config: unknown): void;
  resetPerTickState?(): void;                   // already exists
}
```

Stage 2a wires these existing hooks into the engine:

- **`getThroughputPerTick(tier)`** — called in §5.2's fixed-point loop to
  compute `componentThroughputPerTick(c)`. It is an optional hook; a
  capability that does not implement it contributes `Infinity` to the sum
  (i.e., does not gate). The computation in the engine is:

  ```ts
  function componentThroughputPerTick(c: Component): number {
    let total = 0;
    for (const cap of c.capabilities) {
      if (cap.phase !== "PROCESS") continue;
      const impl = cap.getThroughputPerTick;
      if (impl == null) return Infinity;        // any unbounded cap unbounds the component
      const tier = c.getEffectiveTier(cap.id);
      total += impl.call(cap, tier);
    }
    return total * c.instanceCount;
  }
  ```

  If the sum is `Infinity` the throughput gate in §5.2 is effectively
  disabled (the `<` comparison against `Infinity` is always true).

- **`resetPerTickState()`** — called in step 9 (§9.2) on every capability
  that implements it. Unchanged signature.

### 10.1.1 ProcessContext addition

`ProcessContext` (`src/core/capability/process-context.ts`) already exists
in Stage 1. Stage 2a **adds one field** to support blocking SPAWN re-entry:

```ts
export interface ProcessContext {
  // ... existing Stage 1 members unchanged ...

  /**
   * Child responses from prior blocking SPAWNs, keyed by child RequestId.
   * Populated by the engine when re-entering a parent that was unblocked
   * after all its blocking children resolved. Empty on first processing
   * or for requests that never spawned blocking children. Capabilities
   * that did not spawn blocking children simply ignore this field.
   */
  readonly childResponses: ReadonlyMap<RequestId, ChildResponseSnapshot>;
}

export type ChildResponseSnapshot = {
  readonly outcome: PrimaryOutcome;           // the child's final primary outcome (usually RESPOND)
  readonly events: readonly RequestEvent[];    // the child's full event log (read-only snapshot)
  readonly returnLatency: number;              // the child's return-path latency, for parent bookkeeping
};
```

`childResponses` is a fresh empty map on first entry. On re-entry after a
blocking SPAWN round-trip, the engine populates it with one entry per
blocking child that RESPONDed. Capabilities that never produced blocking
SPAWNs see an empty map and ignore it.

### 10.2 Engine sub-interface: EngineBufferable (existing, unchanged)

Stage 1 already defines this interface in
`src/core/capability/engine-interfaces.ts`. Stage 2a wires it into the
backpressure and QUEUE_HOLD paths without modification. For reference:

```ts
export interface EngineBufferable {
  enqueueForRetry(request: Request, result: ProcessResult): boolean;
  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  };
  dequeueBatch(n: number): Request[];
}
```

- `awaitingPipeline` is the QUEUE_HOLD buffer: these requests re-enter the
  component's own pipeline from the top in step 2 of the next tick.
- `awaitingDelivery` is the backpressure buffer: each entry carries the
  already-computed `ProcessResult`, so re-delivery in step 2 goes straight
  into `state.stagedOutcomes` without re-running the pipeline.

Stage 2a does not modify this interface. Stage 2a does require every Queue
component's capability to implement it.

### 10.3 Engine surface additions

```ts
export class Engine {
  constructor(opts: {
    mode: ModeController;
    initialState: SimulationState;
    rng: DeterministicRng;                // existing Stage 1 seeded RNG
  });

  // ... existing Stage 1 methods ...

  getEffectiveBandwidth(connectionId: ConnectionId): number;
  getEffectiveLatency(connectionId: ConnectionId): number;
}
```

Both adapters are the single site where 2b will consult chaos overrides. In
2a they return the raw connection values (bandwidth is additionally
discounted by `connectionLoadThisTick` and active-stream reservations, as
in §6.3). **All delivery code must read through these methods** — no direct
`connection.bandwidth` or `connection.latency` reads in the delivery code
path.

`DeterministicRng` is the existing Stage 1 seeded RNG (`src/core/engine`).
The engine's determinism test (§11.2) passes two fresh engines the same
initial seed, topology, and traffic schedule, then compares
`metricsHistory` byte-for-byte.

### 10.4 SimulationState additions

```ts
// additions to src/core/state/simulation-state.ts
export class SimulationState {
  // ... existing Stage 1 members ...

  visitOrder: ComponentId[] = [];           // computed at engine construction; see below

  stagedOutcomes: StagedOutcome[] = [];     // scratch, drained every iteration

  blockedParents: Map<RequestId, BlockedParentEntry> = new Map();

  childToParent: Map<RequestId, RequestId> = new Map();

  roundRobinCursor: Map<ComponentId, number> = new Map();  // fallback egress selection

  metricsHistory: TickMetrics[] = [];
}

export type StagedOutcome = {
  sourceComponentId: ComponentId;
  request: Request;
  result: ProcessResult;
};

export type BlockedParentEntry = {
  request: Request;
  originComponentId: ComponentId;
  blockedOn: Set<RequestId>;            // insertion-ordered, relied on
  childResponses: Map<RequestId, ChildResponseSnapshot>;
};

export type ChildResponseSnapshot = {
  outcome: PrimaryOutcome;
  sideEffects: readonly SideEffect[];
  latency: number;                      // cumulative forward-path latency
};
```

Note that `activeStreams` is already defined on `SimulationState` in
Stage 1 as `Map<RequestId, ActiveStream>` and already matches the 2a shape.
The existing `ActiveStream` type (`src/core/types/stream.ts`) is unchanged:
single `connectionId`, `originComponentId`, `baseRevenue`,
`remainingDuration`, `reservedBandwidth`.

**`visitOrder` rebuild policy and initialization (2a invariant):**

- The `Engine` constructor computes the initial `visitOrder` by sorting
  `state.components.values()` by `(zone, placementTick, componentId)` and
  writing the result to `state.visitOrder`. This runs before the first
  tick starts.
- Topology is **immutable during a running tick.** Components cannot be
  added or removed between steps 1 and 10 of the same tick.
- Between ticks (in TD mode: between waves, not mid-wave), the engine
  rebuilds `visitOrder` by the same sort if `state.components` has
  changed since the last build.
- Mid-wave topology changes are **explicitly out of scope for Stage 2a.**
  Sandbox mode's dynamic topology is deferred to Stage 2c.
- 2a asserts the invariant: attempting to `placeComponent` or
  `removeComponent` while `state.phase === "simulate"` throws
  `IllegalStateError`.
- `roundRobinCursor` is initialized to an empty Map and entries are added
  lazily on first fallback selection. It is also cleared at wave start.

The sort uses JavaScript's default string comparison on `componentId`
values (branded strings in `ids.ts`). Because `ComponentId` is globally
unique and stable, the sort is deterministic by value.

### 10.5 Request event type additions

Stage 2a adds the following event types to the `RequestEventType` union in
`src/core/types/request.ts`:

```ts
export type RequestEventType =
  // ... existing Stage 1 types ...
  | "CHILD_RESOLVED"        // emitted at parent's origin when a blocking child RESPONDs
  | "CHILD_FAILED"          // emitted at parent's origin when strict cascade fires
  | "SIBLING_CANCELLED"     // emitted on a blocking sibling when cascade cancels it
  | "STREAM_STARTED"        // emitted when a RESPOND registers an ActiveStream
  | "STREAM_COMPLETED";     // emitted when an ActiveStream reaches remainingDuration=0
```

Stage 1 already has `SPAWNED_SUB` (used when a SPAWN side effect creates a
child). Stage 1 already has `RESPONDED`, `DROPPED`, `TIMED_OUT`,
`BACKPRESSURED`, `OVERLOADED`, `TRAVERSED`. No renaming.

### 10.6 Error types

```ts
// src/core/engine/errors.ts
export class FixedPointRunaway extends Error {
  constructor(
    public readonly state: SimulationState,
    public readonly iterations: number,
  ) {
    super(
      `Fixed-point loop failed to quiesce after ${iterations} iterations. ` +
      `This indicates a bug: either a processing cycle that never terminates, ` +
      `or a capability that unconditionally stages new work on every visit.`
    );
  }
}

export class IllegalStateError extends Error {}
```

### 10.7 Constants

```ts
// src/core/engine/constants.ts
export const FIXED_POINT_CAP = 256;
```

Exported for test access. Any test that observes the cap being hit is a
failing test.

### 10.8 Out of scope for Stage 2a

- Component/connection mutation during `phase === "simulate"`
- Stream-child bandwidth accounting for non-blocking SPAWN streams (deferred
  to 2b — the issue is whether a non-blocking SPAWNed stream child should
  charge cost to its parent; 2a does not model cost)

## 11. Testing strategy

Stage 1 shipped 93 tests. Stage 2a will add roughly 150–200 more; that is an
estimate, not a budget. The real target is full coverage of every behavior
named in §4–§9, with determinism and conservation properties as a safety net.

### 11.1 Unit tests (`tests/unit/`)

Isolated helpers, one test file per function:

- `computeVisitOrder`: determinism under permuted input, stable tie-breaking.
- `getEffectiveBandwidth`: stream reservation subtraction math.
- `getEffectiveLatency`: raw passthrough in 2a (chaos-aware in 2b).
- `reconstructReturnPath`: walks event logs correctly, sums latency correctly.
- `cascadeTimeout`: recursive cascade termination, bounded by request tree.
- `deliverOutcome` (one test per outcome type in isolation).
- `processPending` inner loop: throughput gate enforcement in isolation.
- `resetPerTickState`: counters cleared, hooks called, staged buffer asserted empty.
- Fixed-point loop: quiescence on empty, single-pending, and degenerate cases.
- Fixed-point cap: iteration cap throws `FixedPointRunaway`, never silently
  truncates.

### 11.2 Integration tests (`tests/integration/`)

Whole engine, realistic topologies:

- **Stage 1 smoke test still passes** (regression floor — the old Client →
  Server test should continue to pass with the new engine because the
  semantics are a subset).
- **Same-tick multi-hop:** `Client → LB → Server → DB → RESPOND → Client`
  resolves in one tick under no-load.
- **Throughput gate:** `throughputPerTick = 3`, inject 10 requests, assert 3
  processed and 7 OVERLOADED events at end of tick, 7 still pending at start
  of next tick.
- **Backpressure with bufferable:** saturate a connection to a target that
  implements `EngineBufferable`. Assert `BACKPRESSURED` + `BUFFERED` events,
  assert re-emission in step 2 of next tick.
- **Backpressure without bufferable:** saturate a connection to a target with
  no bufferable. Assert `DROP(BACKPRESSURED)`.
- **Queue hold:** Queue component's INTERCEPT produces `QUEUE_HOLD` → the
  request enters the Queue's own `awaitingPipeline` buffer via
  `enqueueForRetry(request, result)` → step 2 of the next tick calls
  `emitReady()` and takes the `awaitingPipeline` partition → those requests
  re-enter the Queue's own `pending` and run through its pipeline from the
  top.
- **Backpressure re-drive:** a backpressured FORWARD enters the target's
  `awaitingDelivery` partition with its `ProcessResult` intact → step 2 of
  the next tick takes the `awaitingDelivery` partition and re-stages it
  directly into `state.stagedOutcomes`, skipping the pipeline.
- **Blocking SPAWN round-trip:** `Server → blocking SPAWN → DB → RESPOND →
  Server re-processes → RESPOND → Client`, all in one tick.
- **Blocking SPAWN child drop cascade:** child DROPs → parent fails with
  `CHILD_FAILED`.
- **Blocking SPAWN child timeout cascade:** child TTL expires → parent fails
  with `CHILD_FAILED`.
- **Non-blocking SPAWN independence:** REPLICATE produces a fanout, some
  children fail, parent still resolves normally.
- **TTL parent cascade down:** parent times out while blocked, blocking
  children also transition to TIMED_OUT.
- **Stream lifecycle:** `STREAM_START` → 20 ticks active → `STREAM_COMPLETED`,
  bandwidth reserved the whole time, released on completion.
- **Stream congestion (concrete):** a connection with `bandwidth = 100`
  carries one active stream with `reservedBandwidth = 60`. A non-stream
  FORWARD with size 50 attempts to traverse the same connection:
  `getEffectiveBandwidth` returns `100 - 0 (no other load yet) - 60
  (stream reservation) = 40`, so the FORWARD exceeds the budget and hits
  the backpressure path in §6.2. A FORWARD with size 30 on the same
  connection succeeds because `30 <= 40` and bumps
  `connectionLoadThisTick` by 30; a subsequent FORWARD with size 20 in the
  same tick sees effective bandwidth `100 - 30 - 60 = 10` and also
  backpressures because `20 > 10`. This test exercises the full
  `getEffectiveBandwidth` subtraction logic from §6.3.
- **Stream TTL exemption:** a stream request with `streamDuration = 20` and
  `ttl = 30` completes normally even though it is "alive" past its ttl
  relative to `createdAt`.
- **Determinism:** same seed + topology + traffic schedule → byte-identical
  `metricsHistory[]` across two runs.

### 11.3 Property tests (opt-in, high value)

- **Conservation.** At the end of every tick, for the set of all requests
  that have ever been injected up to and including this tick, the following
  identity holds:
  ```
  totalInjected
    == Σ_c counters[c].processed.resolved
     + Σ_c counters[c].drops              // terminal drops incl. backpressure/sibling-cancel
     + Σ_c counters[c].timeouts           // terminal timeouts
     + Σ_c pending[c].length              // still in some component's pending
     + state.blockedParents.size          // blocked parents waiting on children
     + Σ_c (awaitingPipeline.length + awaitingDelivery.length)  // buffered
     + state.activeStreams.size           // active streams
  ```
  where "processed.resolved" is requests that reached a terminal RESPONDED
  state this tick or earlier. Any child request fully replaces its parent
  in the "injected" count (because children are themselves Requests that
  go through `injectTraffic`-equivalent registration at spawn time and are
  counted on registration, not on their parent's original injection).
- **No dual-location:** no request is in more than one runtime location
  simultaneously (pending vs. blocked vs. buffered vs. active-stream vs.
  terminal).
- **Visitation stability:** permuting component insertion order produces
  identical traversal order.
- **Fixed-point determinism:** same staged-outcome sequence produces identical
  delivery order regardless of spurious in-memory rehashing.

### 11.4 What is not tested in 2a

- Condition update, chaos events, upkeep/economy math → 2b.
- Renderer output, React integration → Phase 2.
- Stress / perf benchmarks (useful, but not an exit criterion for 2a).

## 12. Exit criteria

Stage 2a is complete when:

1. All tick steps 1, 2, 3, 4a, 4b, 5, 8, 9, 10 are implemented as described.
2. Steps 6, 6b, 7 are stubbed as no-op functions with the correct call sites.
3. The full integration test list in §11.2 passes.
4. The full unit test list in §11.1 passes.
5. The conservation property test passes over a randomized topology suite
   of at least 100 generated topologies (2–12 components, 1–4 zones,
   random traffic schedules drawn from a fixed RNG seed for
   reproducibility).
6. `pnpm typecheck` passes with strict settings (`exactOptionalPropertyTypes`,
   `noUncheckedIndexedAccess`).
7. The Stage 1 smoke test passes unchanged.
8. The Engine type surface exposes `getEffectiveBandwidth` and
   `getEffectiveLatency` adapters so 2b can add chaos overrides without
   touching delivery sites.

## 13. Open questions

None blocking Stage 2a. Deferred items are explicitly tagged for Stage 2b
(§3) and do not require decisions during 2a implementation.

# Stage 3e — Waves 6+7 Augmentation Design

**Status:** Design approved 2026-04-14. Spec-first augmentation — existing code retained, gaps filled with TDD.

## 1. Goal

Wave 6 ("Async Workloads") teaches that synchronous Server processing can't handle batch-heavy traffic at 250 req/tick — the player learns to add a **Queue** for backpressure absorption and a **Worker** for dedicated batch processing. Wave 7 ("The Outage") teaches that component failures cascade through an unprotected topology — the player learns to add a **Circuit Breaker** that isolates failures and recovers automatically.

Both waves build on the Wave 5 rescue topology (CDN + Gateway + Cache + LB + 2×Server + DB). The player adds 2–3 new components per wave.

## 2. Architectural context (source-dive findings)

These findings drove the augmentation scope:

1. **Engine wiring is complete.** `reEmitQueued` (tick step 2) drains `QUEUE_HOLD` buffered requests. `injectChaos` (tick step 6b) consumes `getScheduledChaos()` from the mode controller and applies `component_failure` / `zone_outage` condition zeroing. No engine changes needed.

2. **QueueCapability implements EngineBufferable.** `enqueueForRetry()`, `emitReady()`, `dequeueBatch()`, `peekBuffered()`, `removeRequest()` are all implemented. The engine's `deliverStaged` emits `QUEUE_HOLD` outcomes that route here. Buffer drains via `reEmitQueued` next tick.

3. **BatchProcessingCapability processes `batch` type.** `canHandle("batch")` returns true, PROCESS phase, tier×5 throughput per tick. Outcome is RESPOND. No pull semantics needed — requests route normally through connections.

4. **CircuitBreakerCapability has a complete state machine.** CLOSED → OPEN (after threshold failures) → HALF_OPEN (after cooldown) → CLOSED (on success). Tier-1: threshold 5, cooldown 10 ticks. OPEN state fast-fails with DROP/circuit_open.

5. **`getScheduledChaos()` resolves symbolic targets.** `targetType: "server", targetIndex: 0` → resolves to the first server in topology via `resolveTargetByType()`. Wave-relative tick offsets (0 = first simulate tick) are converted via `waveStartTick`.

6. **EnginePullable is stubbed — not needed.** `BatchProcessingCapability.pullPending()` returns empty and the engine never calls it. Workers consume requests through normal PROCESS-phase routing via connections. This is the intended design for Wave 6.

7. **REPLICATE fan-out is unimplemented.** No engine code implements multi-dispatch. The `event` type (5% of Wave 6 composition) requires REPLICATE, so it must be **dropped from Wave 6** and deferred to a future stage.

8. **forwarding-pipe.handledTypes already includes `batch`.** Current list: `["api_read", "api_write", "static_asset", "auth_required", "batch", "event", "stream"]`. Throughput: 500/tick. Sufficient for both waves.

## 3. Scope: what changes vs. what stays

### Stays as-is (no code changes)

- Engine tick loop (all 10 steps)
- QueueCapability, BatchProcessingCapability, CircuitBreakerCapability implementations
- TD component entries: QUEUE_ENTRY ($125), WORKER_ENTRY ($125), CIRCUIT_BREAKER_ENTRY ($100)
- `registerTDDefaults` capability factories for queue, batch-processing, circuit-breaker
- `getScheduledChaos()` and chaos resolution in TDModeController
- Loss-path integration tests (wave-6-server-only-loses, wave-7-no-breaker-loses)

### Changes

| Change                                    | Slice |
|-------------------------------------------|-------|
| Drop `event` type from WAVE_6 composition | A     |
| Win-path integration test: Wave 6         | A     |
| Win-path integration test: Wave 7         | B     |
| Test helpers: buildQueue, buildWorker, buildCircuitBreaker | A     |
| Diagnostic stat assertions in win tests   | A+B   |
| Handoff docs: implementation-status, gotchas | C     |

## 4. Slice A — Wave 6 completion

### 4a. WAVE_6 composition change

Drop `event` (0.05) and redistribute to `batch`:

**Before:**
```
api_read: 0.25, api_write: 0.15, static_asset: 0.25,
auth_required: 0.15, batch: 0.15, event: 0.05
```

**After:**
```
api_read: 0.25, api_write: 0.15, static_asset: 0.25,
auth_required: 0.15, batch: 0.20
```

Rationale: `event` requires REPLICATE fan-out which doesn't exist. Redistributing to `batch` strengthens the Queue/Worker teaching moment — 20% of 250/tick = 50 batch req/tick, which overwhelms a single Server (throughput 20/tick) but is manageable with Queue buffering + Worker (5/tick batch processing) as a secondary processor.

All other WAVE_6 fields unchanged:
- intensity: 250, duration: 30, ttl: 12
- startingBudget: $1000, connectionBandwidth: 500
- availableComponents: server, database, cache, load_balancer, cdn, api_gateway, queue, worker
- SLA: 93% availability, 7ms max latency, $0 min budget, $6 penalty/tick
- keyPoolSize: 15, dropThreshold: 0.05
- revenuePerRequestType: api_read=$1, api_write=$2, static_asset=$0.30, auth_required=$1.50, batch=$5

### 4b. Test helpers

Three new builders in `tests/integration/td/helpers.ts`, following the existing pattern:

```ts
buildQueue(compRegistry)         → { component, ingressPortId, egressPortId }
buildWorker(compRegistry)        → { component, ingressPortId, egressPortId }
buildCircuitBreaker(compRegistry) → { component, ingressPortId, egressPortId }
```

Each calls `compRegistry.create(type, { x: 0, y: 0 }, null)` and extracts ports via the existing `singlePortIds()` utility (or equivalent inline extraction).

### 4c. Wave 6 win-path test: `wave-6-queue-worker-wins.test.ts`

**Rescue topology:**
```
Client → CDN → Gateway → Cache → LB → [Server×2] → Database
                                    ↘ Queue → Worker
```

Queue sits on a branch off LB (or directly off Cache, depending on routing). Worker processes `batch` requests. The Queue absorbs overflow when Worker is saturated; `reEmitQueued` drains buffer next tick.

**Assertions:**
1. `result.outcome.verdict === "win"` — SLA passes
2. `result.outcome.slaResults.availability.passed === true`
3. Queue diagnostic: `queueCap.getStats().totalEnqueued > 0` — proves Queue absorbed backpressure
4. Queue diagnostic: `queueCap.getStats().totalDroppedFull === 0` — no overflow
5. Worker diagnostic: Worker's `processedCountByComponent` > 0 — Worker actually processed requests

### 4d. Tuning considerations

- **Batch throughput budget:** 50 batch req/tick (20% of 250). Server's ProcessingCapability `handledTypes` is `["api_read", "static_asset", "auth_required"]` — **Server does NOT handle `batch`**. Batch requests that reach Server are PASS'd (not processed), eventually timing out or dropping. Only Worker (BatchProcessingCapability, `canHandle("batch")`) processes them.
- **Worker throughput:** 5/tick at tier 1. With 50 batch/tick arriving, Worker is overwhelmed. Queue absorbs overflow (tier-1 capacity: 32 slots). `reEmitQueued` drains buffer next tick. At sustained 50/tick with Worker processing 5/tick, Queue fills in ~1 tick. **This means the win may require tier-2 Queue (64 slots) or 2 Workers.** Verify in test — if tier-1 Queue overflows, either bump Queue tier in TD entry or adjust the rescue topology.
- **Connection routing:** forwarding-pipe routes all types (handledTypes includes `batch`). LB distributes across all egress connections equally. Batch requests split between Server path (where they're PASS'd/dropped) and Queue→Worker path (where they're processed). The teaching moment: without Queue/Worker, batch requests have no processor and availability collapses. With Queue/Worker, the dedicated path handles them.

## 5. Slice B — Wave 7 completion

### 5a. WAVE_7 — no composition change needed

Wave 7 also has `event: 0.05`. For consistency with Wave 6, drop it and redistribute to `batch` (now 0.20). All chaos and SLA fields stay:

**After:**
```
api_read: 0.25, api_write: 0.15, static_asset: 0.25,
auth_required: 0.15, batch: 0.20
```

- intensity: 350, duration: 30, ttl: 12
- startingBudget: $1200, connectionBandwidth: 600
- chaosSchedule: tick 15 component_failure server[0], tick 22 component_failure server[0]
- availableComponents: + circuit_breaker
- SLA: 90% availability, 8ms max latency, $-200 min budget, $8 penalty/tick

### 5b. Wave 7 win-path test: `wave-7-breaker-rescue-wins.test.ts`

**Rescue topology:**
```
Client → CDN → Gateway → Cache → LB → CircuitBreaker → [Server×2] → Database
                                    ↘ Queue → Worker
```

CircuitBreaker sits between LB and Servers. When Server[0] fails at tick 15 (chaos), CircuitBreaker detects failures, trips OPEN, and stops routing to the dead server. After cooldown (10 ticks at tier 1), transitions to HALF_OPEN, probes, and recovers.

**Assertions:**
1. `result.outcome.verdict === "win"` — SLA passes despite chaos
2. `result.outcome.slaResults.availability.passed === true`
3. CircuitBreaker diagnostic: `cbCap.getStats().requestsBlocked > 0` — proves circuit tripped during chaos
4. Availability: `result.outcome.slaResults.availability.value >= 0.90` — meets the relaxed SLA

### 5c. Chaos verification

The existing `getScheduledChaos()` implementation resolves `targetType: "server", targetIndex: 0` to the first server's componentId. The engine's `injectChaos` (step 6b) sets that component's condition to 0 for the chaos window.

**What the test implicitly verifies:**
- Chaos fires at tick 15 (wave-relative) → Server[0] condition drops to 0
- Server[0] stops processing (condition 0 = throughput gated to 0)
- Without CircuitBreaker: requests pile up, timeout, availability collapses → loss (existing test)
- With CircuitBreaker: circuit trips OPEN after 5 failures, fast-fails remaining requests to Server[0] path, healthy Server[1] handles traffic → win (new test)

### 5d. Tuning considerations

- **CircuitBreaker placement:** Between LB and Servers. LB distributes across Server[0] and Server[1]. When Server[0] fails, requests routed to it fail → CircuitBreaker counts failures → trips OPEN → subsequent requests to that path are fast-failed (DROP/circuit_open). LB continues routing to Server[1].
- **Topology question:** Does CircuitBreaker protect one server or all? The INTERCEPT phase runs on the component it's attached to. If CB is a separate component in the path, it intercepts traffic *before* reaching a specific server. But CB only has one egress port — it can only protect one downstream path. **For Wave 7, the simplest topology may be: LB → CB → Server[0] and LB → Server[1]. CB protects the chaos target.**
- **Alternative:** Two CircuitBreakers — one per server. More resilient but more expensive ($200 total). Budget ($1200) supports this.
- **Risk:** CircuitBreaker cooldown is 10 ticks. Chaos hits at tick 15 and 22. After tick 15: CB trips OPEN at ~tick 16-17 (5 failures), stays OPEN for 10 ticks until ~tick 26-27. Second chaos at tick 22 hits during OPEN window → no additional damage. CB recovers at ~tick 27, probes, succeeds → CLOSED. Only 3 ticks of healthy operation before wave ends (tick 30). This should be enough for the win if Server[1] carried the load during the OPEN window.

## 6. Slice C — Handoff documentation

### 6a. Update `docs/claude/implementation-status.md`

- Stage line: "Phase 1, Stage 3e augmented. TD mode playable through Wave 7..."
- Add Stage 3e augmentation paragraph describing: event type dropped, win-path tests added, diagnostic assertions, Queue/Worker/CircuitBreaker rescue paths verified
- Update test count

### 6b. Update `docs/claude/td-stage-gotchas.md`

Add Stage 3e section:
- `event` type dropped from Waves 6+7; REPLICATE fan-out deferred
- EnginePullable intentionally stubbed — Workers process via normal PROCESS routing
- Queue capacity at tier 1 (32 slots) may fill fast at 250/tick — tier 2 (64) or multiple Workers may be needed for robust rescue
- CircuitBreaker cooldown (10 ticks at tier 1) means recovery from tick-15 chaos happens at ~tick 26-27, leaving only 3-4 ticks of healthy operation
- Connection bandwidth overrides (500 Wave 6, 600 Wave 7) prevent connection-level bottlenecks
- Chaos targets "first server" by iteration order — test topology must ensure the intended server is the first one placed

### 6c. Update `CLAUDE.md`

Update current stage line to reflect augmentation completion and new test count.

### 6d. Update `docs/claude/implementation-status.md` next-candidates

Remove Stage 3e items that are now done. Update deferred list:
- REPLICATE fan-out / `event` request type (future stage)
- EnginePullable pull semantics (intentionally deferred)
- Topology-validation dry-run on READY
- Tier upgrades

## 7. Tests summary

| Test                                | Type        | Status   | Asserts                                                        |
|-------------------------------------|-------------|----------|----------------------------------------------------------------|
| wave-6-server-only-loses            | Integration | Exists   | verdict=lose without Queue/Worker                              |
| wave-6-queue-worker-wins            | Integration | **New**  | verdict=win, Queue.totalEnqueued>0, Queue.totalDroppedFull===0 |
| wave-7-no-breaker-loses             | Integration | Exists   | verdict=lose without CircuitBreaker                            |
| wave-7-breaker-rescue-wins          | Integration | **New**  | verdict=win, CB.requestsBlocked>0, availability≥0.90          |
| queue-capability                    | Unit        | Exists   | enqueue, capacity, drain, batch dequeue, upkeep, stats         |
| circuit-breaker-capability          | Unit        | Exists   | CLOSED/OPEN/HALF_OPEN transitions, thresholds, cooldown        |
| batch-processing-capability         | Unit        | Exists   | canHandle("batch"), throughput, RESPOND outcome                |

**New test helpers:** `buildQueue`, `buildWorker`, `buildCircuitBreaker` in `tests/integration/td/helpers.ts`.

## 8. Risk register

| #  | Risk                                                                             | Mitigation                                                                                      |
|----|---------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| R1 | Queue tier-1 capacity (32) fills in <1 tick at 50 batch/tick overflow            | Verify in test; if needed, bump Queue to tier 2 (64) in TD entry or add second Worker           |
| R2 | Server PASS's `batch` — all batch req must reach Worker or they drop             | Topology must route batch traffic to Queue→Worker path; LB fan-out ensures some fraction arrives |
| R3 | CB cooldown (10 ticks) leaves only 3-4 healthy ticks after tick-15 chaos         | 90% SLA is relaxed; Server[1] carries load during OPEN window; verify in test                   |
| R4 | Batch requests split evenly across LB egress (no type-routing)                   | Acceptable — Queue buffers the batch fraction that hits its path; total throughput improves      |
| R5 | Chaos target resolution depends on component iteration order                     | Test must place chaos-target server first; verify resolveTargetByType matches                    |

## 9. Out of scope (deferred)

- REPLICATE fan-out / `event` request type — requires new engine step
- EnginePullable pull semantics — Workers process via normal PROCESS-phase routing
- Topology-validation dry-run on READY — no path tracing yet
- Tier upgrades — no UI surface for in-place upgrades
- Dashboard briefing/diagnosis updates for Queue/Worker/CircuitBreaker — existing palette buttons work; teaching surfaces can be enhanced in a polish pass
- Mid-wave SLA penalty integration verification — `onTick()` exists but dashboard integration is out of scope

## 10. Update checklist (post-merge)

1. `docs/claude/implementation-status.md` — stage line, test count, augmentation paragraph
2. `docs/claude/td-stage-gotchas.md` — Stage 3e section
3. `CLAUDE.md` — current stage line + test count
4. `docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md` — mark Waves 6+7 as shipped with augmentation note

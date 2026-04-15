# EnginePullable Pull Semantics

**Status:** Design approved 2026-04-15. Engine change + capability rework.

## 1. Goal

Make Queue behave like a real job queue. Queue **holds** batch requests in its buffer (QUEUE_HOLD outcome) instead of forwarding them. Worker **pulls** from Queue's buffer up to its throughput capacity per tick. Non-batch traffic still flows through Queue's forwarding-pipe as today.

This makes the component descriptions honest ("Queue holds jobs, Worker pulls from Queue") and teaches correct mental models for message queue architecture.

## 2. Architectural context

### What exists

1. **`QUEUE_HOLD` is already a PrimaryOutcome.** `src/core/types/result.ts` line 7: `{ kind: "QUEUE_HOLD" }`. `deliver-staged.ts` lines 345-380 handles it: finds EngineBufferable on the source component, calls `enqueueForRetry()`, emits `QUEUED` event. No revenue credited. This is the existing plumbing.

2. **`EnginePullable` interface is defined.** `engine-interfaces.ts` line 36-38: `pullPending(context: PullContext): Request[]`. `PullContext` has `state`, `componentId`, `currentTick`. `isEnginePullable()` predicate works.

3. **`BatchProcessingCapability` implements EnginePullable** but `pullPending()` returns `[]` (stub).

4. **`QueueCapability` implements EngineBufferable** with full FIFO buffer, `enqueueForRetry()`, `emitReady()`, `dequeueBatch()`. Capacity: tier 1 = 32, tier 2 = 64, tier 3 = 128 slots.

5. **`QueueCapability.canHandle()` returns false** for all types. Queue never intercepts — only buffers backpressure overflow.

6. **Step 2 (reEmitQueued)** drains the entire Queue buffer every tick via `emitReady()`. All items go to `awaitingDelivery` (outcome-based re-injection).

### What changes

Three modifications and one new engine step:

1. **QueueCapability:** Intercept held types with QUEUE_HOLD outcome. Split buffer into `heldBuffer` (for intentionally held items) and `overflowBuffer` (for backpressure). `emitReady()` drains only overflow. `dequeueBatch()` drains from held.

2. **BatchProcessingCapability.pullPending():** Find connected Queue (upstream EngineBufferable via ingress connections), call `dequeueBatch(throughput)`, return pulled requests.

3. **New engine step 2.5 (pullFromBuffers):** After reEmitQueued, before fixed-point loop. Iterates components with EnginePullable, calls `pullPending()`, routes returned requests to component's pending queue.

4. **Engine.tick():** Insert `pullFromBuffers` call between step 2 and step 3.

## 3. Scope

| Change                                                    | Type     |
|-----------------------------------------------------------|----------|
| QueueCapability: holdTypes config, QUEUE_HOLD intercept   | Modify   |
| QueueCapability: split heldBuffer / overflowBuffer        | Modify   |
| BatchProcessingCapability.pullPending(): real impl        | Modify   |
| New file: src/core/engine/pull-from-buffers.ts            | Create   |
| Engine.tick(): insert pullFromBuffers step                | Modify   |
| QueueCapability unit tests: hold + pull behavior          | Create   |
| BatchProcessingCapability unit tests: pull from Queue     | Create   |
| pull-from-buffers engine step unit test                   | Create   |
| Integration test: Queue holds batch, Worker pulls         | Create   |
| Update existing wave integration tests if behavior changes | Modify  |
| Handoff docs                                              | Modify   |

## 4. QueueCapability changes

### 4a. Constructor accepts holdTypes

```ts
interface QueueCapabilityOptions {
  holdTypes?: ReadonlySet<string>;
}

constructor(readonly id: CapabilityId, options?: QueueCapabilityOptions) {
  this.holdTypes = options?.holdTypes ?? new Set(["batch"]);
}
```

### 4b. canHandle returns true for held types

```ts
canHandle(requestType: string): boolean {
  return this.holdTypes.has(requestType);
}
```

This changes Queue from "never intercepts" to "intercepts held types." Since Queue is INTERCEPT phase and comes before PROCESS, held types get caught before forwarding-pipe sees them.

### 4c. process returns QUEUE_HOLD for held types

```ts
process(request: Request, _context: ProcessContext): ProcessResult {
  if (this.holdTypes.has(request.type)) {
    return { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] };
  }
  return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
}
```

The engine's existing QUEUE_HOLD handler in deliver-staged.ts calls `enqueueForRetry()` on the component. This pushes the request into Queue's buffer.

### 4d. Split buffer into held and overflow

Currently Queue has a single `buffer` array. Split into two:

- **heldBuffer:** Items enqueued via QUEUE_HOLD (intentional holds). Drained ONLY by `dequeueBatch()` (Worker pull). NOT touched by `emitReady()`.
- **overflowBuffer:** Items enqueued via backpressure (connection saturated). Drained by `emitReady()` as today.

How to distinguish: `enqueueForRetry()` is called for both QUEUE_HOLD and backpressure. We need to know which. The simplest approach: check the `result.outcome.kind` passed to `enqueueForRetry()`:

```ts
enqueueForRetry(request: Request, result: ProcessResult): boolean {
  const isHeld = result.outcome.kind === "QUEUE_HOLD";
  const targetBuffer = isHeld ? this.heldBuffer : this.overflowBuffer;
  const totalSize = this.heldBuffer.length + this.overflowBuffer.length;
  if (totalSize >= this.capacity) {
    this.totalDroppedFull += 1;
    return false;
  }
  targetBuffer.push({ request, result });
  this.totalEnqueued += 1;
  return true;
}
```

### 4e. emitReady drains only overflow

```ts
emitReady(): { awaitingPipeline: Request[]; awaitingDelivery: { request: Request; result: ProcessResult }[] } {
  const out = this.overflowBuffer.slice();
  this.overflowBuffer.length = 0;
  return { awaitingPipeline: [], awaitingDelivery: out };
}
```

Held items stay in `heldBuffer` until a Worker pulls them.

### 4f. dequeueBatch pulls from heldBuffer

```ts
dequeueBatch(n: number): Request[] {
  const out: Request[] = [];
  for (let i = 0; i < n && this.heldBuffer.length > 0; i++) {
    const entry = this.heldBuffer.shift();
    if (entry) out.push(entry.request);
  }
  return out;
}
```

### 4g. Stats update

```ts
getStats(): CapabilityStats {
  return {
    queueDepth: this.heldBuffer.length + this.overflowBuffer.length,
    heldDepth: this.heldBuffer.length,
    overflowDepth: this.overflowBuffer.length,
    capacity: CAPACITY_PER_TIER[this.currentTier] ?? 32,
    totalEnqueued: this.totalEnqueued,
    totalDroppedFull: this.totalDroppedFull,
  };
}
```

### 4h. peekBuffered and removeRequest

These should operate on BOTH buffers (used by checkTTL to expire timed-out requests):

```ts
peekBuffered(): ReadonlyArray<{ request: Request; result: ProcessResult }> {
  return [...this.heldBuffer, ...this.overflowBuffer];
}

removeRequest(id: RequestId): boolean {
  let idx = this.heldBuffer.findIndex(e => e.request.id === id);
  if (idx !== -1) { this.heldBuffer.splice(idx, 1); return true; }
  idx = this.overflowBuffer.findIndex(e => e.request.id === id);
  if (idx !== -1) { this.overflowBuffer.splice(idx, 1); return true; }
  return false;
}
```

## 5. BatchProcessingCapability.pullPending()

Replace the stub with a real implementation:

```ts
pullPending(context: PullContext): Request[] {
  const component = context.state.components.get(context.componentId);
  if (!component) return [];

  // Determine pull capacity: this component's batch-processing throughput
  const tier = component.getPlayerTier(this.id);
  const capacity = this.getThroughputPerTick(tier); // tier × 5

  // Find upstream Queue(s) via ingress connections
  const pulled: Request[] = [];
  for (const conn of context.state.connections.values()) {
    if (conn.target.componentId !== context.componentId) continue;
    // conn.source is the upstream component
    const upstream = context.state.components.get(conn.source.componentId);
    if (!upstream) continue;
    for (const cap of upstream.capabilities.values()) {
      if (isEngineBufferable(cap)) {
        const batch = cap.dequeueBatch(capacity - pulled.length);
        pulled.push(...batch);
        if (pulled.length >= capacity) break;
      }
    }
    if (pulled.length >= capacity) break;
  }

  return pulled;
}
```

This searches ingress connections for upstream EngineBufferable components (Queues), pulls up to `throughputPerTick` items total.

## 6. New engine step: pullFromBuffers

New file: `src/core/engine/pull-from-buffers.ts`

```ts
export function pullFromBuffers(
  state: SimulationState,
  _modeController: ModeController,
): void {
  for (const componentId of state.visitOrder) {
    const component = state.components.get(componentId);
    if (!component) continue;

    for (const cap of component.capabilities.values()) {
      if (!isEnginePullable(cap)) continue;
      const context: PullContext = {
        state: state.asReader(),
        componentId,
        currentTick: state.currentTick,
      };
      const pulled = cap.pullPending(context);
      for (const request of pulled) {
        state.enqueuePending(componentId, request);
      }
    }
  }
}
```

### 6a. Insert into Engine.tick()

In `src/core/engine/engine.ts`, after step 2 (reEmitQueued) and before step 3 (runFixedPointLoop):

```ts
// Step 2: re-emit queued
reEmitQueued(this.state);

// Step 2.5: pull from buffers (EnginePullable drains EngineBufferable)
pullFromBuffers(this.state, mc);

// Step 3: fixed-point loop
runFixedPointLoop(this.state, mc);
```

## 7. registerTDDefaults change

Queue factory needs holdTypes option:

```ts
capRegistry.register({
  id: "queue" as CapabilityId,
  factory: () => new QueueCapability("queue" as CapabilityId, {
    holdTypes: new Set(["batch"]),
  }),
  documentsSubInterfaces: ["EngineBufferable"],
});
```

## 8. Impact on existing tests

### Wave 6 (Queue + Worker)
The behavior changes: batch requests now get QUEUE_HOLD'd at Queue instead of forwarding through. Worker pulls them. The teaching arc becomes more honest but the test assertions may need updating:
- `queue.getStats().totalEnqueued > 0` should still pass (items enter held buffer)
- `forwardedCountByComponent.get(queue.component.id)` may decrease (Queue forwards fewer items since batch is held, not forwarded)
- Worker's `processedCountByComponent` should increase (Worker processes pulled batch items)

### Wave 7-10
Same pattern — Queue+Worker topologies work via pull instead of pipeline routing. Tests should still pass if they assert verdict=win/lose rather than specific forwarding counts.

### Wave 1-5
No Queue in these topologies — completely unaffected.

## 9. Tests

| Test                                      | Type        | Asserts                                                      |
|-------------------------------------------|-------------|--------------------------------------------------------------|
| QueueCapability holds batch via QUEUE_HOLD | Unit       | canHandle("batch")=true, process returns QUEUE_HOLD          |
| QueueCapability passes non-batch          | Unit        | canHandle("api_read")=false, process returns PASS             |
| Queue split buffer: held vs overflow      | Unit        | QUEUE_HOLD→heldBuffer, backpressure→overflowBuffer           |
| emitReady drains only overflow            | Unit        | heldBuffer untouched after emitReady                          |
| dequeueBatch drains from held             | Unit        | Correct items returned, heldBuffer shrinks                    |
| BatchProcessingCapability.pullPending     | Unit        | Pulls from connected Queue's heldBuffer up to throughput      |
| pullFromBuffers engine step               | Unit        | Pulled items appear in Worker's pending queue                 |
| Integration: Queue→Worker with batch      | Integration | Batch held at Queue, Worker pulls and processes, verdict=win  |

## 10. Risk register

| # | Risk                                                              | Mitigation                                                        |
|---|-------------------------------------------------------------------|-------------------------------------------------------------------|
| R1 | Existing wave tests may break if they assert forwarding counts  | Update assertions to reflect pull-based flow                       |
| R2 | Queue capacity shared between held and overflow                  | Both buffers count against capacity total — no double-counting     |
| R3 | Worker pulls from Queue before fixed-point loop — timing order   | Pull happens once per tick, before processing. Pulled items get normal PROCESS treatment |
| R4 | Multiple Workers connected to same Queue — pull race             | Visit order is deterministic; first Worker in order pulls first. Remaining capacity for second Worker |
| R5 | checkTTL must find held items for timeout expiry                 | peekBuffered and removeRequest operate on both buffers             |

## 11. Out of scope

- Priority-based pulling (Worker pulls high-priority first)
- Pull from non-Queue EngineBufferable components
- Response routing (bidirectional request/response)
- Dashboard visualization of held vs overflow buffer states

## 12. Update checklist (post-merge)

1. `docs/claude/implementation-status.md` — add pull semantics paragraph
2. `docs/claude/td-stage-gotchas.md` — update EnginePullable entry from "intentionally stubbed" to "implemented"
3. `docs/claude/simulation-tick.md` — add step 2.5 to the 10-step reference
4. `CLAUDE.md` — update test count

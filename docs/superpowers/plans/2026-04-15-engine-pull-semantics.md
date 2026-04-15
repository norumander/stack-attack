# EnginePullable Pull Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Queue hold batch requests (QUEUE_HOLD) and Worker actively pull from Queue's buffer, replacing the forwarding-pipe passthrough with real job-queue semantics.

**Architecture:** Three capability changes (QueueCapability holdTypes + split buffer, BatchProcessingCapability pullPending), one new engine step (pullFromBuffers between step 2 and step 3), and registerTDDefaults wiring. Existing QUEUE_HOLD plumbing in deliver-staged.ts is reused unchanged.

**Tech Stack:** TypeScript, Vitest, existing `@core/engine/`, `@capabilities/`, `@modes/td/` modules.

---

## File Structure

| File                                                    | Action | Responsibility                                          |
|---------------------------------------------------------|--------|---------------------------------------------------------|
| `src/capabilities/queue/queue-capability.ts`            | Modify | holdTypes, QUEUE_HOLD intercept, split held/overflow buffers |
| `src/capabilities/batch-processing/batch-processing-capability.ts` | Modify | Real pullPending() — pulls from connected Queue       |
| `src/core/engine/pull-from-buffers.ts`                  | Create | New step 2.5: iterate EnginePullable, route pulled items |
| `src/core/engine/engine.ts`                             | Modify | Insert pullFromBuffers into tick() + EngineSteps        |
| `src/modes/td/register-td-defaults.ts`                  | Modify | Pass holdTypes to Queue factory                         |
| `tests/unit/queue-capability.test.ts`                   | Modify | Add tests for holdTypes, split buffer, QUEUE_HOLD       |
| `tests/unit/pull-from-buffers.test.ts`                  | Create | Engine step test: pull routes items to pending           |
| `tests/integration/td/wave-6-queue-worker-wins.test.ts` | Modify | Update assertions for pull-based flow                   |

---

### Task 1: QueueCapability — holdTypes + QUEUE_HOLD + split buffer

**Files:**
- Modify: `src/capabilities/queue/queue-capability.ts`
- Modify: `tests/unit/queue-capability.test.ts`

This is the largest single task. QueueCapability changes from "passive backpressure buffer" to "selective job queue."

- [ ] **Step 1: Write failing tests for hold behavior**

Add to `tests/unit/queue-capability.test.ts` (or create new section):

```ts
describe("QueueCapability — hold semantics", () => {
  it("canHandle returns true for holdTypes", () => {
    const q = new QueueCapability("queue" as CapabilityId, {
      holdTypes: new Set(["batch"]),
    });
    expect(q.canHandle("batch")).toBe(true);
    expect(q.canHandle("api_read")).toBe(false);
  });

  it("process returns QUEUE_HOLD for held types", () => {
    const q = new QueueCapability("queue" as CapabilityId, {
      holdTypes: new Set(["batch"]),
    });
    const req = { type: "batch" } as Request;
    const result = q.process(req, {} as ProcessContext);
    expect(result.outcome.kind).toBe("QUEUE_HOLD");
  });

  it("process returns PASS for non-held types", () => {
    const q = new QueueCapability("queue" as CapabilityId, {
      holdTypes: new Set(["batch"]),
    });
    const req = { type: "api_read" } as Request;
    const result = q.process(req, {} as ProcessContext);
    expect(result.outcome.kind).toBe("PASS");
  });

  it("enqueueForRetry routes QUEUE_HOLD items to heldBuffer", () => {
    const q = new QueueCapability("queue" as CapabilityId);
    // Simulate QUEUE_HOLD enqueue
    const req = { id: "r1", type: "batch" } as Request;
    const result = { outcome: { kind: "QUEUE_HOLD" as const }, sideEffects: [], events: [] };
    q.enqueueForRetry(req, result);
    const stats = q.getStats();
    expect(stats.heldDepth).toBe(1);
    expect(stats.overflowDepth).toBe(0);
  });

  it("enqueueForRetry routes backpressure items to overflowBuffer", () => {
    const q = new QueueCapability("queue" as CapabilityId);
    const req = { id: "r1", type: "api_read" } as Request;
    const result = { outcome: { kind: "FORWARD" as const }, sideEffects: [], events: [] };
    q.enqueueForRetry(req, result);
    const stats = q.getStats();
    expect(stats.heldDepth).toBe(0);
    expect(stats.overflowDepth).toBe(1);
  });

  it("emitReady drains only overflowBuffer, held items stay", () => {
    const q = new QueueCapability("queue" as CapabilityId);
    // Add one held + one overflow
    q.enqueueForRetry(
      { id: "r1", type: "batch" } as Request,
      { outcome: { kind: "QUEUE_HOLD" as const }, sideEffects: [], events: [] },
    );
    q.enqueueForRetry(
      { id: "r2", type: "api_read" } as Request,
      { outcome: { kind: "FORWARD" as const }, sideEffects: [], events: [] },
    );
    const ready = q.emitReady();
    expect(ready.awaitingDelivery).toHaveLength(1);
    expect(ready.awaitingDelivery[0]!.request.id).toBe("r2");
    // Held item remains
    const stats = q.getStats();
    expect(stats.heldDepth).toBe(1);
    expect(stats.overflowDepth).toBe(0);
  });

  it("dequeueBatch pulls from heldBuffer", () => {
    const q = new QueueCapability("queue" as CapabilityId);
    q.enqueueForRetry(
      { id: "r1", type: "batch" } as Request,
      { outcome: { kind: "QUEUE_HOLD" as const }, sideEffects: [], events: [] },
    );
    q.enqueueForRetry(
      { id: "r2", type: "batch" } as Request,
      { outcome: { kind: "QUEUE_HOLD" as const }, sideEffects: [], events: [] },
    );
    const pulled = q.dequeueBatch(1);
    expect(pulled).toHaveLength(1);
    expect(pulled[0]!.id).toBe("r1");
    expect(q.getStats().heldDepth).toBe(1);
  });

  it("capacity is shared across both buffers", () => {
    const q = new QueueCapability("queue" as CapabilityId);
    // Fill to capacity (32 at tier 1) with held items
    for (let i = 0; i < 32; i++) {
      q.enqueueForRetry(
        { id: `r${i}`, type: "batch" } as Request,
        { outcome: { kind: "QUEUE_HOLD" as const }, sideEffects: [], events: [] },
      );
    }
    // 33rd item should be rejected
    const overflow = q.enqueueForRetry(
      { id: "r-overflow", type: "api_read" } as Request,
      { outcome: { kind: "FORWARD" as const }, sideEffects: [], events: [] },
    );
    expect(overflow).toBe(false);
    expect(q.getStats().totalDroppedFull).toBe(1);
  });

  it("peekBuffered returns items from both buffers", () => {
    const q = new QueueCapability("queue" as CapabilityId);
    q.enqueueForRetry(
      { id: "r1", type: "batch" } as Request,
      { outcome: { kind: "QUEUE_HOLD" as const }, sideEffects: [], events: [] },
    );
    q.enqueueForRetry(
      { id: "r2", type: "api_read" } as Request,
      { outcome: { kind: "FORWARD" as const }, sideEffects: [], events: [] },
    );
    const all = q.peekBuffered();
    expect(all).toHaveLength(2);
  });

  it("removeRequest works across both buffers", () => {
    const q = new QueueCapability("queue" as CapabilityId);
    q.enqueueForRetry(
      { id: "r1" as any, type: "batch" } as Request,
      { outcome: { kind: "QUEUE_HOLD" as const }, sideEffects: [], events: [] },
    );
    q.enqueueForRetry(
      { id: "r2" as any, type: "api_read" } as Request,
      { outcome: { kind: "FORWARD" as const }, sideEffects: [], events: [] },
    );
    expect(q.removeRequest("r1" as any)).toBe(true);
    expect(q.getStats().heldDepth).toBe(0);
    expect(q.removeRequest("r2" as any)).toBe(true);
    expect(q.getStats().overflowDepth).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/queue-capability.test.ts`
Expected: Multiple failures — no holdTypes constructor, canHandle returns false, no split buffers.

- [ ] **Step 3: Implement QueueCapability changes**

Replace `src/capabilities/queue/queue-capability.ts` with the full implementation from the spec (§4a-4h). Key changes:
- Add `QueueCapabilityOptions` interface with optional `holdTypes`
- Constructor accepts options, defaults holdTypes to `new Set(["batch"])`
- `canHandle()` checks `this.holdTypes.has(requestType)`
- `process()` returns `QUEUE_HOLD` for held types, `PASS` otherwise
- Split `buffer` into `heldBuffer` and `overflowBuffer`
- `enqueueForRetry()` routes by `result.outcome.kind === "QUEUE_HOLD"`
- `emitReady()` drains only `overflowBuffer`
- `dequeueBatch()` pulls from `heldBuffer`
- `peekBuffered()` and `removeRequest()` operate on both
- `getStats()` includes `heldDepth` and `overflowDepth`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/queue-capability.test.ts`
Expected: All pass (existing + new).

- [ ] **Step 5: Run full suite — expect some failures**

Run: `pnpm test`
Expected: Some wave integration tests may fail because Queue now intercepts batch with QUEUE_HOLD instead of passing through. This is expected — we'll fix them after adding the pull step.

- [ ] **Step 6: Commit**

```bash
git add src/capabilities/queue/queue-capability.ts tests/unit/queue-capability.test.ts
git commit -m "feat(queue): holdTypes + QUEUE_HOLD intercept + split held/overflow buffers"
```

---

### Task 2: BatchProcessingCapability.pullPending() — real implementation

**Files:**
- Modify: `src/capabilities/batch-processing/batch-processing-capability.ts`

- [ ] **Step 1: Implement pullPending**

Replace the stub `pullPending()` (lines 48-53) with:

```ts
  pullPending(context: PullContext): Request[] {
    const component = context.state.components.get(context.componentId);
    if (!component) return [];

    const tier = component.getPlayerTier(this.id);
    const capacity = this.getThroughputPerTick(tier);

    const pulled: Request[] = [];
    for (const conn of context.state.connections.values()) {
      if (conn.target.componentId !== context.componentId) continue;
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

Add import at top:

```ts
import { isEngineBufferable } from "../../core/capability/engine-interfaces.js";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: Clean. `PullContext.state` is `SimulationStateReader` which has `components` and `connections`. `component.getPlayerTier()` may need type assertion if `ComponentReader` doesn't expose it — check and adapt.

- [ ] **Step 3: Commit**

```bash
git add src/capabilities/batch-processing/batch-processing-capability.ts
git commit -m "feat(batch-processing): implement pullPending — pulls from connected Queue's heldBuffer"
```

---

### Task 3: New engine step — pullFromBuffers

**Files:**
- Create: `src/core/engine/pull-from-buffers.ts`
- Modify: `src/core/engine/engine.ts`
- Create: `tests/unit/pull-from-buffers.test.ts`

- [ ] **Step 1: Create pull-from-buffers.ts**

Create `src/core/engine/pull-from-buffers.ts`:

```ts
import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { PullContext } from "../capability/process-context.js";
import { isEnginePullable } from "../capability/engine-interfaces.js";

/**
 * Step 2.5: pull from buffers.
 *
 * After reEmitQueued (step 2) drains overflow buffers, this step lets
 * EnginePullable capabilities (e.g. BatchProcessingCapability on Worker)
 * actively pull from connected EngineBufferable components (e.g. Queue).
 *
 * Pulled requests are enqueued in the puller's pending queue for normal
 * PROCESS-phase handling in the fixed-point loop (step 3).
 */
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

- [ ] **Step 2: Add to Engine.tick() and EngineSteps**

In `src/core/engine/engine.ts`:

Add import:
```ts
import { pullFromBuffers as defaultPullFromBuffers } from "./pull-from-buffers.js";
```

Add to `EngineSteps` interface (after `reEmitQueued`):
```ts
  pullFromBuffers: (state: SimulationState, mc: ModeController) => void;
```

Add to `defaultSteps` (after `reEmitQueued`):
```ts
  pullFromBuffers: defaultPullFromBuffers,
```

In `tick()`, insert between step 2 and step 3 (between lines 65 and 66):
```ts
    this.steps.pullFromBuffers(this.state, modeController);  // step 2.5
```

- [ ] **Step 3: Write unit test for pullFromBuffers**

Create `tests/unit/pull-from-buffers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { pullFromBuffers } from "@core/engine/pull-from-buffers";
import { Component } from "@core/component/component";
import { QueueCapability } from "@capabilities/queue/queue-capability";
import { BatchProcessingCapability } from "@capabilities/batch-processing/batch-processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { makePort, makeConnection } from "@harness/fixtures";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { Capability } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ConditionProfile } from "@core/types/condition";

const defaultCondition: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.05,
  recoveryRate: 0.02,
  degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
  criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
};

const mc = new NoOpModeController({
  targetEntryPointId: "entry" as ComponentId,
  intensity: 0,
  requestType: "batch",
});

describe("pullFromBuffers — step 2.5", () => {
  it("Worker pulls held items from connected Queue into its pending queue", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // Build a Queue component
    const queueCap = new QueueCapability("queue" as CapabilityId, {
      holdTypes: new Set(["batch"]),
    });
    const queueFwd = new ForwardingCapability("forwarding-pipe" as CapabilityId, {
      handledTypes: ["api_read"],
      throughputPerTier: 500,
      emitForwardedEvent: true,
    });
    const queueMon = new MonitoringCapability("monitoring" as CapabilityId);
    const queueComp = new Component({
      id: "queue-1" as ComponentId,
      type: "queue",
      name: "Queue",
      description: "",
      capabilities: new Map<CapabilityId, Capability>([
        ["queue" as CapabilityId, queueCap],
        ["forwarding-pipe" as CapabilityId, queueFwd],
        ["monitoring" as CapabilityId, queueMon],
      ]),
      initialTiers: new Map([
        ["queue" as CapabilityId, 1],
        ["forwarding-pipe" as CapabilityId, 1],
        ["monitoring" as CapabilityId, 1],
      ]),
      ports: [makePort("q-in", "ingress"), makePort("q-out", "egress")],
      placementCost: 125,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: defaultCondition,
    });

    // Build a Worker component
    const batchCap = new BatchProcessingCapability("batch-processing" as CapabilityId);
    const workerFwd = new ForwardingCapability("forwarding-pipe" as CapabilityId, {
      handledTypes: ["api_read"],
      throughputPerTier: 500,
      emitForwardedEvent: true,
    });
    const workerMon = new MonitoringCapability("monitoring" as CapabilityId);
    const workerComp = new Component({
      id: "worker-1" as ComponentId,
      type: "worker",
      name: "Worker",
      description: "",
      capabilities: new Map<CapabilityId, Capability>([
        ["batch-processing" as CapabilityId, batchCap],
        ["forwarding-pipe" as CapabilityId, workerFwd],
        ["monitoring" as CapabilityId, workerMon],
      ]),
      initialTiers: new Map([
        ["batch-processing" as CapabilityId, 1],
        ["forwarding-pipe" as CapabilityId, 1],
        ["monitoring" as CapabilityId, 1],
      ]),
      ports: [makePort("w-in", "ingress"), makePort("w-out", "egress")],
      placementCost: 125,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: defaultCondition,
    });

    state.placeComponent(queueComp);
    state.placeComponent(workerComp);
    state.recomputeVisitOrder();

    // Wire Queue → Worker
    const conn = makeConnection(
      "c-q-w",
      { componentId: "queue-1", portId: "q-out" },
      { componentId: "worker-1", portId: "w-in" },
    );
    queueComp.ports.find(p => p.id === "q-out")!.connections.push(conn.id);
    workerComp.ports.find(p => p.id === "w-in")!.connections.push(conn.id);
    state.addConnection(conn);

    // Enqueue 3 batch items in Queue's heldBuffer
    for (let i = 0; i < 3; i++) {
      queueCap.enqueueForRetry(
        { id: `r${i}`, type: "batch" } as Request,
        { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] },
      );
    }
    expect(queueCap.getStats().heldDepth).toBe(3);

    // Run pull step
    pullFromBuffers(state, mc);

    // Worker's pending queue should have the pulled items
    const workerPending = state.pending.get("worker-1" as ComponentId) ?? [];
    expect(workerPending.length).toBe(3);
    expect(workerPending[0]!.id).toBe("r0");

    // Queue's held buffer should be empty (Worker pulled all 3, capacity = tier×5 = 5)
    expect(queueCap.getStats().heldDepth).toBe(0);
  });

  it("Worker pulls up to throughput capacity, leaves rest in Queue", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const queueCap = new QueueCapability("queue" as CapabilityId);
    const queueComp = new Component({
      id: "queue-1" as ComponentId,
      type: "queue",
      name: "Queue",
      description: "",
      capabilities: new Map<CapabilityId, Capability>([
        ["queue" as CapabilityId, queueCap],
      ]),
      initialTiers: new Map([["queue" as CapabilityId, 1]]),
      ports: [makePort("q-in", "ingress"), makePort("q-out", "egress")],
      placementCost: 125,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: defaultCondition,
    });

    const batchCap = new BatchProcessingCapability("batch-processing" as CapabilityId);
    const workerComp = new Component({
      id: "worker-1" as ComponentId,
      type: "worker",
      name: "Worker",
      description: "",
      capabilities: new Map<CapabilityId, Capability>([
        ["batch-processing" as CapabilityId, batchCap],
      ]),
      initialTiers: new Map([["batch-processing" as CapabilityId, 1]]),
      ports: [makePort("w-in", "ingress"), makePort("w-out", "egress")],
      placementCost: 125,
      position: { x: 0, y: 0 },
      zone: null,
      placementTick: 0,
      conditionProfile: defaultCondition,
    });

    state.placeComponent(queueComp);
    state.placeComponent(workerComp);
    state.recomputeVisitOrder();

    const conn = makeConnection(
      "c-q-w",
      { componentId: "queue-1", portId: "q-out" },
      { componentId: "worker-1", portId: "w-in" },
    );
    queueComp.ports.find(p => p.id === "q-out")!.connections.push(conn.id);
    workerComp.ports.find(p => p.id === "w-in")!.connections.push(conn.id);
    state.addConnection(conn);

    // Enqueue 10 items (more than tier-1 capacity of 5)
    for (let i = 0; i < 10; i++) {
      queueCap.enqueueForRetry(
        { id: `r${i}`, type: "batch" } as Request,
        { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] },
      );
    }

    pullFromBuffers(state, mc);

    // Worker pulls up to 5 (tier 1 × 5 throughput)
    const workerPending = state.pending.get("worker-1" as ComponentId) ?? [];
    expect(workerPending.length).toBe(5);

    // Queue retains the other 5
    expect(queueCap.getStats().heldDepth).toBe(5);
  });
});
```

- [ ] **Step 4: Run the pull-from-buffers test**

Run: `pnpm test tests/unit/pull-from-buffers.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
This should now work end-to-end: Queue holds batch → pullFromBuffers drains to Worker → Worker processes in fixed-point loop. Some wave test assertions may need updating (next task).

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/pull-from-buffers.ts src/core/engine/engine.ts tests/unit/pull-from-buffers.test.ts
git commit -m "feat(engine): add pullFromBuffers step 2.5 — Worker pulls from Queue's heldBuffer"
```

---

### Task 4: Update registerTDDefaults — Queue holdTypes

**Files:**
- Modify: `src/modes/td/register-td-defaults.ts`

- [ ] **Step 1: Pass holdTypes to Queue factory**

Find the queue capability registration (around line 125-129). Change:

```ts
  capRegistry.register({
    id: "queue" as CapabilityId,
    factory: () => new QueueCapability("queue" as CapabilityId),
    documentsSubInterfaces: ["EngineBufferable"],
  });
```

To:

```ts
  capRegistry.register({
    id: "queue" as CapabilityId,
    factory: () => new QueueCapability("queue" as CapabilityId, {
      holdTypes: new Set(["batch"]),
    }),
    documentsSubInterfaces: ["EngineBufferable"],
  });
```

- [ ] **Step 2: Run full suite**

Run: `pnpm test`
Expected: Wave 6-10 tests with Queue+Worker topologies should work via pull semantics now. Check if any assertions on forwarding counts need updating.

- [ ] **Step 3: Commit**

```bash
git add src/modes/td/register-td-defaults.ts
git commit -m "feat(td): pass holdTypes to Queue factory in registerTDDefaults"
```

---

### Task 5: Fix existing wave integration tests

**Files:**
- Modify: `tests/integration/td/wave-6-queue-worker-wins.test.ts` (and possibly wave 7-10 tests)

With pull semantics, Queue no longer forwards batch requests — it holds them. Worker pulls them. This means:
- Queue's `forwardedCountByComponent` may decrease (batch isn't forwarded, it's held)
- The test's assertion `queueForwarded > 0` may fail for batch-only traffic
- Worker's flow changes: it processes pulled items (from pending), not piped items

- [ ] **Step 1: Run all wave integration tests and identify failures**

Run: `pnpm test tests/integration/td/`
Note which tests fail and why.

- [ ] **Step 2: Update failing test assertions**

For each failing test:
- If it asserts `queueForwarded > 0`: change to assert `queueStats.totalEnqueued > 0` (proves Queue received and held batch items)
- If it asserts specific forwarding counts that changed: update to reflect pull-based flow
- Verdict assertions (win/lose) should be unchanged — the topology still works, just via pull instead of pipe

- [ ] **Step 3: Run full suite to confirm all pass**

Run: `pnpm test`
Expected: All 750+ tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/td/
git commit -m "fix(tests): update wave integration test assertions for pull-based Queue→Worker flow"
```

---

### Task 6: Verify full suite and typecheck

- [ ] **Step 1: Full suite**

Run: `pnpm test`
Note total count.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

---

### Task 7: Update handoff documentation

**Files:**
- Modify: `docs/claude/implementation-status.md`
- Modify: `docs/claude/td-stage-gotchas.md`
- Modify: `docs/claude/simulation-tick.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update implementation-status.md**

Add paragraph after Stage 4c:

```markdown
**Stage 5b: EnginePullable pull semantics** — Queue now holds batch requests via QUEUE_HOLD outcome (split buffer: heldBuffer for intentional holds, overflowBuffer for backpressure). Worker actively pulls from connected Queue's heldBuffer via BatchProcessingCapability.pullPending(). New engine step 2.5 (pullFromBuffers) between reEmitQueued and the fixed-point loop iterates EnginePullable components and routes pulled items to their pending queues. registerTDDefaults passes holdTypes: Set(["batch"]) to Queue factory. [TEST_COUNT] tests total.
```

- [ ] **Step 2: Update td-stage-gotchas.md**

Find the "EnginePullable intentionally stubbed" entry and replace with:

```markdown
- **EnginePullable is now implemented.** BatchProcessingCapability.pullPending() pulls from connected Queue's heldBuffer up to throughputPerTick capacity. Engine step 2.5 (pullFromBuffers) runs after reEmitQueued, before the fixed-point loop. Queue holds batch requests via QUEUE_HOLD (INTERCEPT phase), with split held/overflow buffers. emitReady drains only overflow; dequeueBatch drains held.
```

- [ ] **Step 3: Update simulation-tick.md**

Add step 2.5 to the 10-step reference:

```markdown
2.5. **PULL FROM BUFFERS** — `pullFromBuffers` iterates EnginePullable capabilities (e.g. BatchProcessingCapability on Worker), calls `pullPending()` which drains held items from connected EngineBufferable (Queue), routes pulled requests to the puller's pending queue.
```

- [ ] **Step 4: Update CLAUDE.md test count**

- [ ] **Step 5: Commit**

```bash
git add docs/claude/implementation-status.md docs/claude/td-stage-gotchas.md docs/claude/simulation-tick.md CLAUDE.md
git commit -m "docs(pull-semantics): handoff docs — pull step 2.5, Queue hold behavior, updated gotchas"
```

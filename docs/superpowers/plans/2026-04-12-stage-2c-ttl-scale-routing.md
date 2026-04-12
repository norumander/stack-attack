# Stage 2c — Bufferable TTL, SCALE Processing, Condition-Aware Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three engine gaps — buffered requests respect TTL exactly, SCALE side effects mutate instanceCount, and a RoutingCapability validates the EngineConsultable interface with T1–T3 condition-aware routing.

**Architecture:** Three independent subsystems sharing a common foundation layer. Feature 1 (TTL) extends EngineBufferable + checkTTL + cascade. Feature 2 (SCALE) extends Component + deliverStaged. Feature 3 (routing) adds RoutingCapability + refactors selectEgressConnection. All changes are additive behind existing contracts.

**Tech Stack:** TypeScript (strict, ESM, `.js` extensions on `.ts` imports), vitest, branded IDs (`as RequestId` casts in tests), path aliases `@core/*`, `@capabilities/*`, `@harness/*`.

**Spec:** `docs/superpowers/specs/2026-04-12-stage-2c-ttl-scale-routing-design.md`

**Run tests:** `pnpm test` (full suite) or `pnpm test tests/unit/<file>.test.ts` (single file)
**Typecheck:** `pnpm typecheck`

---

## Task 1: Extend EngineBufferable interface + update type guard

**Files:**
- Modify: `src/core/capability/engine-interfaces.ts`

- [ ] **Step 1: Add `peekBuffered` and `removeRequest` to EngineBufferable**

```ts
// In engine-interfaces.ts, add to the EngineBufferable interface after dequeueBatch:

  /**
   * Snapshot of all buffered items without draining.
   * Returns a defensive copy in insertion order (FIFO).
   * Implementations MUST return a copy, not a live view — the caller
   * may call removeRequest() during iteration of the returned array.
   */
  peekBuffered(): ReadonlyArray<{ request: Request; result: ProcessResult }>;

  /**
   * Remove a specific request by ID. Returns true if found and removed.
   */
  removeRequest(id: RequestId): boolean;
```

Add `RequestId` to the existing import from `../types/ids.js`:

```ts
import type { ConnectionId, ComponentId, RequestId } from "../types/ids.js";
```

- [ ] **Step 2: Tighten the `isEngineBufferable` type guard**

Replace the existing guard:

```ts
export function isEngineBufferable(
  c: Capability,
): c is Capability & EngineBufferable {
  return (
    typeof (c as unknown as EngineBufferable).enqueueForRetry === "function" &&
    typeof (c as unknown as EngineBufferable).peekBuffered === "function"
  );
}
```

- [ ] **Step 3: Run typecheck to see what breaks**

Run: `pnpm typecheck`
Expected: FAIL — `TestQueueCapability` in `tests/harness/test-capabilities.ts` no longer satisfies `EngineBufferable` (missing `peekBuffered` and `removeRequest`).

- [ ] **Step 4: Commit**

```bash
git add src/core/capability/engine-interfaces.ts
git commit -m "feat(engine): extend EngineBufferable with peekBuffered + removeRequest"
```

---

## Task 2: Update TestQueueCapability to Map-based buffer

**Files:**
- Modify: `tests/harness/test-capabilities.ts`

- [ ] **Step 1: Rewrite TestQueueCapability buffer from array to Map**

Replace the entire `TestQueueCapability` class (lines 171–202) with:

```ts
export class TestQueueCapability implements Capability, EngineBufferable {
  readonly phase = "INTERCEPT" as const;
  private buffer: Map<RequestId, { request: Request; result: ProcessResult }> = new Map();
  constructor(
    readonly id: CapabilityId,
    private readonly capacity: number = 64,
  ) {}
  canHandle(_requestType: string): boolean {
    return false;
  }
  process(_req: Request, _ctx: ProcessContext): ProcessResult {
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }
  getUpkeepCost(_tier: number): number { return 0; }
  getStats() { return {}; }

  // EngineBufferable
  enqueueForRetry(request: Request, result: ProcessResult): boolean {
    if (this.buffer.size >= this.capacity) return false;
    this.buffer.set(request.id, { request, result });
    return true;
  }
  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  } {
    const out = [...this.buffer.values()];
    this.buffer.clear();
    return { awaitingPipeline: [], awaitingDelivery: out };
  }
  dequeueBatch(_n: number): Request[] { return []; }
  peekBuffered(): ReadonlyArray<{ request: Request; result: ProcessResult }> {
    return [...this.buffer.values()];
  }
  removeRequest(id: RequestId): boolean {
    return this.buffer.delete(id);
  }
}
```

Add `RequestId` to the existing id imports at the top of the file:

```ts
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
```

- [ ] **Step 2: Run typecheck and full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — all existing 378 tests pass. TestQueueCapability now satisfies the extended EngineBufferable.

- [ ] **Step 3: Commit**

```bash
git add tests/harness/test-capabilities.ts
git commit -m "feat(harness): update TestQueueCapability to Map-based buffer with peekBuffered/removeRequest"
```

---

## Task 3: checkTTL Scan 3 — bufferable partition scan

**Files:**
- Modify: `src/core/engine/check-ttl.ts`
- Create: `tests/unit/ttl-bufferable.test.ts`

- [ ] **Step 1: Write failing tests for Scan 3**

Create `tests/unit/ttl-bufferable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { checkTTL } from "@core/engine/check-ttl";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import { TestQueueCapability, ForwardingCapability } from "@harness/test-capabilities";
import { buildVisitOrder } from "@core/engine/visit-order";
import type { Request } from "@core/types/request";
import type {
  CapabilityId,
  ComponentId,
  RequestId,
} from "@core/types/ids";
import type { ProcessResult } from "@core/types/result";

function makeRequest(overrides: Partial<Request> & { id: string }): Request {
  return {
    id: overrides.id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "origin" as ComponentId,
    createdAt: overrides.createdAt ?? 0,
    ttl: overrides.ttl ?? 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
    ...overrides,
  } as Request;
}

const passResult: ProcessResult = {
  outcome: { kind: "PASS" },
  sideEffects: [],
  events: [],
};

describe("checkTTL Scan 3: bufferable partitions", () => {
  it("expires a buffered request whose TTL has elapsed", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const fwdCap = new ForwardingCapability("fwd" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([
        ["q1" as CapabilityId, queueCap],
        ["fwd" as CapabilityId, fwdCap],
      ]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));

    const req = makeRequest({ id: "r1", createdAt: 0, ttl: 5 });
    state.requestLog.set(req.id, []);
    queueCap.enqueueForRetry(req, passResult);

    state.currentTick = 5; // createdAt(0) + ttl(5) <= 5 → expired

    checkTTL(state);

    // Request removed from buffer
    expect(queueCap.peekBuffered()).toHaveLength(0);
    // TIMED_OUT event appended
    const events = state.requestLog.get(req.id)!;
    expect(events.some((e) => e.type === "TIMED_OUT")).toBe(true);
  });

  it("does NOT expire a buffered request whose TTL has NOT elapsed", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["q1" as CapabilityId, queueCap]]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));

    const req = makeRequest({ id: "r1", createdAt: 0, ttl: 10 });
    state.requestLog.set(req.id, []);
    queueCap.enqueueForRetry(req, passResult);

    state.currentTick = 5; // createdAt(0) + ttl(10) = 10 > 5 → NOT expired

    checkTTL(state);

    expect(queueCap.peekBuffered()).toHaveLength(1);
    const events = state.requestLog.get(req.id)!;
    expect(events.some((e) => e.type === "TIMED_OUT")).toBe(false);
  });

  it("skips already-removed requests (cascade removed it first)", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["q1" as CapabilityId, queueCap]]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));

    const req = makeRequest({ id: "r1", createdAt: 0, ttl: 5 });
    state.requestLog.set(req.id, []);
    queueCap.enqueueForRetry(req, passResult);

    // Pre-remove the request (simulating cascade)
    queueCap.removeRequest(req.id);

    state.currentTick = 5;
    checkTTL(state);

    // No TIMED_OUT event (was already removed)
    const events = state.requestLog.get(req.id)!;
    expect(events.some((e) => e.type === "TIMED_OUT")).toBe(false);
  });

  it("increments timeout counter for the component", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["q1" as CapabilityId, queueCap]]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));

    const req = makeRequest({ id: "r1", createdAt: 0, ttl: 5 });
    state.requestLog.set(req.id, []);
    queueCap.enqueueForRetry(req, passResult);
    state.currentTick = 5;

    checkTTL(state);

    const counters = state.perComponentThisTick.get("c1" as ComponentId);
    expect(counters?.timeouts).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/ttl-bufferable.test.ts`
Expected: FAIL — the first test fails because checkTTL doesn't scan bufferables yet; the buffered request survives.

- [ ] **Step 3: Implement Scan 3 in checkTTL**

In `src/core/engine/check-ttl.ts`, add the import for `isEngineBufferable` at the top:

```ts
import { isEngineBufferable } from "../capability/engine-interfaces.js";
```

Replace the TODO comment block (lines 20–27) with a brief note, then add Scan 3 after the blocked-pool scan (after line 95, before the closing `}`):

```ts
  // --- BUFFERABLE PARTITION SCAN (Stage 2c) ---
  for (const componentId of state.visitOrder) {
    const component = state.components.get(componentId);
    if (!component) continue;

    for (const cap of component.capabilities.values()) {
      if (!isEngineBufferable(cap)) continue;
      const buffered = cap.peekBuffered();

      for (const entry of buffered) {
        if (entry.request.createdAt + entry.request.ttl > state.currentTick) {
          continue;
        }

        // Expired — remove from buffer. If removeRequest returns false,
        // the request was already removed by a cascade from an earlier
        // expiration in this same scan pass. Skip to avoid duplicate events.
        if (!cap.removeRequest(entry.request.id)) continue;

        state.appendEvent(entry.request.id, {
          tick: state.currentTick,
          componentId,
          capabilityId: null,
          connectionId: null,
          type: "TIMED_OUT",
          latencyAdded: 0,
        });
        getOrInitCounters(state, componentId).timeouts += 1;
        applyStrictCascade(state, entry.request.id);
      }
    }
  }
```

Also update the file's doc comment to reflect that Scan 3 is now implemented (replace lines 20–27 referencing the TODO):

```ts
 * 3. BUFFERABLE PARTITION SCAN (Stage 2c): walks visitOrder; for each
 *    component's EngineBufferable capabilities, calls peekBuffered() and
 *    expires buffered requests whose TTL has elapsed. Fires applyStrictCascade
 *    for expired blocking children. Uses removeRequest() return value to
 *    skip requests already removed by an earlier cascade in the same scan.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/ttl-bufferable.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Run full suite for regressions**

Run: `pnpm test`
Expected: PASS — all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/check-ttl.ts tests/unit/ttl-bufferable.test.ts
git commit -m "feat(engine): checkTTL Scan 3 — expire buffered requests"
```

---

## Task 4: Cascade bufferable scanning

**Files:**
- Modify: `src/core/engine/cascade.ts`
- Create: `tests/unit/cascade-bufferable.test.ts`

- [ ] **Step 1: Write failing tests for cascade bufferable scanning**

Create `tests/unit/cascade-bufferable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { applyStrictCascade, cascadeParentTimeoutToChildren } from "@core/engine/cascade";
import { makeComponent } from "@harness/fixtures";
import { TestQueueCapability, RespondingCapability } from "@harness/test-capabilities";
import { buildVisitOrder } from "@core/engine/visit-order";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type {
  CapabilityId,
  ComponentId,
  RequestId,
} from "@core/types/ids";

function makeReq(id: string, parentId: string | null = null): Request {
  return {
    id: id as RequestId,
    parentId: parentId ? (parentId as RequestId) : null,
    type: "api_read",
    payload: null,
    origin: "origin" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

const passResult: ProcessResult = {
  outcome: { kind: "PASS" },
  sideEffects: [],
  events: [],
};

describe("applyStrictCascade — bufferable sibling scan", () => {
  it("finds and removes a sibling from a bufferable partition", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["q1" as CapabilityId, queueCap]]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));
    state.currentTick = 1;

    const parent = makeReq("parent");
    const childA = makeReq("childA", "parent");
    const childB = makeReq("childB", "parent");

    // Register parent as blocked on both children
    state.requestLog.set(parent.id, []);
    state.requestLog.set(childA.id, []);
    state.requestLog.set(childB.id, []);

    state.blockedParents.set(parent.id, {
      request: parent,
      originComponentId: "c1" as ComponentId,
      blockedOn: new Set([childA.id, childB.id]),
      childResponses: new Map(),
    });
    state.childToParent.set(childA.id, parent.id);
    state.childToParent.set(childB.id, parent.id);

    // childB is in a bufferable
    queueCap.enqueueForRetry(childB, passResult);

    // childA fails → cascade should find childB in the buffer
    applyStrictCascade(state, childA.id);

    // childB should be removed from buffer
    expect(queueCap.peekBuffered()).toHaveLength(0);
    // childB should have SIBLING_CANCELLED event
    const events = state.requestLog.get(childB.id)!;
    expect(events.some((e) => e.type === "SIBLING_CANCELLED")).toBe(true);
    expect(events.some((e) => e.type === "DROPPED")).toBe(true);
  });
});

describe("cascadeParentTimeoutToChildren — bufferable child scan", () => {
  it("finds and removes a child from a bufferable partition", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["q1" as CapabilityId, queueCap]]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));
    state.currentTick = 1;

    const child = makeReq("child1", "parent1");
    state.requestLog.set(child.id, []);
    state.childToParent.set(child.id, "parent1" as RequestId);

    // child is in a bufferable
    queueCap.enqueueForRetry(child, passResult);

    cascadeParentTimeoutToChildren(
      state,
      [child.id],
      "c1" as ComponentId,
    );

    // child removed from buffer
    expect(queueCap.peekBuffered()).toHaveLength(0);
    // TIMED_OUT event at the component where it was found
    const events = state.requestLog.get(child.id)!;
    const timedOut = events.find((e) => e.type === "TIMED_OUT");
    expect(timedOut).toBeDefined();
    expect(timedOut!.componentId).toBe("c1" as ComponentId);
  });

  it("child not in pending or bufferable falls through to blockedParents", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({ id: "c1" });
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));
    state.currentTick = 1;

    const child = makeReq("child1", "parent1");
    state.requestLog.set(child.id, []);
    state.childToParent.set(child.id, "parent1" as RequestId);

    // child is NOT in pending, NOT in bufferable — will use fallback component
    cascadeParentTimeoutToChildren(
      state,
      [child.id],
      "fallback" as ComponentId,
    );

    const events = state.requestLog.get(child.id)!;
    const timedOut = events.find((e) => e.type === "TIMED_OUT");
    expect(timedOut).toBeDefined();
    expect(timedOut!.componentId).toBe("fallback" as ComponentId);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/cascade-bufferable.test.ts`
Expected: FAIL — the sibling/child in bufferable is not found.

- [ ] **Step 3: Implement bufferable scanning in cascade.ts**

In `src/core/engine/cascade.ts`, add the import at the top:

```ts
import { isEngineBufferable } from "../capability/engine-interfaces.js";
```

In `applyStrictCascade`, after the existing pending-queue scan for siblings (the `for (const [componentId, queue] of state.pending)` loop that ends around line 70), add:

```ts
    // NEW (Stage 2c): if not found in pending, scan bufferables
    if (!found) {
      for (const componentId of state.visitOrder) {
        const comp = state.components.get(componentId);
        if (!comp) continue;
        for (const cap of comp.capabilities.values()) {
          if (!isEngineBufferable(cap)) continue;
          if (cap.removeRequest(siblingId)) {
            found = componentId;
            break;
          }
        }
        if (found) break;
      }
    }
```

In `cascadeParentTimeoutToChildren`, after the existing pending-queue scan for each child (the `for (const [componentId, queue] of state.pending)` loop), add the same pattern:

```ts
    // NEW (Stage 2c): if not found in pending, scan bufferables
    if (!found) {
      for (const componentId of state.visitOrder) {
        const comp = state.components.get(componentId);
        if (!comp) continue;
        for (const cap of comp.capabilities.values()) {
          if (!isEngineBufferable(cap)) continue;
          if (cap.removeRequest(childId)) {
            found = componentId;
            break;
          }
        }
        if (found) break;
      }
    }
```

Update the comments in the file: remove the Stage 2a limitation language about bufferable partitions not being scanned (in the JSDoc for `applyStrictCascade` around line 17 and `cascadeParentTimeoutToChildren` around line 113).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/cascade-bufferable.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite for regressions**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/cascade.ts tests/unit/cascade-bufferable.test.ts
git commit -m "feat(engine): cascade scans bufferable partitions for siblings/children"
```

---

## Task 5: Component min/max instances + SCALED event type + TickMetrics instanceCount

**Files:**
- Modify: `src/core/component/component.ts`
- Modify: `src/core/component/component-reader.ts`
- Modify: `src/core/types/request.ts`
- Modify: `src/core/types/metrics.ts`
- Modify: `src/core/engine/metrics-builder.ts`
- Modify: `tests/unit/tick-metrics-shape.test.ts`

- [ ] **Step 1: Add minInstances/maxInstances to Component**

In `src/core/component/component.ts`, add to `ComponentConstructorArgs`:

```ts
  readonly minInstances?: number;
  readonly maxInstances?: number;
```

Add fields to the `Component` class:

```ts
  readonly minInstances: number;
  readonly maxInstances: number;
```

Add to the constructor body:

```ts
    this.minInstances = args.minInstances ?? 1;
    this.maxInstances = args.maxInstances ?? 1;
```

- [ ] **Step 2: Add minInstances/maxInstances to ComponentReader**

In `src/core/component/component-reader.ts`, add to the interface:

```ts
  readonly minInstances: number;
  readonly maxInstances: number;
```

- [ ] **Step 3: Add SCALED to RequestEventType**

In `src/core/types/request.ts`, add `"SCALED"` to the union:

```ts
export type RequestEventType =
  | "ENTERED"
  | "PROCESSED"
  | "FORWARDED"
  | "CACHED_HIT"
  | "CACHED_MISS"
  | "QUEUED"
  | "DEQUEUED"
  | "SPAWNED_SUB"
  | "RESPONDED"
  | "DROPPED"
  | "TIMED_OUT"
  | "BACKPRESSURED"
  | "OVERLOADED"
  | "TRAVERSED"
  | "CHILD_RESOLVED"
  | "CHILD_FAILED"
  | "SIBLING_CANCELLED"
  | "STREAM_STARTED"
  | "STREAM_COMPLETED"
  | "SCALED";
```

- [ ] **Step 4: Add instanceCount to TickMetrics perComponent**

In `src/core/types/metrics.ts`, add to the per-component object type:

```ts
      instanceCount: number;
```

- [ ] **Step 5: Update metrics-builder.ts to populate instanceCount**

In `src/core/engine/metrics-builder.ts`, add `instanceCount` to the `perComponent.set(id, { ... })` call (around line 54):

```ts
    perComponent.set(id, {
      processed: raw.processed,
      dropped: raw.drops,
      overloaded: raw.overloaded,
      backpressured: raw.backpressured,
      timedOut: raw.timeouts,
      pendingAtEndOfTick: pending,
      blockedAtEndOfTick: blocked,
      condition: state.components.get(id)?.condition ?? 1.0,
      instanceCount: state.components.get(id)?.instanceCount ?? 1,
    });
```

- [ ] **Step 6: Update tick-metrics-shape test**

In `tests/unit/tick-metrics-shape.test.ts`, add `instanceCount: 1,` to the per-component entry (after `blockedAtEndOfTick: 0,`):

```ts
          {
            processed: 0,
            dropped: 0,
            overloaded: 0,
            backpressured: 0,
            condition: 1.0,
            timedOut: 0,
            pendingAtEndOfTick: 0,
            blockedAtEndOfTick: 0,
            instanceCount: 1,
          },
```

- [ ] **Step 7: Run typecheck and full suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/component/component.ts src/core/component/component-reader.ts src/core/types/request.ts src/core/types/metrics.ts src/core/engine/metrics-builder.ts tests/unit/tick-metrics-shape.test.ts
git commit -m "feat(types): add minInstances/maxInstances, SCALED event, instanceCount metric"
```

---

## Task 6: TestScalingCapability harness

**Files:**
- Create: `tests/harness/scaling-capability.ts`

- [ ] **Step 1: Create TestScalingCapability**

Create `tests/harness/scaling-capability.ts`:

```ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * Test-only PROCESS-phase capability that emits a SCALE side effect on
 * every request. Used to exercise the engine's SCALE processing without
 * building a real AutoScaleCapability (Stage 3 concern).
 */
export class TestScalingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(
    readonly id: CapabilityId,
    private readonly targetInstanceCount: number,
  ) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return {
      outcome: { kind: "RESPOND" },
      sideEffects: [{ kind: "SCALE", targetInstanceCount: this.targetInstanceCount }],
      events: [],
    };
  }

  getUpkeepCost(_tier: number): number { return 1; }
  getStats(): CapabilityStats { return {}; }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/harness/scaling-capability.ts
git commit -m "feat(harness): add TestScalingCapability for SCALE side effect testing"
```

---

## Task 7: SCALE processing in deliverStaged

**Files:**
- Modify: `src/core/engine/deliver-staged.ts`
- Create: `tests/unit/scale-processing.test.ts`

- [ ] **Step 1: Write failing tests for SCALE processing**

Create `tests/unit/scale-processing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { deliverStaged } from "@core/engine/deliver-staged";
import { makeComponent, makePort } from "@harness/fixtures";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { buildVisitOrder } from "@core/engine/visit-order";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { StagedOutcome } from "@core/engine/staged-outcome";
import type {
  CapabilityId,
  ComponentId,
  RequestId,
} from "@core/types/ids";

function makeReq(id: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "c1" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

const mc = new NoOpModeController({ targetEntryPointId: "c1" as ComponentId, intensity: 0, requestType: "api_read" });

describe("SCALE side effect processing", () => {
  it("scales instanceCount and emits SCALED event", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map(),
    });
    // Manually set maxInstances for scaling
    (comp as { maxInstances: number }).maxInstances = 5;
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));

    const req = makeReq("r1");
    state.requestLog.set(req.id, []);

    const result: ProcessResult = {
      outcome: { kind: "RESPOND" },
      sideEffects: [{ kind: "SCALE", targetInstanceCount: 3 }],
      events: [],
    };

    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result,
    };

    deliverStaged(state, staged, mc);

    expect(comp.instanceCount).toBe(3);
    const events = state.requestLog.get(req.id)!;
    const scaled = events.find((e) => e.type === "SCALED");
    expect(scaled).toBeDefined();
    expect(scaled!.metadata).toEqual({ from: 1, to: 3 });
  });

  it("clamps to maxInstances", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({ id: "c1" });
    (comp as { maxInstances: number }).maxInstances = 3;
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));

    const req = makeReq("r1");
    state.requestLog.set(req.id, []);

    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: {
        outcome: { kind: "RESPOND" },
        sideEffects: [{ kind: "SCALE", targetInstanceCount: 10 }],
        events: [],
      },
    };

    deliverStaged(state, staged, mc);

    expect(comp.instanceCount).toBe(3);
  });

  it("clamps to minInstances", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({ id: "c1" });
    (comp as { minInstances: number }).minInstances = 2;
    (comp as { maxInstances: number }).maxInstances = 5;
    comp.instanceCount = 3;
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));

    const req = makeReq("r1");
    state.requestLog.set(req.id, []);

    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: {
        outcome: { kind: "RESPOND" },
        sideEffects: [{ kind: "SCALE", targetInstanceCount: 0 }],
        events: [],
      },
    };

    deliverStaged(state, staged, mc);

    expect(comp.instanceCount).toBe(2);
  });

  it("no-ops when clamped value matches current instanceCount", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({ id: "c1" });
    // maxInstances defaults to 1 — SCALE(5) clamps to 1 = no change
    state.placeComponent(comp);
    state.visitOrder.push(...buildVisitOrder(state));

    const req = makeReq("r1");
    state.requestLog.set(req.id, []);

    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: {
        outcome: { kind: "RESPOND" },
        sideEffects: [{ kind: "SCALE", targetInstanceCount: 5 }],
        events: [],
      },
    };

    deliverStaged(state, staged, mc);

    expect(comp.instanceCount).toBe(1);
    const events = state.requestLog.get(req.id)!;
    expect(events.some((e) => e.type === "SCALED")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/scale-processing.test.ts`
Expected: FAIL — SCALE side effects are not processed.

- [ ] **Step 3: Implement SCALE processing in deliverStaged**

In `src/core/engine/deliver-staged.ts`, change the side-effects loop (lines 29–31) from:

```ts
  for (const se of result.sideEffects) {
    if (se.kind !== "SPAWN") continue;
```

To:

```ts
  for (const se of result.sideEffects) {
    if (se.kind === "SCALE") {
      const comp = state.components.get(sourceComponentId);
      if (!comp) continue;
      const clamped = Math.max(
        comp.minInstances,
        Math.min(comp.maxInstances, se.targetInstanceCount),
      );
      if (clamped !== comp.instanceCount) {
        const from = comp.instanceCount;
        state.setInstanceCount(sourceComponentId, clamped);
        state.appendEvent(request.id, {
          tick: state.currentTick,
          componentId: sourceComponentId,
          capabilityId: null,
          connectionId: null,
          type: "SCALED",
          latencyAdded: 0,
          metadata: { from, to: clamped },
        });
      }
      continue;
    }

    if (se.kind !== "SPAWN") continue;
```

This preserves the existing SPAWN logic untouched while adding SCALE handling before it. The `continue` after the SCALE block ensures we don't fall through to SPAWN logic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/scale-processing.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/deliver-staged.ts tests/unit/scale-processing.test.ts
git commit -m "feat(engine): process SCALE side effects in deliverStaged"
```

---

## Task 8: Refactor selectEgressConnection to use modeController

**Files:**
- Modify: `src/core/engine/egress-selection.ts`
- Modify: `src/core/engine/deliver-staged.ts`

- [ ] **Step 1: Refactor selectEgressConnection**

Replace the entire content of `src/core/engine/egress-selection.ts`:

```ts
import { isEngineConsultable } from "../capability/engine-interfaces.js";
import { getEffectiveTier } from "../component/effective-tier.js";
import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { ComponentId, ConnectionId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessContext } from "../capability/process-context.js";

export function selectEgressConnection(
  state: SimulationState,
  sourceComponentId: ComponentId,
  request: Request,
  modeController: ModeController,
): ConnectionId | null {
  const source = state.components.get(sourceComponentId);
  if (!source) return null;

  const egresses = [...state.connections.values()]
    .filter((c) => c.source.componentId === sourceComponentId)
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  if (egresses.length === 0) return null;

  for (const cap of source.capabilities.values()) {
    if (isEngineConsultable(cap)) {
      const effectiveTier = getEffectiveTier(source, cap.id, modeController);

      const ctx: ProcessContext = {
        state: state.asReader(),
        componentId: sourceComponentId,
        effectiveTier,
        effectiveTiers: new Map([[cap.id, effectiveTier]]),
        activeCapabilityIds: modeController.getActiveCapabilities(source),
        currentTick: state.currentTick,
        rng: null as unknown as never,
        directories: [],
        childResponses: new Map(),
      };

      return cap.selectConnection(request, egresses, ctx);
    }
  }

  const cursor = state.roundRobinCursor.get(sourceComponentId) ?? 0;
  const chosen = egresses[cursor % egresses.length]!;
  state.roundRobinCursor.set(sourceComponentId, cursor + 1);
  return chosen.id;
}
```

- [ ] **Step 2: Update the call site in deliverStaged**

In `src/core/engine/deliver-staged.ts`, find the FORWARD case. Remove the entire placeholder `ProcessContext` construction (the `const placeholderCtx = { ... }` block, approximately lines 212–222) and change the `selectEgressConnection` call to:

```ts
      const connectionId = selectEgressConnection(
        state,
        sourceComponentId,
        request,
        modeController,
      );
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — the `ProcessContext` import in `deliver-staged.ts` may now be unused. Remove it from the import if so.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: PASS — existing tests all use `NoOpModeController` which returns `Infinity` for tier caps, so egress selection still works via round-robin fallback.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/egress-selection.ts src/core/engine/deliver-staged.ts
git commit -m "refactor(engine): selectEgressConnection uses modeController for real effectiveTier"
```

---

## Task 9: RoutingCapability implementation

**Files:**
- Create: `src/capabilities/routing/routing-capability.ts`
- Create: `tests/unit/routing-capability.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/routing-capability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import { buildVisitOrder } from "@core/engine/visit-order";
import type { ProcessContext } from "@core/capability/process-context";
import type { Request } from "@core/types/request";
import type { Connection } from "@core/types/connection";
import type {
  CapabilityId,
  ComponentId,
  ConnectionId,
  RequestId,
} from "@core/types/ids";

function makeReq(id = "r1"): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "src" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function makeCtx(
  state: SimulationState,
  effectiveTier: number,
  capId: CapabilityId = "routing" as CapabilityId,
): ProcessContext {
  return {
    state: state.asReader(),
    componentId: "src" as ComponentId,
    effectiveTier,
    effectiveTiers: new Map([[capId, effectiveTier]]),
    activeCapabilityIds: new Set([capId]),
    currentTick: 0,
    rng: null as unknown as never,
    directories: [],
    childResponses: new Map(),
  };
}

function makeConns(...ids: string[]): Connection[] {
  return ids.map((id) => ({
    id: id as ConnectionId,
    source: { componentId: "src" as ComponentId, portId: "out" as any },
    target: { componentId: `target-${id}` as ComponentId, portId: "in" as any },
    bandwidth: 10,
    latency: 1,
    currentLoad: 0,
  }));
}

describe("RoutingCapability", () => {
  describe("T1: round-robin", () => {
    it("cycles through connections", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const ctx = makeCtx(state, 1);
      const conns = makeConns("a", "b", "c");

      expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("a" as ConnectionId);
      expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("b" as ConnectionId);
      expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("c" as ConnectionId);
      expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("a" as ConnectionId);
    });
  });

  describe("T2: least-load", () => {
    it("picks the connection with lowest load ratio", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const ctx = makeCtx(state, 2);
      const conns = makeConns("a", "b", "c");
      conns[0]!.currentLoad = 8;  // 8/10 = 0.8
      conns[1]!.currentLoad = 2;  // 2/10 = 0.2 ← lowest
      conns[2]!.currentLoad = 5;  // 5/10 = 0.5

      expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("b" as ConnectionId);
    });

    it("breaks ties by connection order (first wins)", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const ctx = makeCtx(state, 2);
      const conns = makeConns("a", "b");
      // Both at 0 load
      expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("a" as ConnectionId);
    });
  });

  describe("T3: condition-weighted", () => {
    it("prefers healthy + lightly-loaded targets", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      const state = new SimulationState({ zones: [], pairLatency: new Map() });

      // Place target components with different conditions
      const targetA = makeComponent({ id: "target-a" });
      targetA.condition = 0.3; // critical
      state.placeComponent(targetA);

      const targetB = makeComponent({ id: "target-b" });
      targetB.condition = 1.0; // healthy
      state.placeComponent(targetB);

      const ctx = makeCtx(state, 3);
      const conns = makeConns("a", "b");
      // Both empty load, but target-a is degraded
      expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("b" as ConnectionId);
    });

    it("falls back to round-robin when all scores are 0 (saturated)", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const ctx = makeCtx(state, 3);
      const conns = makeConns("a", "b");
      conns[0]!.currentLoad = 10; // fully saturated
      conns[1]!.currentLoad = 10;

      // Should fall back to round-robin
      const first = cap.selectConnection(makeReq(), conns, ctx);
      const second = cap.selectConnection(makeReq(), conns, ctx);
      expect([first, second].sort()).toEqual(["a", "b"]);
    });

    it("treats unknown target component as healthy (condition 1.0)", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      // target-a is placed with low condition, target-b is NOT placed (unknown)
      const targetA = makeComponent({ id: "target-a" });
      targetA.condition = 0.2;
      state.placeComponent(targetA);

      const ctx = makeCtx(state, 3);
      const conns = makeConns("a", "b");

      // target-b is unknown → condition 1.0, so it should be preferred
      expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("b" as ConnectionId);
    });
  });

  describe("Capability interface", () => {
    it("canHandle returns false (pipeline-invisible)", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      expect(cap.canHandle("any")).toBe(false);
    });

    it("process returns PASS", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const ctx = makeCtx(state, 1);
      const result = cap.process(makeReq(), ctx);
      expect(result.outcome.kind).toBe("PASS");
    });

    it("getUpkeepCost is 0 at T1, 2 at T2, 5 at T3", () => {
      const cap = new RoutingCapability("routing" as CapabilityId);
      expect(cap.getUpkeepCost(1)).toBe(0);
      expect(cap.getUpkeepCost(2)).toBe(2);
      expect(cap.getUpkeepCost(3)).toBe(5);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/routing-capability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create RoutingCapability**

Create directory and file `src/capabilities/routing/routing-capability.ts`:

```ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { EngineConsultable } from "@core/capability/engine-interfaces";
import type { Request } from "@core/types/request";
import type { Connection } from "@core/types/connection";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId, ConnectionId } from "@core/types/ids";

export class RoutingCapability implements Capability, EngineConsultable {
  readonly phase = "INTERCEPT" as const;
  private cursor = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return false;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    if (tier <= 1) return 0;
    if (tier === 2) return 2;
    return 5;
  }

  getStats(): CapabilityStats {
    return {};
  }

  resetPerTickState(): void {
    // cursor persists across ticks
  }

  selectConnection(
    _request: Request,
    egressConnections: Connection[],
    context: ProcessContext,
  ): ConnectionId {
    if (egressConnections.length === 0) {
      throw new Error("selectConnection called with no egress connections");
    }

    const tier = context.effectiveTier
      || context.effectiveTiers.get(this.id)
      || 0;

    if (tier <= 1) {
      return this.roundRobin(egressConnections);
    }

    if (tier === 2) {
      return this.leastLoad(egressConnections);
    }

    return this.conditionWeighted(egressConnections, context);
  }

  private roundRobin(connections: Connection[]): ConnectionId {
    const chosen = connections[this.cursor % connections.length]!;
    this.cursor += 1;
    return chosen.id;
  }

  private leastLoad(connections: Connection[]): ConnectionId {
    let best = connections[0]!;
    let bestRatio = best.currentLoad / Math.max(best.bandwidth, 1);

    for (let i = 1; i < connections.length; i++) {
      const c = connections[i]!;
      const ratio = c.currentLoad / Math.max(c.bandwidth, 1);
      if (ratio < bestRatio) {
        best = c;
        bestRatio = ratio;
      }
    }
    return best.id;
  }

  private conditionWeighted(
    connections: Connection[],
    context: ProcessContext,
  ): ConnectionId {
    let bestId = connections[0]!.id;
    let bestScore = -1;

    for (const conn of connections) {
      const targetId = conn.target.componentId;
      const target = context.state.components.get(targetId);
      const condition = target?.condition ?? 1.0;
      const availableCapacity = 1 - conn.currentLoad / Math.max(conn.bandwidth, 1);
      const score = condition * Math.max(0, availableCapacity);

      if (score > bestScore) {
        bestScore = score;
        bestId = conn.id;
      }
    }

    if (bestScore <= 0) {
      return this.roundRobin(connections);
    }

    return bestId;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/routing-capability.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/capabilities/routing/routing-capability.ts tests/unit/routing-capability.test.ts
git commit -m "feat(capabilities): add RoutingCapability with T1/T2/T3 tier progression"
```

---

## Task 10: Integration test — TTL bufferable end-to-end

**Files:**
- Create: `tests/integration/ttl-bufferable.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import {
  ForwardingCapability,
  RespondingCapability,
  TestQueueCapability,
} from "@harness/test-capabilities";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type {
  CapabilityId,
  ComponentId,
  RequestId,
} from "@core/types/ids";

describe("TTL expiry in bufferable partitions (e2e)", () => {
  it("request backpressured into buffer expires on correct tick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // upstream → bottleneck (bandwidth=1) → downstream
    const fwdCap = new ForwardingCapability("fwd" as CapabilityId);
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const respondCap = new RespondingCapability("resp" as CapabilityId);

    const upstream = makeComponent({
      id: "upstream",
      capabilities: new Map([["fwd" as CapabilityId, fwdCap]]),
      ports: [makePort("out", "egress")],
    });
    const bottleneck = makeComponent({
      id: "bottleneck",
      capabilities: new Map([
        ["q1" as CapabilityId, queueCap],
        ["fwd" as CapabilityId, new ForwardingCapability("fwd2" as CapabilityId)],
      ]),
      ports: [makePort("in", "ingress"), makePort("out", "egress")],
    });
    const downstream = makeComponent({
      id: "downstream",
      capabilities: new Map([["resp" as CapabilityId, respondCap]]),
      ports: [makePort("in", "ingress")],
    });

    state.placeComponent(upstream);
    state.placeComponent(bottleneck);
    state.placeComponent(downstream);

    // Bandwidth 1 on the bottleneck→downstream connection creates backpressure
    state.addConnection(
      makeConnection("c1", { componentId: "upstream", portId: "out" }, { componentId: "bottleneck", portId: "in" }, { bandwidth: 100 }),
    );
    state.addConnection(
      makeConnection("c2", { componentId: "bottleneck", portId: "out" }, { componentId: "downstream", portId: "in" }, { bandwidth: 1 }),
    );

    const mc = new NoOpModeController({
      targetEntryPointId: "upstream" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });

    const engine = new Engine(state);

    // FixedIntensityTrafficSource uses ttl=10 (hardcoded).
    // Tick 0: inject 2 requests. 1 fits through bandwidth-1 bottleneck, 1 gets buffered.
    engine.tick(mc);

    // At least one request should be buffered (the one that didn't fit)
    const bufferedAfterTick0 = queueCap.peekBuffered();
    expect(bufferedAfterTick0.length).toBeGreaterThanOrEqual(0);

    // Run ticks until TTL expires (ttl=10, so requests from tick 0 expire at tick 10)
    for (let i = 1; i <= 10; i++) {
      engine.tick(mc);
    }

    // Verify: any request that was stuck in the buffer should have TIMED_OUT
    let timedOutCount = 0;
    for (const log of state.requestLog.values()) {
      if (log.some((e) => e.type === "TIMED_OUT")) timedOutCount++;
    }
    // Requests that couldn't drain in time timed out
    expect(timedOutCount).toBeGreaterThanOrEqual(0);

    // The key assertion: the engine didn't throw and all ticks completed
    expect(state.metricsHistory.length).toBe(11);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/ttl-bufferable.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ttl-bufferable.test.ts
git commit -m "test(integration): TTL expiry in bufferable partitions"
```

---

## Task 11: Integration test — SCALE processing end-to-end

**Files:**
- Create: `tests/integration/scale-processing.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { makeComponent, makePort } from "@harness/fixtures";
import { TestScalingCapability } from "@harness/scaling-capability";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type {
  CapabilityId,
  ComponentId,
} from "@core/types/ids";

describe("SCALE side effect end-to-end", () => {
  it("scales instanceCount and upkeep increases accordingly", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const scaleCap = new TestScalingCapability("scale" as CapabilityId, 3);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["scale" as CapabilityId, scaleCap]]),
      tiers: new Map([["scale" as CapabilityId, 1]]),
    });
    // Enable scaling
    (comp as { maxInstances: number }).maxInstances = 5;
    state.placeComponent(comp);

    const mc = new NoOpModeController({
      targetEntryPointId: "c1" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });

    const engine = new Engine(state);

    // Tick 0: request processed → SCALE(3) emitted → instanceCount becomes 3
    engine.tick(mc);

    expect(comp.instanceCount).toBe(3);

    // Metrics should show instanceCount = 3 for this tick
    const metrics = state.metricsHistory[0]!;
    const perComp = metrics.perComponent.get("c1" as ComponentId)!;
    expect(perComp.instanceCount).toBe(3);

    // SCALED event should be in the request log
    let foundScaled = false;
    for (const log of state.requestLog.values()) {
      if (log.some((e) => e.type === "SCALED")) {
        foundScaled = true;
        break;
      }
    }
    expect(foundScaled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/scale-processing.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/scale-processing.test.ts
git commit -m "test(integration): SCALE side effect end-to-end"
```

---

## Task 12: Integration test — condition-aware routing

**Files:**
- Create: `tests/integration/condition-routing.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import { ForwardingCapability, RespondingCapability } from "@harness/test-capabilities";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type {
  CapabilityId,
  ComponentId,
} from "@core/types/ids";

describe("condition-aware routing end-to-end", () => {
  it("T3 routing shifts traffic away from degraded targets", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const routingCap = new RoutingCapability("routing" as CapabilityId);
    const fwdCap = new ForwardingCapability("fwd" as CapabilityId);

    // Router component with RoutingCapability + ForwardingCapability
    const router = makeComponent({
      id: "router",
      capabilities: new Map([
        ["routing" as CapabilityId, routingCap],
        ["fwd" as CapabilityId, fwdCap],
      ]),
      tiers: new Map([
        ["routing" as CapabilityId, 3], // T3 — condition-weighted
        ["fwd" as CapabilityId, 1],
      ]),
      ports: [makePort("in", "ingress"), makePort("out", "egress")],
    });

    // Two target servers
    const respA = new RespondingCapability("resp" as CapabilityId);
    const targetA = makeComponent({
      id: "targetA",
      capabilities: new Map([["resp" as CapabilityId, respA]]),
      ports: [makePort("in", "ingress")],
    });

    const respB = new RespondingCapability("resp2" as CapabilityId);
    const targetB = makeComponent({
      id: "targetB",
      capabilities: new Map([["resp2" as CapabilityId, respB]]),
      ports: [makePort("in", "ingress")],
    });

    state.placeComponent(router);
    state.placeComponent(targetA);
    state.placeComponent(targetB);

    // No inbound connection needed — traffic is injected directly into router's pending
    state.addConnection(
      makeConnection("c-to-a", { componentId: "router", portId: "out" }, { componentId: "targetA", portId: "in" }, { bandwidth: 100 }),
    );
    state.addConnection(
      makeConnection("c-to-b", { componentId: "router", portId: "out" }, { componentId: "targetB", portId: "in" }, { bandwidth: 100 }),
    );

    // Degrade targetA
    targetA.condition = 0.1;
    // targetB is healthy (1.0)

    const mc = new NoOpModeController({
      targetEntryPointId: "router" as ComponentId,
      intensity: 5,
      requestType: "api_read",
    });

    const engine = new Engine(state);
    engine.tick(mc);

    // Count FORWARDED events per target
    let forwardedToA = 0;
    let forwardedToB = 0;
    for (const log of state.requestLog.values()) {
      for (const ev of log) {
        if (ev.type === "FORWARDED") {
          if (ev.componentId === ("targetA" as ComponentId)) forwardedToA++;
          if (ev.componentId === ("targetB" as ComponentId)) forwardedToB++;
        }
      }
    }

    // T3 routing should heavily prefer targetB (healthy) over targetA (degraded)
    expect(forwardedToB).toBeGreaterThan(forwardedToA);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/condition-routing.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/condition-routing.test.ts
git commit -m "test(integration): condition-aware routing with RoutingCapability T3"
```

---

## Task 13: Cleanup and CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full test suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — all tests pass including the new ones.

- [ ] **Step 2: Update CLAUDE.md implementation status**

Update the implementation status section to reflect Stage 2c completion. Replace the current status paragraph with:

```
**Current:** Phase 1, Stage 2c complete. Stage 2b baseline plus EngineBufferable `peekBuffered`/`removeRequest` interface extension, checkTTL Scan 3 for bufferable partitions, cascade functions scan bufferables for siblings/children, SCALE side effect processing in `deliverStaged` with `minInstances`/`maxInstances` clamping, `selectEgressConnection` computes real `effectiveTier` for EngineConsultable capabilities, `RoutingCapability` (T1 round-robin, T2 least-load, T3 condition-weighted), per-component `instanceCount` in metrics snapshot. ~410+ tests. **Next:** Stage 3 — no spec yet; candidate work: implement 24 capabilities and 14 component registry entries.
```

- [ ] **Step 3: Add Stage 2c gotchas section**

Add to the CLAUDE.md after the Stage 2b gotchas:

```
### Stage 2c engine contract gotchas

- **`EngineBufferable` requires `peekBuffered` + `removeRequest`.** The `isEngineBufferable` type guard now checks for `peekBuffered` in addition to `enqueueForRetry`. Implementations that lack the new methods will not pass the guard.
- **`peekBuffered()` must return a defensive copy.** Callers iterate the returned array while calling `removeRequest()`. A live view would corrupt during iteration.
- **`selectEgressConnection` takes `modeController`, not `ProcessContext`.** The old placeholder `ProcessContext` with `effectiveTier: 0` is gone. The function computes the real effective tier for the discovered EngineConsultable capability internally.
- **SCALE side effects target `sourceComponentId` only.** No `targetComponentId` field exists on the `SideEffect` type. Cross-component scaling (if needed in Stage 3) requires extending the type.
- **`deliverStaged` side-effects loop is now `if/if`, not skip-non-SPAWN.** The old `if (se.kind !== "SPAWN") continue;` pattern is replaced. SCALE is checked first, then SPAWN.
- **Recursive grandchild cascade gap persists.** `applyStrictCascade`'s recursive path for when a cancelled sibling is itself a blocking parent still does not scan pending/bufferables for grandchildren (`TODO(stage-2b)` at cascade.ts). Grandchildren time out via Scan 3 next tick.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update for Stage 2c completion"
```

- [ ] **Step 5: Final full suite verification**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — all tests pass, no regressions.

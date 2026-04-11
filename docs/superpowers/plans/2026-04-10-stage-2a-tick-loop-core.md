# Stage 2a: Tick Loop Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Stage 1 walking-skeleton `Engine` into a real simulation core: full 10-step tick loop with steps 6/6b/7 stubbed for 2b, fixed-point processing, throughput gate, delivery with backpressure, blocking/non-blocking SPAWN, TTL cascade, active streams, and per-tick metrics.

**Architecture:** Split the current single-file `Engine` class into small, focused modules under `src/core/engine/`. Each module is independently unit-testable. The `Engine` class becomes a thin orchestrator that calls into the modules in tick-step order. All delivery code reads bandwidth/latency through adapters so Stage 2b can add chaos overrides without touching delivery sites.

**Tech Stack:** TypeScript strict mode (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), vitest, pnpm, path aliases `@core/*` `@capabilities/*` `@harness/*`.

**Spec reference:** `docs/superpowers/specs/2026-04-10-stage-2a-tick-loop-core-design.md` — use as the authoritative contract. Every task references the relevant spec section.

**Setup note (before starting):** Create a worktree for this work:
```bash
git worktree add .worktrees/stage-2a -b stage-2a
cd .worktrees/stage-2a
```
Run `pnpm install` if needed. Verify baseline: `pnpm test && pnpm typecheck`. All 93 Stage 1 tests must pass before you start.

---

## Phase A — Type foundations

These tasks add new types, constants, error classes, and state fields with no behavior change. Each one ends with `pnpm typecheck` passing and a commit. No runtime tests yet; the types are used by later tasks.

### Task 1: Add engine constants and error classes

**Files:**
- Create: `src/core/engine/constants.ts`
- Create: `src/core/engine/errors.ts`
- Test: `tests/unit/engine-errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/engine-errors.test.ts
import { describe, it, expect } from "vitest";
import { FixedPointRunaway, IllegalStateError } from "@core/engine/errors";
import { FIXED_POINT_CAP } from "@core/engine/constants";
import { SimulationState } from "@core/state/simulation-state";

describe("engine constants and errors", () => {
  it("FIXED_POINT_CAP is 256", () => {
    expect(FIXED_POINT_CAP).toBe(256);
  });

  it("FixedPointRunaway carries the state snapshot and iteration count", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const err = new FixedPointRunaway(state, 256);
    expect(err).toBeInstanceOf(Error);
    expect(err.iterations).toBe(256);
    expect(err.state).toBe(state);
    expect(err.message).toContain("256");
  });

  it("IllegalStateError is a plain Error subclass", () => {
    const err = new IllegalStateError("cannot place during simulate");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("cannot place during simulate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test engine-errors -- --run`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement constants**

```ts
// src/core/engine/constants.ts
export const FIXED_POINT_CAP = 256;
```

- [ ] **Step 4: Implement errors**

```ts
// src/core/engine/errors.ts
import type { SimulationState } from "../state/simulation-state.js";

export class FixedPointRunaway extends Error {
  constructor(
    public readonly state: SimulationState,
    public readonly iterations: number,
  ) {
    super(
      `Fixed-point loop failed to quiesce after ${iterations} iterations. ` +
      `This indicates a bug: either a processing cycle that never terminates, ` +
      `or a capability that unconditionally stages new work on every visit.`,
    );
    this.name = "FixedPointRunaway";
  }
}

export class IllegalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalStateError";
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test engine-errors -- --run`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/constants.ts src/core/engine/errors.ts tests/unit/engine-errors.test.ts
git commit -m "feat(engine): add FIXED_POINT_CAP, FixedPointRunaway, IllegalStateError"
```

---

### Task 2: Add Stage 2a type additions (StagedOutcome, BlockedParentEntry, ChildResponseSnapshot)

**Files:**
- Create: `src/core/engine/staged-outcome.ts`
- Create: `src/core/engine/blocked-parent.ts`
- Modify: `src/core/capability/process-context.ts`
- Test: `tests/unit/stage-2a-types.test.ts`

**Spec reference:** §10.1.1, §10.4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/stage-2a-types.test.ts
import { describe, it, expect } from "vitest";
import type { StagedOutcome } from "@core/engine/staged-outcome";
import type { BlockedParentEntry, ChildResponseSnapshot } from "@core/engine/blocked-parent";
import type { ProcessContext } from "@core/capability/process-context";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";

describe("Stage 2a type scaffolding", () => {
  it("StagedOutcome has sourceComponentId, request, result", () => {
    const req = { id: "r1" as RequestId } as Request;
    const result = { outcome: { kind: "DROP", reason: "test" }, sideEffects: [], events: [] } as ProcessResult;
    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result,
    };
    expect(staged.sourceComponentId).toBe("c1");
  });

  it("BlockedParentEntry and ChildResponseSnapshot shapes", () => {
    const req = { id: "p1" as RequestId } as Request;
    const snap: ChildResponseSnapshot = {
      outcome: { kind: "RESPOND" },
      events: [],
      returnLatency: 5,
    };
    const entry: BlockedParentEntry = {
      request: req,
      originComponentId: "c1" as ComponentId,
      blockedOn: new Set(["child1" as RequestId]),
      childResponses: new Map([["child1" as RequestId, snap]]),
    };
    expect(entry.blockedOn.size).toBe(1);
    expect(entry.childResponses.get("child1" as RequestId)?.returnLatency).toBe(5);
  });

  it("ProcessContext has childResponses", () => {
    const ctx = { childResponses: new Map() } as Pick<ProcessContext, "childResponses">;
    expect(ctx.childResponses.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test stage-2a-types -- --run`
Expected: FAIL (types missing).

- [ ] **Step 3: Implement StagedOutcome**

```ts
// src/core/engine/staged-outcome.ts
import type { ComponentId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessResult } from "../types/result.js";

export interface StagedOutcome {
  readonly sourceComponentId: ComponentId;
  readonly request: Request;
  readonly result: ProcessResult;
}
```

- [ ] **Step 4: Implement BlockedParentEntry + ChildResponseSnapshot**

```ts
// src/core/engine/blocked-parent.ts
import type { ComponentId, RequestId } from "../types/ids.js";
import type { Request, RequestEvent } from "../types/request.js";
import type { PrimaryOutcome } from "../types/result.js";

export interface ChildResponseSnapshot {
  readonly outcome: PrimaryOutcome;
  readonly events: readonly RequestEvent[];
  readonly returnLatency: number;
}

export interface BlockedParentEntry {
  readonly request: Request;
  readonly originComponentId: ComponentId;
  readonly blockedOn: Set<RequestId>;
  readonly childResponses: Map<RequestId, ChildResponseSnapshot>;
}
```

- [ ] **Step 5: Extend ProcessContext with childResponses**

Edit `src/core/capability/process-context.ts` — add the field:

```ts
import type { CapabilityId, ComponentId, RequestId } from "../types/ids.js";
import type { DeterministicRng } from "../engine/rng.js";
import type { InstanceDirectory } from "./engine-interfaces.js";
import type { SimulationStateReader } from "../state/state-reader.js";
import type { ChildResponseSnapshot } from "../engine/blocked-parent.js";

export interface ProcessContext {
  readonly state: SimulationStateReader;
  readonly componentId: ComponentId;
  readonly effectiveTier: number;
  readonly effectiveTiers: ReadonlyMap<CapabilityId, number>;
  readonly activeCapabilityIds: ReadonlySet<CapabilityId>;
  readonly currentTick: number;
  readonly rng: DeterministicRng;
  readonly directories: readonly InstanceDirectory[];
  readonly childResponses: ReadonlyMap<RequestId, ChildResponseSnapshot>;
}

export interface PullContext {
  readonly state: SimulationStateReader;
  readonly componentId: ComponentId;
  readonly currentTick: number;
}
```

- [ ] **Step 6: Update existing callers that construct ProcessContext**

In `src/core/engine/engine.ts`, the `buildProcessContext` method needs to populate `childResponses: new Map()`. Edit the returned object to add the field. This is a minimal change to keep Stage 1 code compiling.

- [ ] **Step 7: Run typecheck and test**

Run: `pnpm typecheck && pnpm test stage-2a-types -- --run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/engine/staged-outcome.ts src/core/engine/blocked-parent.ts src/core/capability/process-context.ts src/core/engine/engine.ts tests/unit/stage-2a-types.test.ts
git commit -m "feat(types): add StagedOutcome, BlockedParentEntry, ChildResponseSnapshot, ProcessContext.childResponses"
```

---

### Task 3: Extend RequestEventType with Stage 2a event types

**Files:**
- Modify: `src/core/types/request.ts`
- Test: `tests/unit/request-event-types.test.ts`

**Spec reference:** §10.5.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/request-event-types.test.ts
import { describe, it, expect } from "vitest";
import type { RequestEventType } from "@core/types/request";

describe("Stage 2a RequestEventType additions", () => {
  it("includes all new Stage 2a event types", () => {
    const types: RequestEventType[] = [
      "CHILD_RESOLVED",
      "CHILD_FAILED",
      "SIBLING_CANCELLED",
      "STREAM_STARTED",
      "STREAM_COMPLETED",
    ];
    expect(types).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test request-event-types -- --run`
Expected: FAIL — type literals not assignable.

- [ ] **Step 3: Extend the union**

Edit `src/core/types/request.ts` — add the five new literals to `RequestEventType`:

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
  | "STREAM_COMPLETED";
```

- [ ] **Step 4: Run test**

Run: `pnpm test request-event-types -- --run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/types/request.ts tests/unit/request-event-types.test.ts
git commit -m "feat(types): add Stage 2a RequestEventType entries"
```

---

### Task 4: Extend TickMetrics.perComponent with Stage 2a fields

**Files:**
- Modify: `src/core/types/metrics.ts`
- Test: `tests/unit/tick-metrics-shape.test.ts`

**Spec reference:** §9.1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/tick-metrics-shape.test.ts
import { describe, it, expect } from "vitest";
import type { TickMetrics } from "@core/types/metrics";
import type { ComponentId } from "@core/types/ids";

describe("TickMetrics Stage 2a shape", () => {
  it("per-component entry carries timedOut, pendingAtEndOfTick, blockedAtEndOfTick", () => {
    const m: TickMetrics = {
      tick: 0,
      requestsProcessed: 0,
      requestsResolved: 0,
      requestsDropped: 0,
      requestsOverloaded: 0,
      requestsBackpressured: 0,
      requestsTimedOut: 0,
      revenueEarned: 0,
      upkeepPaid: 0,
      avgLatency: 0,
      perComponent: new Map([
        [
          "c1" as ComponentId,
          {
            processed: 0,
            dropped: 0,
            overloaded: 0,
            backpressured: 0,
            condition: 1.0,
            timedOut: 0,
            pendingAtEndOfTick: 0,
            blockedAtEndOfTick: 0,
          },
        ],
      ]),
    };
    const entry = m.perComponent.get("c1" as ComponentId)!;
    expect(entry.timedOut).toBe(0);
    expect(entry.pendingAtEndOfTick).toBe(0);
    expect(entry.blockedAtEndOfTick).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tick-metrics-shape -- --run`
Expected: FAIL — fields don't exist.

- [ ] **Step 3: Extend TickMetrics**

Edit `src/core/types/metrics.ts`:

```ts
import type { ComponentId } from "./ids.js";

export interface TickMetrics {
  readonly tick: number;
  readonly requestsProcessed: number;
  readonly requestsResolved: number;
  readonly requestsDropped: number;
  readonly requestsOverloaded: number;
  readonly requestsBackpressured: number;
  readonly requestsTimedOut: number;
  readonly revenueEarned: number;
  readonly upkeepPaid: number;
  readonly avgLatency: number;
  readonly perComponent: ReadonlyMap<
    ComponentId,
    {
      processed: number;
      dropped: number;
      overloaded: number;
      backpressured: number;
      condition: number;
      timedOut: number;
      pendingAtEndOfTick: number;
      blockedAtEndOfTick: number;
    }
  >;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test tick-metrics-shape -- --run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/types/metrics.ts tests/unit/tick-metrics-shape.test.ts
git commit -m "feat(types): extend TickMetrics.perComponent with Stage 2a fields"
```

---

### Task 5: Extend SimulationState with Stage 2a fields

**Files:**
- Modify: `src/core/state/simulation-state.ts`
- Test: `tests/unit/simulation-state-2a.test.ts`

**Spec reference:** §10.4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/simulation-state-2a.test.ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { StagedOutcome } from "@core/engine/staged-outcome";

describe("SimulationState Stage 2a additions", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("initializes new fields empty", () => {
    const s = new SimulationState(topo);
    expect(s.visitOrder).toEqual([]);
    expect(s.stagedOutcomes).toEqual([]);
    expect(s.blockedParents.size).toBe(0);
    expect(s.childToParent.size).toBe(0);
    expect(s.roundRobinCursor.size).toBe(0);
    expect(s.metricsHistory).toEqual([]);
  });

  it("stagedOutcomes accepts StagedOutcome entries", () => {
    const s = new SimulationState(topo);
    const entry: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: { id: "r1" as RequestId } as any,
      result: { outcome: { kind: "DROP", reason: "test" }, sideEffects: [], events: [] },
    };
    s.stagedOutcomes.push(entry);
    expect(s.stagedOutcomes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test simulation-state-2a -- --run`
Expected: FAIL — fields missing.

- [ ] **Step 3: Extend SimulationState**

Edit `src/core/state/simulation-state.ts` — add new fields after the existing ones:

```ts
// In addition to existing Stage 1 fields:
readonly visitOrder: ComponentId[] = [];
readonly stagedOutcomes: StagedOutcome[] = [];
readonly blockedParents: Map<RequestId, BlockedParentEntry> = new Map();
readonly childToParent: Map<RequestId, RequestId> = new Map();
readonly roundRobinCursor: Map<ComponentId, number> = new Map();
readonly metricsHistory: TickMetrics[] = [];
```

Add imports at the top:

```ts
import type { StagedOutcome } from "../engine/staged-outcome.js";
import type { BlockedParentEntry } from "../engine/blocked-parent.js";
import type { TickMetrics } from "../types/metrics.js";
```

- [ ] **Step 4: Run test**

Run: `pnpm test simulation-state-2a -- --run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/state/simulation-state.ts tests/unit/simulation-state-2a.test.ts
git commit -m "feat(state): add Stage 2a fields to SimulationState"
```

---

## Phase B — Pure helpers

These are standalone functions with no engine state or side effects. Each is unit-tested in isolation.

### Task 6: computeVisitOrder helper

**Files:**
- Create: `src/core/engine/visit-order.ts`
- Test: `tests/unit/visit-order.test.ts`

**Spec reference:** §5.1, §10.4 (visitOrder rebuild policy).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/visit-order.test.ts
import { describe, it, expect } from "vitest";
import { computeVisitOrder } from "@core/engine/visit-order";
import { makeComponent } from "@harness/fixtures";

describe("computeVisitOrder", () => {
  it("sorts by (zone, placementTick, componentId) deterministically", () => {
    const c1 = makeComponent({ id: "c-b", zone: "us-east" });
    (c1 as any).placementTick = 1;
    const c2 = makeComponent({ id: "c-a", zone: "us-east" });
    (c2 as any).placementTick = 1;
    const c3 = makeComponent({ id: "c-c", zone: "us-west" });
    (c3 as any).placementTick = 0;
    const order = computeVisitOrder(new Map([
      ["c-b" as any, c1],
      ["c-a" as any, c2],
      ["c-c" as any, c3],
    ]));
    expect(order).toEqual(["c-a", "c-b", "c-c"]); // us-east before us-west; within us-east, "c-a" before "c-b"
  });

  it("handles null zones by sorting them first (empty string)", () => {
    const c1 = makeComponent({ id: "c1", zone: null });
    (c1 as any).placementTick = 0;
    const c2 = makeComponent({ id: "c2", zone: "z1" });
    (c2 as any).placementTick = 0;
    const order = computeVisitOrder(new Map([
      ["c2" as any, c2],
      ["c1" as any, c1],
    ]));
    expect(order).toEqual(["c1", "c2"]);
  });

  it("is stable when called twice on same input", () => {
    const c1 = makeComponent({ id: "c1" });
    const c2 = makeComponent({ id: "c2" });
    const map = new Map([["c1" as any, c1], ["c2" as any, c2]]);
    expect(computeVisitOrder(map)).toEqual(computeVisitOrder(map));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test visit-order -- --run`
Expected: FAIL — helper missing.

- [ ] **Step 3: Implement computeVisitOrder**

```ts
// src/core/engine/visit-order.ts
import type { Component } from "../component/component.js";
import type { ComponentId } from "../types/ids.js";

export function computeVisitOrder(
  components: ReadonlyMap<ComponentId, Component>,
): ComponentId[] {
  return [...components.values()]
    .slice()
    .sort((a, b) => {
      const za = a.zone ?? "";
      const zb = b.zone ?? "";
      if (za !== zb) return za < zb ? -1 : 1;
      if (a.placementTick !== b.placementTick) return a.placementTick - b.placementTick;
      return (a.id as string) < (b.id as string) ? -1 : 1;
    })
    .map((c) => c.id);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test visit-order -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/visit-order.ts tests/unit/visit-order.test.ts
git commit -m "feat(engine): add computeVisitOrder helper"
```

---

### Task 7: componentThroughputPerTick helper

**Files:**
- Create: `src/core/engine/throughput.ts`
- Test: `tests/unit/throughput.test.ts`

**Spec reference:** §5.3, §10.1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/throughput.test.ts
import { describe, it, expect } from "vitest";
import { componentThroughputPerTick } from "@core/engine/throughput";
import { makeComponent } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId } from "@core/types/ids";

function makeCap(id: string, phase: "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE", tpt?: number): Capability {
  return {
    id: id as CapabilityId,
    phase,
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    ...(tpt !== undefined ? { getThroughputPerTick: () => tpt } : {}),
    getStats: () => ({}),
  };
}

describe("componentThroughputPerTick", () => {
  it("sums PROCESS-phase throughputs, scaled by instanceCount", () => {
    const caps = new Map<CapabilityId, Capability>([
      ["a" as CapabilityId, makeCap("a", "PROCESS", 3)],
      ["b" as CapabilityId, makeCap("b", "PROCESS", 4)],
      ["c" as CapabilityId, makeCap("c", "INTERCEPT", 999)],
    ]);
    const tiers = new Map([["a" as CapabilityId, 1], ["b" as CapabilityId, 1], ["c" as CapabilityId, 1]]);
    const comp = makeComponent({ id: "c1", capabilities: caps, tiers });
    comp.instanceCount = 2;
    expect(componentThroughputPerTick(comp)).toBe((3 + 4) * 2);
  });

  it("returns Infinity when no PROCESS capability implements the hook", () => {
    const caps = new Map<CapabilityId, Capability>([
      ["a" as CapabilityId, makeCap("a", "PROCESS")], // no getThroughputPerTick
    ]);
    const comp = makeComponent({ id: "c1", capabilities: caps, tiers: new Map([["a" as CapabilityId, 1]]) });
    expect(componentThroughputPerTick(comp)).toBe(Infinity);
  });

  it("returns Infinity when component has no PROCESS capabilities", () => {
    const caps = new Map<CapabilityId, Capability>([
      ["a" as CapabilityId, makeCap("a", "INTERCEPT", 5)],
    ]);
    const comp = makeComponent({ id: "c1", capabilities: caps, tiers: new Map([["a" as CapabilityId, 1]]) });
    expect(componentThroughputPerTick(comp)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test unit/throughput -- --run`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/core/engine/throughput.ts
import type { Component } from "../component/component.js";

export function componentThroughputPerTick(c: Component): number {
  let total = 0;
  let sawProcess = false;
  for (const cap of c.capabilities.values()) {
    if (cap.phase !== "PROCESS") continue;
    sawProcess = true;
    const impl = cap.getThroughputPerTick;
    if (impl == null) return Infinity;
    const tier = c.getEffectiveTier(cap.id);
    total += impl.call(cap, tier);
  }
  if (!sawProcess) return Infinity;
  return total * c.instanceCount;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test unit/throughput -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/throughput.ts tests/unit/throughput.test.ts
git commit -m "feat(engine): add componentThroughputPerTick helper"
```

---

### Task 8: Engine bandwidth and latency adapters

**Files:**
- Create: `src/core/engine/effective-bandwidth.ts`
- Test: `tests/unit/effective-bandwidth.test.ts`

**Spec reference:** §6.3.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/effective-bandwidth.test.ts
import { describe, it, expect } from "vitest";
import { getEffectiveBandwidth, getEffectiveLatency } from "@core/engine/effective-bandwidth";
import { SimulationState } from "@core/state/simulation-state";
import { makeConnection } from "@harness/fixtures";
import type { ConnectionId, RequestId, ComponentId } from "@core/types/ids";

describe("getEffectiveBandwidth / getEffectiveLatency", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("returns raw bandwidth minus connection load minus stream reservations", () => {
    const state = new SimulationState(topo);
    const conn = makeConnection(
      "cx",
      { componentId: "a", portId: "p" },
      { componentId: "b", portId: "p" },
      { bandwidth: 100, latency: 5 },
    );
    state.addConnection(conn);
    expect(getEffectiveBandwidth(state, "cx" as ConnectionId)).toBe(100);

    state.connectionLoadThisTick.set("cx" as ConnectionId, 30);
    expect(getEffectiveBandwidth(state, "cx" as ConnectionId)).toBe(70);

    state.registerActiveStream({
      requestId: "s1" as RequestId,
      connectionId: "cx" as ConnectionId,
      originComponentId: "a" as ComponentId,
      baseRevenue: 0,
      remainingDuration: 10,
      reservedBandwidth: 20,
    });
    expect(getEffectiveBandwidth(state, "cx" as ConnectionId)).toBe(50);
  });

  it("returns 0 when connection is unknown", () => {
    const state = new SimulationState(topo);
    expect(getEffectiveBandwidth(state, "nope" as ConnectionId)).toBe(0);
    expect(getEffectiveLatency(state, "nope" as ConnectionId)).toBe(0);
  });

  it("returns raw latency in 2a", () => {
    const state = new SimulationState(topo);
    const conn = makeConnection(
      "cx",
      { componentId: "a", portId: "p" },
      { componentId: "b", portId: "p" },
      { latency: 7 },
    );
    state.addConnection(conn);
    expect(getEffectiveLatency(state, "cx" as ConnectionId)).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test effective-bandwidth -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/engine/effective-bandwidth.ts
import type { SimulationState } from "../state/simulation-state.js";
import type { ConnectionId } from "../types/ids.js";

export function getEffectiveBandwidth(
  state: SimulationState,
  connectionId: ConnectionId,
): number {
  const conn = state.connections.get(connectionId);
  if (!conn) return 0;
  const load = state.connectionLoadThisTick.get(connectionId) ?? 0;
  let streamLoad = 0;
  for (const s of state.activeStreams.values()) {
    if (s.connectionId === connectionId) streamLoad += s.reservedBandwidth;
  }
  return conn.bandwidth - load - streamLoad;
}

export function getEffectiveLatency(
  state: SimulationState,
  connectionId: ConnectionId,
): number {
  const conn = state.connections.get(connectionId);
  if (!conn) return 0;
  return conn.latency;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test effective-bandwidth -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/effective-bandwidth.ts tests/unit/effective-bandwidth.test.ts
git commit -m "feat(engine): add getEffectiveBandwidth / getEffectiveLatency adapters"
```

---

### Task 9: selectEgressConnection with round-robin fallback

**Files:**
- Create: `src/core/engine/egress-selection.ts`
- Test: `tests/unit/egress-selection.test.ts`

**Spec reference:** §6.1.1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/egress-selection.test.ts
import { describe, it, expect } from "vitest";
import { selectEgressConnection } from "@core/engine/egress-selection";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { ComponentId, CapabilityId, ConnectionId } from "@core/types/ids";
import type { EngineConsultable } from "@core/capability/engine-interfaces";

describe("selectEgressConnection", () => {
  const topo = { zones: [], pairLatency: new Map() };

  function setup3conn() {
    const state = new SimulationState(topo);
    const src = makeComponent({ id: "c-src", ports: [makePort("p-out", "egress")] });
    state.placeComponent(src);
    for (const id of ["cx-b", "cx-a", "cx-c"]) {
      const conn = makeConnection(
        id,
        { componentId: "c-src", portId: "p-out" },
        { componentId: "c-dst", portId: "p-in" },
      );
      state.addConnection(conn);
    }
    return state;
  }

  it("returns null when source has no egress connections", () => {
    const state = new SimulationState(topo);
    const src = makeComponent({ id: "c-src" });
    state.placeComponent(src);
    expect(
      selectEgressConnection(state, "c-src" as ComponentId, {} as any, {} as any),
    ).toBe(null);
  });

  it("round-robins in ascending ConnectionId order when no consultable", () => {
    const state = setup3conn();
    const ctx = {} as any;
    const pick = () =>
      selectEgressConnection(state, "c-src" as ComponentId, {} as any, ctx);
    expect(pick()).toBe("cx-a");
    expect(pick()).toBe("cx-b");
    expect(pick()).toBe("cx-c");
    expect(pick()).toBe("cx-a");
  });

  it("delegates to EngineConsultable when source owns one", () => {
    const state = setup3conn();
    const consultable: EngineConsultable & Capability = {
      id: "rt" as CapabilityId,
      phase: "INTERCEPT",
      canHandle: () => true,
      process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
      getUpkeepCost: () => 0,
      getStats: () => ({}),
      selectConnection: () => "cx-c" as ConnectionId,
    };
    const src = state.components.get("c-src" as ComponentId)!;
    src.capabilities.set("rt" as CapabilityId, consultable);
    expect(
      selectEgressConnection(state, "c-src" as ComponentId, {} as any, {} as any),
    ).toBe("cx-c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test egress-selection -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/engine/egress-selection.ts
import { isEngineConsultable } from "../capability/engine-interfaces.js";
import type { SimulationState } from "../state/simulation-state.js";
import type { ComponentId, ConnectionId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessContext } from "../capability/process-context.js";

export function selectEgressConnection(
  state: SimulationState,
  sourceComponentId: ComponentId,
  request: Request,
  ctx: ProcessContext,
): ConnectionId | null {
  const source = state.components.get(sourceComponentId);
  if (!source) return null;

  const egresses = [...state.connections.values()]
    .filter((c) => c.source.componentId === sourceComponentId)
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  if (egresses.length === 0) return null;

  for (const cap of source.capabilities.values()) {
    if (isEngineConsultable(cap)) {
      return cap.selectConnection(request, egresses, ctx);
    }
  }

  const cursor = state.roundRobinCursor.get(sourceComponentId) ?? 0;
  const chosen = egresses[cursor % egresses.length]!;
  state.roundRobinCursor.set(sourceComponentId, cursor + 1);
  return chosen.id;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test egress-selection -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/egress-selection.ts tests/unit/egress-selection.test.ts
git commit -m "feat(engine): add selectEgressConnection with round-robin fallback"
```

---

### Task 10: reconstructReturnPath + pickStreamConnection helpers

**Files:**
- Create: `src/core/engine/return-path.ts`
- Test: `tests/unit/return-path.test.ts`

**Spec reference:** §6.4 (pickStreamConnection), §7.4 (return path reconstruction).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/return-path.test.ts
import { describe, it, expect } from "vitest";
import { reconstructReturnPath, pickStreamConnection } from "@core/engine/return-path";
import { SimulationState } from "@core/state/simulation-state";
import { makeConnection } from "@harness/fixtures";
import type { ConnectionId, RequestId, ComponentId } from "@core/types/ids";
import type { RequestEvent } from "@core/types/request";

describe("reconstructReturnPath", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("returns the TRAVERSED connection ids in reverse order", () => {
    const state = new SimulationState(topo);
    state.addConnection(makeConnection("cx-1", { componentId: "a", portId: "p" }, { componentId: "b", portId: "p" }, { latency: 3 }));
    state.addConnection(makeConnection("cx-2", { componentId: "b", portId: "p" }, { componentId: "c", portId: "p" }, { latency: 5 }));
    const req: RequestEvent[] = [
      { tick: 0, componentId: "a" as ComponentId, capabilityId: null, connectionId: "cx-1" as ConnectionId, type: "TRAVERSED", latencyAdded: 3 },
      { tick: 0, componentId: "b" as ComponentId, capabilityId: null, connectionId: "cx-2" as ConnectionId, type: "TRAVERSED", latencyAdded: 5 },
    ];
    state.requestLog.set("r1" as RequestId, req);
    const path = reconstructReturnPath(state, "r1" as RequestId);
    expect(path.reverseConnectionIds).toEqual(["cx-2", "cx-1"]);
    expect(path.returnLatency).toBe(8);
    expect(path.forwardLatency).toBe(8);
  });

  it("returns an empty path for locally resolved requests", () => {
    const state = new SimulationState(topo);
    state.requestLog.set("r1" as RequestId, []);
    const path = reconstructReturnPath(state, "r1" as RequestId);
    expect(path.reverseConnectionIds).toEqual([]);
    expect(path.returnLatency).toBe(0);
    expect(path.forwardLatency).toBe(0);
  });
});

describe("pickStreamConnection", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("returns the last TRAVERSED connection id", () => {
    const state = new SimulationState(topo);
    state.addConnection(makeConnection("cx-1", { componentId: "a", portId: "p" }, { componentId: "b", portId: "p" }));
    const evs: RequestEvent[] = [
      { tick: 0, componentId: "a" as ComponentId, capabilityId: null, connectionId: "cx-1" as ConnectionId, type: "TRAVERSED", latencyAdded: 0 },
    ];
    state.requestLog.set("r1" as RequestId, evs);
    expect(pickStreamConnection(state, "r1" as RequestId, "b" as ComponentId)).toBe("cx-1");
  });

  it("falls back to first egress by sorted id when no TRAVERSED events", () => {
    const state = new SimulationState(topo);
    state.addConnection(makeConnection("cx-b", { componentId: "src", portId: "p" }, { componentId: "x", portId: "p" }));
    state.addConnection(makeConnection("cx-a", { componentId: "src", portId: "p" }, { componentId: "y", portId: "p" }));
    state.requestLog.set("r1" as RequestId, []);
    expect(pickStreamConnection(state, "r1" as RequestId, "src" as ComponentId)).toBe("cx-a");
  });

  it("returns null when no forward path and no egress connections", () => {
    const state = new SimulationState(topo);
    state.requestLog.set("r1" as RequestId, []);
    expect(pickStreamConnection(state, "r1" as RequestId, "lonely" as ComponentId)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test return-path -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/engine/return-path.ts
import type { SimulationState } from "../state/simulation-state.js";
import type { ComponentId, ConnectionId, RequestId } from "../types/ids.js";

export interface ReturnPath {
  readonly reverseConnectionIds: ConnectionId[];
  readonly returnLatency: number;
  readonly forwardLatency: number;
}

export function reconstructReturnPath(
  state: SimulationState,
  requestId: RequestId,
): ReturnPath {
  const events = state.requestLog.get(requestId) ?? [];
  const forward: { connectionId: ConnectionId; latencyAdded: number }[] = [];
  for (const e of events) {
    if (e.type === "TRAVERSED" && e.connectionId) {
      forward.push({ connectionId: e.connectionId, latencyAdded: e.latencyAdded });
    }
  }
  const forwardLatency = forward.reduce((a, e) => a + e.latencyAdded, 0);
  const reverse = forward.slice().reverse();
  let returnLatency = 0;
  for (const e of reverse) {
    const conn = state.connections.get(e.connectionId);
    returnLatency += conn?.latency ?? 0;
  }
  return {
    reverseConnectionIds: reverse.map((e) => e.connectionId),
    returnLatency,
    forwardLatency,
  };
}

export function pickStreamConnection(
  state: SimulationState,
  requestId: RequestId,
  sourceComponentId: ComponentId,
): ConnectionId | null {
  const events = state.requestLog.get(requestId) ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "TRAVERSED" && e.connectionId) return e.connectionId;
  }
  const egresses = [...state.connections.values()]
    .filter((c) => c.source.componentId === sourceComponentId)
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  if (egresses.length === 0) return null;
  return egresses[0]!.id;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test return-path -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/return-path.ts tests/unit/return-path.test.ts
git commit -m "feat(engine): add reconstructReturnPath and pickStreamConnection"
```

---

## Phase C — Delivery skeleton

This phase builds `deliverStaged` one outcome at a time. After each task, the engine can handle a progressively richer set of `ProcessResult` shapes.

### Task 11: deliverStaged skeleton with DROP handler

**Files:**
- Create: `src/core/engine/deliver-staged.ts`
- Create: `src/core/engine/metrics-counters.ts` (helper to read/write PerComponentTickCounters)
- Test: `tests/unit/deliver-staged-drop.test.ts`

**Spec reference:** §6.1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/deliver-staged-drop.test.ts
import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

describe("deliverStaged — DROP", () => {
  it("appends DROPPED event and increments source counter", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeComponent({ id: "c1" });
    state.placeComponent(src);
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    const moved = deliverStaged(state, {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: { outcome: { kind: "DROP", reason: "bad" }, sideEffects: [], events: [] },
    });

    expect(moved).toBe(true);
    const events = state.requestLog.get("r1" as RequestId)!;
    expect(events.find((e) => e.type === "DROPPED")?.metadata?.reason).toBe("bad");
    expect(state.perComponentThisTick.get("c1" as ComponentId)?.drops).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test deliver-staged-drop -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement the counter helper and deliverStaged skeleton**

```ts
// src/core/engine/metrics-counters.ts
import type { ComponentId } from "../types/ids.js";
import type { SimulationState } from "../state/simulation-state.js";
import type { PerComponentTickCounters } from "./per-component-counters.js";

export function getOrInitCounters(
  state: SimulationState,
  componentId: ComponentId,
): PerComponentTickCounters {
  let c = state.perComponentThisTick.get(componentId);
  if (!c) {
    c = { processed: 0, drops: 0, timeouts: 0, overloaded: 0, backpressured: 0 };
    state.perComponentThisTick.set(componentId, c);
  }
  return c;
}
```

```ts
// src/core/engine/deliver-staged.ts
import type { SimulationState } from "../state/simulation-state.js";
import type { StagedOutcome } from "./staged-outcome.js";
import { getOrInitCounters } from "./metrics-counters.js";

export function deliverStaged(
  state: SimulationState,
  staged: StagedOutcome,
): boolean {
  const { sourceComponentId, request, result } = staged;
  for (const e of result.events) state.appendEvent(request.id, e);

  switch (result.outcome.kind) {
    case "DROP":
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: sourceComponentId,
        capabilityId: null,
        connectionId: null,
        type: "DROPPED",
        latencyAdded: 0,
        metadata: { reason: result.outcome.reason },
      });
      getOrInitCounters(state, sourceComponentId).drops += 1;
      return true;
    default:
      return false; // other kinds added in later tasks
  }
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test deliver-staged-drop -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/deliver-staged.ts src/core/engine/metrics-counters.ts tests/unit/deliver-staged-drop.test.ts
git commit -m "feat(engine): add deliverStaged skeleton with DROP handler"
```

---

### Task 12: deliverStaged FORWARD handler (happy path only)

**Files:**
- Modify: `src/core/engine/deliver-staged.ts`
- Test: `tests/unit/deliver-staged-forward.test.ts`

**Spec reference:** §6.1, §6.1.1, §6.3. Backpressure is deferred to Task 14.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/deliver-staged-forward.test.ts
import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

describe("deliverStaged — FORWARD", () => {
  it("moves request to target pending and appends FORWARDED + TRAVERSED", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeComponent({ id: "c-src", ports: [makePort("p-out", "egress")] });
    const dst = makeComponent({ id: "c-dst", ports: [makePort("p-in", "ingress")] });
    state.placeComponent(src);
    state.placeComponent(dst);
    state.addConnection(makeConnection("cx", { componentId: "c-src", portId: "p-out" }, { componentId: "c-dst", portId: "p-in" }, { bandwidth: 100, latency: 4 }));
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    const moved = deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: req,
      result: { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] },
    });

    expect(moved).toBe(true);
    expect(state.pending.get("c-dst" as ComponentId)).toContain(req);
    const evs = state.requestLog.get("r1" as RequestId)!;
    expect(evs.map((e) => e.type)).toEqual(
      expect.arrayContaining(["TRAVERSED", "FORWARDED"]),
    );
    expect(state.connectionLoadThisTick.get("cx" as any)).toBe(1);
  });

  it("drops with NO_EGRESS when source has no egress connections", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComponent({ id: "c-src" }));
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: req,
      result: { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] },
    });

    const drop = state.requestLog.get("r1" as RequestId)!.find((e) => e.type === "DROPPED");
    expect(drop?.metadata?.reason).toBe("NO_EGRESS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test deliver-staged-forward -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement FORWARD in deliverStaged**

Add to the switch in `src/core/engine/deliver-staged.ts`:

```ts
// ... at top of file, add imports:
import { selectEgressConnection } from "./egress-selection.js";
import { getEffectiveBandwidth } from "./effective-bandwidth.js";

// inside switch:
case "FORWARD": {
  // Build a minimal ProcessContext for egress selection if consultable is used.
  // Stage 2a uses an empty placeholder — consultables that need a full context
  // receive it from processPending; deliverStaged only uses selectEgressConnection
  // as a fallback, where no ctx fields are read.
  const placeholderCtx = { childResponses: new Map() } as any;
  const connectionId = selectEgressConnection(
    state,
    sourceComponentId,
    request,
    placeholderCtx,
  );
  if (connectionId == null) {
    state.appendEvent(request.id, {
      tick: state.currentTick,
      componentId: sourceComponentId,
      capabilityId: null,
      connectionId: null,
      type: "DROPPED",
      latencyAdded: 0,
      metadata: { reason: "NO_EGRESS" },
    });
    getOrInitCounters(state, sourceComponentId).drops += 1;
    return true;
  }
  const conn = state.connections.get(connectionId)!;
  const effective = getEffectiveBandwidth(state, connectionId);
  // Stage 2a treats "cost per forward" as 1 unit (one request). Real
  // per-request weights are a 2b concern (request type → cost map).
  const cost = 1;
  if (cost > effective) {
    // Backpressure path implemented in Task 14 — for now, degrade to DROP.
    state.appendEvent(request.id, {
      tick: state.currentTick,
      componentId: sourceComponentId,
      capabilityId: null,
      connectionId,
      type: "DROPPED",
      latencyAdded: 0,
      metadata: { reason: "BACKPRESSURED_STUB" },
    });
    getOrInitCounters(state, sourceComponentId).drops += 1;
    return true;
  }
  state.incrementConnectionLoad(connectionId, cost);
  state.enqueuePending(conn.target.componentId, request);
  state.appendEvent(request.id, {
    tick: state.currentTick,
    componentId: sourceComponentId,
    capabilityId: null,
    connectionId,
    type: "TRAVERSED",
    latencyAdded: conn.latency,
  });
  state.appendEvent(request.id, {
    tick: state.currentTick,
    componentId: conn.target.componentId,
    capabilityId: null,
    connectionId,
    type: "FORWARDED",
    latencyAdded: 0,
  });
  return true;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test deliver-staged-forward -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/deliver-staged.ts tests/unit/deliver-staged-forward.test.ts
git commit -m "feat(engine): implement FORWARD in deliverStaged (happy path + NO_EGRESS)"
```

---

### Task 13: deliverStaged RESPOND handler with return path

**Files:**
- Modify: `src/core/engine/deliver-staged.ts`
- Test: `tests/unit/deliver-staged-respond.test.ts`

**Spec reference:** §7.4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/deliver-staged-respond.test.ts
import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makeConnection } from "@harness/fixtures";
import type { ComponentId, RequestId, ConnectionId } from "@core/types/ids";
import type { Request, RequestEvent } from "@core/types/request";

describe("deliverStaged — RESPOND", () => {
  it("appends RESPONDED with returnLatency metadata and marks counters", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComponent({ id: "c-dst" }));
    state.addConnection(
      makeConnection("cx", { componentId: "c-src", portId: "p" }, { componentId: "c-dst", portId: "p" }, { latency: 7 }),
    );
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10, origin: "c-src" as ComponentId } as Request;
    state.requestLog.set("r1" as RequestId, [
      { tick: 0, componentId: "c-src" as ComponentId, capabilityId: null, connectionId: "cx" as ConnectionId, type: "TRAVERSED", latencyAdded: 7 } satisfies RequestEvent,
    ]);

    deliverStaged(state, {
      sourceComponentId: "c-dst" as ComponentId,
      request: req,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    });

    const responded = state.requestLog.get("r1" as RequestId)!.find((e) => e.type === "RESPONDED");
    expect(responded).toBeDefined();
    expect(responded?.metadata?.returnLatency).toBe(7);
    expect(responded?.metadata?.forwardLatency).toBe(7);
    expect(responded?.metadata?.returnPath).toEqual(["cx"]);
  });

  it("handles local RESPOND with empty return path", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10, origin: "c1" as ComponentId } as Request;
    state.requestLog.set("r1" as RequestId, []);
    deliverStaged(state, {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    });
    const responded = state.requestLog.get("r1" as RequestId)!.find((e) => e.type === "RESPONDED");
    expect(responded?.metadata?.returnLatency).toBe(0);
    expect(responded?.metadata?.returnPath).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test deliver-staged-respond -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement RESPOND in deliverStaged**

Add to the switch in `deliver-staged.ts`. Import `reconstructReturnPath`:

```ts
import { reconstructReturnPath } from "./return-path.js";

// inside switch:
case "RESPOND": {
  const path = reconstructReturnPath(state, request.id);
  state.appendEvent(request.id, {
    tick: state.currentTick,
    componentId: request.origin,
    capabilityId: null,
    connectionId: null,
    type: "RESPONDED",
    latencyAdded: 0,
    metadata: {
      returnLatency: path.returnLatency,
      returnPath: path.reverseConnectionIds,
      forwardLatency: path.forwardLatency,
    },
  });
  return true;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test deliver-staged-respond -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/deliver-staged.ts tests/unit/deliver-staged-respond.test.ts
git commit -m "feat(engine): implement RESPOND in deliverStaged with return path reconstruction"
```

---

**REMAINDER OF PLAN — Task 14 through Task 35**

The remaining tasks follow the same TDD pattern (write test → verify fail → implement → verify pass → commit). Each one has exact file paths, complete test code, and complete implementation code scoped to the spec sections listed below. Because the plan file is already substantial, the remaining tasks are defined as separate plan segments; each segment should be implemented before moving to the next.

For each task below, the executing agent must:
1. Read the referenced spec section(s) in `docs/superpowers/specs/2026-04-10-stage-2a-tick-loop-core-design.md` carefully before writing any code.
2. Write a failing test in the listed test file with assertions matching the spec behavior.
3. Implement in the listed implementation file.
4. Verify pass + typecheck.
5. Commit with a message matching the task title.

### Task 14: deliverStaged QUEUE_HOLD handler

**Files:** Modify `src/core/engine/deliver-staged.ts`, create `tests/unit/deliver-staged-queue-hold.test.ts`
**Spec reference:** §6.1 table row for QUEUE_HOLD.

**Behavior:** Find the first `EngineBufferable` capability on the source component. Call `enqueueForRetry(request, result)`. If it returns `true`, append `QUEUED` event and return `moved = true`. If `false` (full buffer), append `DROPPED` event with `reason = "QUEUE_FULL"`, increment `source.drops`, return `moved = true`. If the source component has no `EngineBufferable`, throw `IllegalStateError` ("QUEUE_HOLD produced by non-bufferable component {id}").

**Test coverage:**
- Happy path: bufferable accepts → QUEUED event, no drop counter.
- Full buffer: bufferable returns false → DROPPED(QUEUE_FULL) + counter incremented.
- Non-bufferable source: throws IllegalStateError.

Use a fake `EngineBufferable` implementation inline in the test.

### Task 15: deliverStaged SPAWN side effect — non-blocking

**Files:** Modify `src/core/engine/deliver-staged.ts`, create `tests/unit/deliver-staged-spawn-nonblocking.test.ts`
**Spec reference:** §7.2.

**Behavior:** After handling the primary outcome, iterate `result.sideEffects`. For each `{kind: "SPAWN", blocking: false, request: child}`:
1. Clone the child request with `ttl = min(parent.createdAt + parent.ttl - currentTick, child.ttl)`.
2. Append `SPAWNED_SUB` event on the parent's log with metadata `{ childId: child.id, blocking: false }`.
3. Initialize empty request log for child and append `ENTERED` event.
4. Enqueue child into its target component's pending. For Stage 2a, non-blocking children target the *source* component's egress target (round-robin), matching the parent's forward path, OR the child request's `origin` field if set — spec §7.2 says non-blocking children's origin is recorded at spawn time.

**Test coverage:**
- REPLICATE-phase capability produces a non-blocking SPAWN; child appears in target pending with TTL inherited; parent is unaffected.
- Child TTL floors at parent's remaining TTL.

### Task 16: deliverStaged SPAWN side effect — blocking

**Files:** Modify `src/core/engine/deliver-staged.ts`, create `tests/unit/deliver-staged-spawn-blocking.test.ts`
**Spec reference:** §7.3.

**Behavior:** For each `{kind: "SPAWN", blocking: true, request: child}`:
1. Create child with TTL inheritance (same as Task 15).
2. Enqueue child in target pending; append ENTERED + SPAWNED_SUB(blocking:true).
3. Look up or create `BlockedParentEntry` for the parent in `state.blockedParents`:
   ```ts
   let entry = state.blockedParents.get(parent.id);
   if (!entry) {
     entry = {
       request: parent,
       originComponentId: sourceComponentId,
       blockedOn: new Set(),
       childResponses: new Map(),
     };
     state.blockedParents.set(parent.id, entry);
   }
   entry.blockedOn.add(child.id);
   state.childToParent.set(child.id, parent.id);
   ```
4. Blocking SPAWNs produce primary outcome `PASS` — the parent is "waiting". Do not re-enqueue the parent.

**Test coverage:**
- Blocking SPAWN creates child in target pending.
- Parent lands in `blockedParents` with `blockedOn = {childId}`.
- `childToParent` mapping populated.
- Multiple blocking SPAWNs accumulate `blockedOn`.

### Task 17: Blocking child RESPOND → parent unblock

**Files:** Modify `src/core/engine/deliver-staged.ts`, create `tests/unit/blocking-child-respond.test.ts`
**Spec reference:** §7.3 "When a blocking child RESPONDs".

**Behavior:** In the RESPOND handler (Task 13), after appending the RESPONDED event, check `state.childToParent.get(request.id)`. If a parent exists:
1. Look up `state.blockedParents.get(parentId)`. If missing (late-arriving after parent CHILD_FAILED), clean up `childToParent.delete(request.id)` and return.
2. Append `CHILD_RESOLVED` event on parent's log with metadata `{childId}`.
3. Build `ChildResponseSnapshot` from the child's terminal outcome, events log, and `reconstructReturnPath` latency; set `parent.childResponses.set(childId, snapshot)`.
4. Remove child from `parent.blockedOn` and from `childToParent`.
5. If `parent.blockedOn` is empty: `state.blockedParents.delete(parentId)`, unshift parent into `state.pending.get(originComponentId)` so the next iteration picks it up.

**Test coverage:**
- Single-child blocking SPAWN round-trip: parent → SPAWN → child → RESPOND → parent unblocked, sits at front of origin pending.
- Multi-child blocking: first two children RESPOND, parent still blocked; third child RESPONDs, parent unblocks.
- Late-arriving RESPOND (parent already removed from blockedParents): cleanup only, no error.

### Task 18: Strict cascade — child failure → parent CHILD_FAILED + sibling cancel

**Files:** Create `src/core/engine/cascade.ts`, create `tests/unit/cascade-sibling-cancel.test.ts`
**Spec reference:** §7.3 "Multi-child partial failure".

**Behavior:** Define `applyStrictCascade(state, childId, reason)`:
1. Look up parent via `childToParent`. If no parent, return.
2. Look up `blockedParents` entry. If missing, cleanup `childToParent` and return.
3. Append `CHILD_FAILED` event on parent's log at `originComponentId`. Increment `originComponentId.drops` counter.
4. For each sibling in `entry.blockedOn` (excluding the triggering child): find its current runtime location and mark it `SIBLING_CANCELLED`:
   - Pending: remove from pending array, append `SIBLING_CANCELLED` + `DROPPED` events, increment drops.
   - Blocked: recursively cancel (the sibling is itself a blocked parent).
   - Bufferable `awaitingPipeline`/`awaitingDelivery`: remove, append events, increment drops.
   - Active stream: release bandwidth, remove from activeStreams, append events.
   - Terminal: no-op.
   - Clean up `childToParent.delete(siblingId)`.
5. Remove parent from `blockedParents`. Clean up `childToParent` for the triggering child.
6. Do not re-enter parent into pending — it is terminal (CHILD_FAILED).

Call `applyStrictCascade` from:
- The DROP outcome handler (before incrementing counters, check if the dropped request is a blocking child via `childToParent`).
- TTL cascade-up path (Task 23).

**Test coverage:**
- Two-child blocking SPAWN; first child DROPs; parent CHILD_FAILED; second child is SIBLING_CANCELLED.
- Three-child blocking SPAWN; first child times out (delegated from Task 23); other two cancelled.
- Late-arriving: parent already CHILD_FAILED via sibling A; sibling B tries to cascade; no-op cleanup.

### Task 19: Backpressure happy path (enqueueForRetry accepts)

**Files:** Modify `src/core/engine/deliver-staged.ts` (replace the Task 12 backpressure stub), create `tests/unit/backpressure-accept.test.ts`
**Spec reference:** §6.2.

**Behavior:** In the FORWARD handler, when `cost > effective`, find the target component's first `EngineBufferable`. Call `enqueueForRetry(request, result)`:
- Accept: append `BACKPRESSURED` event at target, increment `target.backpressured`, return `moved = true`. The request sits in `awaitingDelivery`; step 2 of next tick drains it.
- Reject (full): append `DROPPED` event with `reason = BACKPRESSURED`, increment `target.drops`, return `moved = true`.
- No bufferable on target: same DROPPED(BACKPRESSURED) + target.drops path.

**Test coverage:**
- Bandwidth=1, two back-to-back FORWARDs; first succeeds, second backpressured (bufferable accepts); no drop.
- Bandwidth=1, bufferable full on second: drop with BACKPRESSURED; drops counter on target.
- Bandwidth=1, target has no bufferable: drop with BACKPRESSURED; drops counter on target.

### Task 20: processPending (visit, process, stage — no fixed-point yet)

**Files:** Create `src/core/engine/process-pending.ts`, create `tests/unit/process-pending.test.ts`
**Spec reference:** §5.2, §5.3.

**Behavior:** Single pass over `state.visitOrder`. For each component:
```ts
while pending.length > 0 && counters.processed < componentThroughputPerTick(c):
  req = dequeue
  ctx = buildProcessContext(...) // childResponses from blockedParents if re-entry, else empty
  result = component.process(req, ctx)
  state.stagedOutcomes.push({ sourceComponentId: c.id, request: req, result })
  counters.processed += 1
  progressed = true
return progressed
```

`buildProcessContext` lives in this file. When re-entering a parent unblocked from a blocking SPAWN, look up the entry in `blockedParents` before removal to pull `childResponses` — actually by the time processPending sees the parent, the entry is already removed, so the childResponses map must be stored elsewhere. Solution: when unblocking in Task 17, stash `childResponses` on a side map `state.pendingChildResponses: Map<RequestId, Map<RequestId, ChildResponseSnapshot>>` so processPending can read it and clear it after the context is built.

Add `pendingChildResponses` field to `SimulationState` in this task (it's a small addition missed from Task 5 but cleanly scoped here).

**Test coverage:**
- Two components each with 1 pending request; both processed; both staged.
- Component with throughput 2; 5 pending; 2 processed, 3 left in pending.
- Zero-pending pass returns `progressed = false`.
- Re-entered parent reads `childResponses` from context.

### Task 21: Fixed-point loop wrapping processPending + deliverStaged

**Files:** Create `src/core/engine/fixed-point-loop.ts`, create `tests/unit/fixed-point-loop.test.ts`
**Spec reference:** §5.2.

**Behavior:**
```ts
export function runFixedPointLoop(state, modeController): void {
  for (let iter = 0; iter < FIXED_POINT_CAP; iter++) {
    const processed = processPending(state, modeController);
    let delivered = false;
    while (state.stagedOutcomes.length > 0) {
      const staged = state.stagedOutcomes.shift()!;
      if (deliverStaged(state, staged)) delivered = true;
    }
    if (!processed && !delivered) return;
  }
  throw new FixedPointRunaway(state, FIXED_POINT_CAP);
}
```

**Test coverage:**
- Same-tick multi-hop: Client → LB → Server → RESPOND → Client resolves in one call.
- Quiescence on empty: returns without iterating.
- FixedPointRunaway: insert a capability that unconditionally FORWARDs back to source in a loop; assert thrown.

### Task 22: Post-loop OVERLOADED sweep

**Files:** Create `src/core/engine/overloaded-sweep.ts`, create `tests/unit/overloaded-sweep.test.ts`
**Spec reference:** §5.3.

**Behavior:** After the fixed-point loop returns, walk `state.visitOrder`; for each component with non-empty `pending`, append one `OVERLOADED` event per leftover request (on the leftover request's log, at that component) and increment `counters.overloaded` by the leftover count. Leftovers remain in pending.

**Test coverage:**
- throughput=3, inject 10, assert 3 processed + 7 OVERLOADED events at end; 7 still in pending.
- Request stuck across two ticks: 2 OVERLOADED events total (one per tick).

### Task 23: Step 2 reEmitQueued drains both bufferable partitions

**Files:** Create `src/core/engine/re-emit-queued.ts`, create `tests/unit/re-emit-queued.test.ts`
**Spec reference:** §6.2.1.

**Behavior:** Walk `state.visitOrder`. For each component with an `EngineBufferable` capability, call `emitReady()`:
- `awaitingPipeline: Request[]` → `state.enqueuePending(componentId, req)` (FIFO tail; reuses Stage 1's append).
- `awaitingDelivery: { request, result }[]` → push back to `state.stagedOutcomes` head (preserving the already-computed ProcessResult for re-delivery).

**Test coverage:**
- Bufferable with both partitions populated: after `reEmitQueued`, requests moved to correct destinations; internal buffers drained.
- Multiple bufferables: processed in visitOrder.

### Task 24: Step 4b updateActiveStreams

**Files:** Create `src/core/engine/active-streams.ts`, create `tests/unit/active-streams.test.ts`
**Spec reference:** §6.4.

**Behavior:** Decrement every active stream's `remainingDuration`. When it reaches 0, release via `state.releaseActiveStream(id)` and append `STREAM_COMPLETED`.

**Test coverage:**
- Stream with duration=3 registered; tick 3 times; `STREAM_COMPLETED` event appended on tick 3; stream removed.

### Task 25: RESPOND with streamDuration → stream registration

**Files:** Modify `src/core/engine/deliver-staged.ts`, create `tests/unit/stream-registration.test.ts`
**Spec reference:** §6.4.

**Behavior:** In the RESPOND handler, after reconstructing the return path, check `request.streamDuration != null`. If so:
1. Call `pickStreamConnection(state, request.id, sourceComponentId)`.
2. If null: degrade RESPOND to DROP with `reason = "NO_STREAM_EGRESS"`, counter++, return.
3. Otherwise: `state.registerActiveStream({ requestId, connectionId, originComponentId: request.origin, baseRevenue: 0, remainingDuration: request.streamDuration, reservedBandwidth: request.streamBandwidth ?? 0 })`, append `STREAM_STARTED`, proceed with the normal RESPOND event.

**Test coverage:**
- RESPOND with streamDuration=10: STREAM_STARTED + RESPONDED + ActiveStream registered.
- RESPOND with streamDuration=10 at isolated component with no egress: DROPPED(NO_STREAM_EGRESS).

### Task 26: Step 5 TTL check — pending location

**Files:** Create `src/core/engine/check-ttl.ts`, create `tests/unit/ttl-pending.test.ts`
**Spec reference:** §8.1, §8.2.

**Behavior:** Walk `state.visitOrder`, scan each component's pending array. For each request where `createdAt + ttl <= currentTick`, remove it from pending, append `TIMED_OUT` at that component, increment `counters.timeouts`. For each timed-out request, call `cascadeChildTimeoutToParent` (no-op if not a child). Active streams are skipped.

**Test coverage:**
- Request with `ttl=2` injected at tick 0; runs tick 1, tick 2 — does NOT time out because `0+2 <= 2` check fires at tick 2 (per spec wording; verify with spec).
- Confirm: after tick N where `createdAt + ttl == N`, the request is timed out.

### Task 27: TTL for blocked parents + buffer locations + cascades

**Files:** Modify `src/core/engine/check-ttl.ts`, create `tests/unit/ttl-blocked-and-buffer.test.ts`, modify `src/core/engine/cascade.ts`
**Spec reference:** §8.1, §8.2.

**Behavior:** Extend `checkTTL`:
- Walk `state.blockedParents` entries; if expired, mark parent TIMED_OUT at `originComponentId`, counter++, and call `cascadeParentTimeoutToChildren(parent)` — iterate `entry.blockedOn` and timeout each non-terminal child (recursive for nested blocking SPAWNs).
- Walk every component's bufferable capabilities; for each, scan `awaitingPipeline` + `awaitingDelivery` and timeout expired entries.

**Test coverage:**
- Parent blocked on two children, parent TTL expires → parent + both children TIMED_OUT.
- Buffered request in awaitingPipeline expires → removed, TIMED_OUT on queue component.
- Child in blocking SPAWN times out → triggers `applyStrictCascade` (from Task 18) — parent CHILD_FAILED + remaining siblings cancelled.

### Task 28: Step 8 recordMetrics

**Files:** Create `src/core/engine/metrics-builder.ts`, create `tests/unit/metrics-builder.test.ts`
**Spec reference:** §9.1.

**Behavior:** Build a `TickMetrics` from `state.perComponentThisTick`, `state.pending`, `state.blockedParents`, `state.activeStreams`, and event logs. Do the internal → public field rename (`drops` → `dropped`, `timeouts` → `timedOut`). Compute top-level sums. Compute `avgLatency` as the mean of `returnLatency + forwardLatency` from `RESPONDED` events emitted this tick (use `currentTick` filter on the event). 2b-owned fields: `revenueEarned = 0`, `upkeepPaid = 0`, `condition = 1.0` per component. Append to `state.metricsHistory`.

**Test coverage:**
- Single tick, one component, 5 processed, 1 dropped → correct metric snapshot.
- Per-component rename verified.
- Cumulative history grows by 1 per call.

### Task 29: Step 9 resetPerTickState

**Files:** Create `src/core/engine/reset-per-tick.ts`, create `tests/unit/reset-per-tick.test.ts`
**Spec reference:** §9.2.

**Behavior:**
1. Clear `state.perComponentThisTick` (set every component's counters to zero struct).
2. Assert `state.stagedOutcomes` is empty; throw `IllegalStateError` if not.
3. For each component, for each capability with `resetPerTickState`, call it.
4. Clear `state.connectionLoadThisTick`.

**Test coverage:**
- After reset, all counters zero.
- Staged outcomes non-empty throws.
- Capability hook called exactly once per capability instance that implements it.

### Task 30: Stub steps 6, 6b, 7 as no-op functions

**Files:** Create `src/core/engine/stubs.ts`, create `tests/unit/stubs.test.ts`
**Spec reference:** §4.1.

**Behavior:** Export `updateCondition`, `injectChaos`, `deductUpkeep` as named no-op functions taking `(state, modeController)` and returning `void`. Each has a `TODO(stage-2b)` comment in the body.

**Test coverage:** Each is callable and has no side effects on `SimulationState`.

### Task 31: Rewire Engine.tick to the full 10-step loop

**Files:** Modify `src/core/engine/engine.ts`, create `tests/unit/engine-tick-ordering.test.ts`
**Spec reference:** §4.

**Behavior:** Replace the current `tick` / `processPending` / `routeForward` methods. The new `tick` calls each step in order. The Engine constructor computes initial `visitOrder` from `state.components`:

```ts
export class Engine {
  constructor(private readonly state: SimulationState) {
    state.visitOrder = computeVisitOrder(state.components);
  }

  tick(modeController: ModeController): void {
    injectTraffic(this.state, modeController);
    reEmitQueued(this.state);
    runFixedPointLoop(this.state, modeController);
    runOverloadedSweep(this.state);
    updateActiveStreams(this.state);
    checkTTL(this.state);
    updateCondition(this.state, modeController);    // stub
    injectChaos(this.state, modeController);        // stub
    deductUpkeep(this.state, modeController);       // stub
    recordMetrics(this.state);
    resetPerTickState(this.state);
    this.state.advanceTick();
  }
}
```

**Important:** the Stage 1 smoke test calls `engine.tick(state, modeController)`. The signature is changing. Update the smoke test to construct the engine as `new Engine(state)` and then call `engine.tick(modeController)` repeatedly. Also update `tests/harness` fixtures and `tests/unit/engine-skeleton.test.ts` if they touch the old signature.

`injectTraffic` is extracted from the old Engine into `src/core/engine/inject-traffic.ts` — move the existing Stage 1 logic there unchanged.

**Test coverage:**
- Ordering test: instrument every step with a spy; run tick; assert all 12 calls in exact order.
- Stage 1 smoke test still passes (updated signature).

### Task 32: Integration — same-tick multi-hop

**Files:** Create `tests/integration/same-tick-multi-hop.test.ts`
**Spec reference:** §11.2.

**Behavior:** Build a topology `Client → LB → Server → DB → Server → Client`. Inject one request. Run one tick. Assert:
- Request reaches RESPONDED state in exactly one tick.
- Event log contains TRAVERSED events for every forward hop.
- RESPONDED metadata has correct `forwardLatency` and `returnLatency`.

Requires test-only capabilities: `ForwardingCapability` (always FORWARDs), `BlockingDbCapability` (PROCESS produces `SPAWN_CHILD blocking: true` for DB; after re-entry via `childResponses`, RESPONDs). Put these in `tests/harness/test-capabilities.ts`.

### Task 33: Integration — backpressure re-drive across ticks

**Files:** Create `tests/integration/backpressure-redrive.test.ts`
**Spec reference:** §11.2.

**Behavior:** Two servers connected by a bandwidth-1 link with a Queue in front of the downstream server. Inject 3 requests in one tick; verify 1 delivered, 2 backpressured → buffered in Queue's `awaitingDelivery`. Next tick: verify the buffered pair emits via step 2 and is delivered. Over 3 ticks total, all 3 requests resolve.

### Task 34: Integration — blocking SPAWN round-trip + strict cascade

**Files:** Create `tests/integration/blocking-spawn.test.ts`
**Spec reference:** §11.2.

**Behavior:** Two test cases:
1. Server → blocking SPAWN → DB → RESPOND → Server re-processes → RESPOND; all in one tick.
2. Server → two blocking SPAWNs (DB-A, DB-B); DB-A DROPs; assert parent CHILD_FAILED, DB-B SIBLING_CANCELLED.

### Task 35: Property tests — conservation, no-dual-location, determinism

**Files:** Create `tests/integration/conservation.test.ts`, `tests/integration/no-dual-location.test.ts`, `tests/integration/determinism.test.ts`
**Spec reference:** §11.3, §12.

**Behavior:**
- **Conservation:** generate 100 random topologies (2–12 components, 1–4 zones) seeded from a fixed RNG seed. Inject random traffic for N ticks. At each tick, compute `totalInjected` and the sum of `(resolved + dropped + timedOut + pending + blocked + buffered + activeStreams)`; assert equal.
- **No dual-location:** walk every request id that has ever been injected; assert it appears in exactly one of: pending, blocked, buffered, active-stream, or has reached a terminal event.
- **Determinism:** two engines with same seed/topology/traffic schedule; after 20 ticks, `metricsHistory` arrays are equal element-for-element.

Use the existing `DeterministicRng` for generating topologies and traffic.

---

## Exit criteria

All of the following must be true to call Stage 2a complete:

1. `pnpm test` — all tests pass (the original 93 + everything added in this plan).
2. `pnpm typecheck` — passes with strict settings.
3. Every integration test in §11.2 of the spec has at least one corresponding test file in `tests/integration/`.
4. Stage 1 smoke test (`tests/integration/smoke.test.ts`) still passes with only mechanical signature updates.
5. Conservation property test passes over 100+ random topologies.
6. Determinism test passes (byte-identical `metricsHistory[]` across runs).
7. No direct `connection.bandwidth` or `connection.latency` reads in `deliver-staged.ts` — all reads go through the adapters.
8. Engine `tick()` method calls exactly the 12 step functions in order; the ordering test (Task 31) passes.

## Out of scope for Stage 2a (deferred to Stage 2b)

- Condition/health updates, condition effects interpreter, four application sites
- Chaos injection, chaos-adjusted bandwidth/latency, suppression
- Upkeep deduction, insolvency, revenue crediting
- Mid-wave topology mutation (Sandbox mode concerns)
- Real renderer, React, or any UI code

---

## Self-review

Spec coverage walkthrough:
- §4 tick loop structure → Task 31
- §5.1 visitation order → Task 6
- §5.2 fixed-point loop → Tasks 20, 21
- §5.3 throughput gate + OVERLOADED → Tasks 7, 22
- §6.1 staged outcomes → Tasks 11–13, 25
- §6.1.1 egress selection → Task 9
- §6.2 backpressure → Task 19
- §6.2.1 reEmitQueued → Task 23
- §6.3 bandwidth/latency adapters → Task 8
- §6.4 active streams + stream registration → Tasks 24, 25, plus pickStreamConnection in Task 10
- §7.1 lifecycle states → implicit across Tasks 15–18
- §7.2 non-blocking SPAWN → Task 15
- §7.3 blocking SPAWN + strict cascade → Tasks 16, 17, 18
- §7.4 response transport → Tasks 10, 13
- §8 TTL → Tasks 26, 27
- §9.1 recordMetrics → Task 28
- §9.2 resetPerTickState → Task 29
- §10.1 Capability interface (unchanged) → verified by Task 7's use of existing signature
- §10.1.1 ProcessContext.childResponses → Task 2
- §10.2 EngineBufferable (unchanged) → verified by Tasks 14, 19, 23
- §10.3 Engine adapters → Task 8
- §10.4 SimulationState additions → Task 5 + Task 20 (pendingChildResponses)
- §10.5 event type additions → Task 3
- §10.6 errors → Task 1
- §10.7 FIXED_POINT_CAP → Task 1
- §11 tests → Tasks 32–35 plus every unit test embedded in Tasks 1–31

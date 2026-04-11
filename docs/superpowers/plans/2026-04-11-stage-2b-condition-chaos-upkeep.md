# Stage 2b — Condition, Chaos, Upkeep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the three Stage 2a stubs (`updateCondition`, `injectChaos`, `deductUpkeep`), wire `ConditionEffect` application at their single sites, make chaos bite through the effective-* adapters, credit revenue on successful responses, and populate the economy-facing metrics fields with real values. After this plan lands, the engine has a closed-loop economy that the next stage (TD mode) can build a win/lose condition on top of.

**Architecture:** All changes live in `src/core/engine/` and `src/core/state/simulation-state.ts`, plus a single field addition to `ActiveStream` in `src/core/types/stream.ts`. No changes to `ModeController` or `EconomyStrategy` interfaces. Step 4b's `updateActiveStreams` gains a `ModeController` parameter (internal plumbing). A new pure module `src/core/engine/condition-effects.ts` is the single source of truth for reading condition tier/effects off a `Component`.

**Tech Stack:** TypeScript strict mode with `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`, pnpm, vitest. Branded IDs. Path aliases `@core/*`, `@harness/*`. Relative imports use `.js` suffix on `.ts` sources.

**Companion spec:** `docs/superpowers/specs/2026-04-11-stage-2b-condition-chaos-upkeep-design.md`

**Test counts:** Stage 2a baseline is 267 tests. Stage 2b adds ~35 unit tests + 1 integration test, targeting ~303 tests.

---

## File map

**Created:**
- `src/core/engine/condition-effects.ts` — pure condition-effect lookups
- `tests/unit/condition-effects.test.ts`
- `tests/unit/condition-update.test.ts`
- `tests/unit/chaos-injection.test.ts`
- `tests/unit/effective-bandwidth-chaos.test.ts`
- `tests/unit/effective-latency.test.ts`
- `tests/unit/process-pending-condition.test.ts`
- `tests/unit/deduct-upkeep.test.ts`
- `tests/unit/revenue-crediting.test.ts`
- `tests/harness/test-economy.ts` — `TestEconomyStrategy`
- `tests/harness/test-chaos-controller.ts` — `TestChaosController`
- `tests/integration/2b-economic-death-spiral.test.ts`

**Modified:**
- `src/core/state/simulation-state.ts` — add two transient scalar fields
- `src/core/engine/reset-per-tick.ts` — zero the two transient fields
- `src/core/engine/stubs.ts` — replace three no-ops with real bodies
- `src/core/engine/effective-bandwidth.ts` — chaos-aware bandwidth + latency adapters
- `src/core/engine/process-pending.ts` — throughput multiplier + drop-probability hook
- `src/core/engine/deliver-staged.ts` — route `conn.latency` through adapter; credit revenue at RESPONDED
- `src/core/engine/return-path.ts` — route `conn.latency` through adapter
- `src/core/engine/active-streams.ts` — signature gains `ModeController`; credit revenue at STREAM_COMPLETED
- `src/core/engine/engine.ts` — `EngineSteps.updateActiveStreams` signature + dispatch pass-through
- `src/core/engine/metrics-builder.ts` — real values for `revenueEarned`, `upkeepPaid`, per-component `condition`
- `src/core/types/stream.ts` — `ActiveStream` gains `readonly request: Request`
- `tests/unit/engine-tick-ordering.test.ts` — update `updateActiveStreams` record signature

---

## Task 1: Transient revenue/upkeep state fields

**Why first:** Everything downstream writes or reads these accumulators. Landing them before any behavioral change keeps the tree green and isolates the state change from any observable effect.

**Files:**
- Modify: `src/core/state/simulation-state.ts`
- Modify: `src/core/engine/reset-per-tick.ts`
- Test: `tests/unit/simulation-state.test.ts` (add two cases to existing file)

- [ ] **Step 1: Add failing test for the new fields**

Open `tests/unit/simulation-state.test.ts` and add the following test at the bottom of the existing `describe("SimulationState", ...)` block (or a new `describe` if you prefer — doesn't matter). The exact imports at the top should already cover `SimulationState`; if not, add the import.

```ts
  it("initializes revenueEarnedThisTick and upkeepPaidThisTick to zero", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    expect(state.revenueEarnedThisTick).toBe(0);
    expect(state.upkeepPaidThisTick).toBe(0);
  });

  it("allows mutating the transient revenue/upkeep accumulators", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.revenueEarnedThisTick = 42;
    state.upkeepPaidThisTick = 17;
    expect(state.revenueEarnedThisTick).toBe(42);
    expect(state.upkeepPaidThisTick).toBe(17);
  });
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `pnpm test tests/unit/simulation-state.test.ts`

Expected: the two new cases fail with a TypeScript error (property does not exist on type `SimulationState`) or a runtime `undefined`.

- [ ] **Step 3: Add the fields to `SimulationState`**

Open `src/core/state/simulation-state.ts`. Find the class body (near the existing `currentTick = 0` line, around line 23). Add two field declarations adjacent to the other non-`readonly` scalars:

```ts
  currentTick = 0;
  phase: "build" | "simulate" | "assess" = "build";
  revenueEarnedThisTick = 0;
  upkeepPaidThisTick = 0;
```

Do NOT mark them `readonly` — they are mutated by `resetPerTickState` and by the revenue-crediting sites in later tasks.

- [ ] **Step 4: Zero the fields in `resetPerTickState`**

Open `src/core/engine/reset-per-tick.ts`. After the `state.connectionLoadThisTick.clear()` call near the bottom of the function, add:

```ts
  // (5) Clear per-tick revenue/upkeep accumulators. Metrics step 8 has
  // already read them into metricsHistory by the time we get here.
  state.revenueEarnedThisTick = 0;
  state.upkeepPaidThisTick = 0;
```

- [ ] **Step 5: Add a reset-per-tick test case**

Open `tests/unit/reset-per-tick.test.ts` (create if it doesn't exist) and add:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { resetPerTickState } from "@core/engine/reset-per-tick";

describe("resetPerTickState", () => {
  it("zeros revenueEarnedThisTick and upkeepPaidThisTick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.revenueEarnedThisTick = 123;
    state.upkeepPaidThisTick = 456;
    resetPerTickState(state);
    expect(state.revenueEarnedThisTick).toBe(0);
    expect(state.upkeepPaidThisTick).toBe(0);
  });
});
```

If `tests/unit/reset-per-tick.test.ts` already exists, add the new `it` block inside the existing `describe`.

- [ ] **Step 6: Run the targeted tests and confirm they pass**

Run: `pnpm test tests/unit/simulation-state.test.ts tests/unit/reset-per-tick.test.ts`

Expected: all assertions pass.

- [ ] **Step 7: Run the full suite and confirm no regressions**

Run: `pnpm test`

Expected: 267 + 3 new = 270 tests passing. No existing test affected.

- [ ] **Step 8: Commit**

```bash
git add src/core/state/simulation-state.ts src/core/engine/reset-per-tick.ts tests/unit/simulation-state.test.ts tests/unit/reset-per-tick.test.ts
git commit -m "feat(state): add revenueEarnedThisTick/upkeepPaidThisTick transient fields"
```

---

## Task 2: `condition-effects.ts` — the effect-lookup module

**Why next:** Five separate call sites later in the plan (`updateCondition`, `deductUpkeep`, `process-pending`, `effective-bandwidth.getEffectiveLatency`) all need to read effects off a component the same way. Centralizing this first prevents drift between those sites.

**Files:**
- Create: `src/core/engine/condition-effects.ts`
- Create: `tests/unit/condition-effects.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/condition-effects.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  getActiveConditionEffects,
  getUpkeepMultiplier,
  getThroughputMultiplier,
  getDropProbability,
  getLatencyMultiplier,
} from "@core/engine/condition-effects";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId } from "@core/types/ids";
import type { ConditionEffect, ConditionProfile } from "@core/types/condition";

function makeComp(
  condition: number,
  profile: Partial<ConditionProfile> = {},
): Component {
  const full: ConditionProfile = {
    degradedThreshold: 0.7,
    criticalThreshold: 0.3,
    decayRate: 0.05,
    recoveryRate: 0.02,
    degradedEffects: [],
    criticalEffects: [],
    ...profile,
  };
  return new Component({
    id: "c1" as ComponentId,
    type: "test",
    name: "Test",
    description: "",
    capabilities: new Map(),
    initialTiers: new Map<CapabilityId, number>(),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: full,
    initialCondition: condition,
  });
}

describe("getActiveConditionEffects", () => {
  it("returns [] when healthy (condition above degraded threshold)", () => {
    const c = makeComp(0.9, {
      degradedEffects: [{ kind: "drop_probability", p: 0.5 }],
      criticalEffects: [{ kind: "drop_probability", p: 1.0 }],
    });
    expect(getActiveConditionEffects(c)).toEqual([]);
  });

  it("returns degradedEffects when condition equals degradedThreshold", () => {
    const degraded: ConditionEffect[] = [{ kind: "latency_multiplier", factor: 1.5 }];
    const c = makeComp(0.7, { degradedEffects: degraded });
    expect(getActiveConditionEffects(c)).toEqual(degraded);
  });

  it("returns degradedEffects when condition is between thresholds", () => {
    const degraded: ConditionEffect[] = [{ kind: "throughput_multiplier", factor: 0.5 }];
    const c = makeComp(0.5, { degradedEffects: degraded });
    expect(getActiveConditionEffects(c)).toEqual(degraded);
  });

  it("returns criticalEffects when condition equals criticalThreshold", () => {
    const critical: ConditionEffect[] = [{ kind: "drop_probability", p: 0.9 }];
    const c = makeComp(0.3, { criticalEffects: critical });
    expect(getActiveConditionEffects(c)).toEqual(critical);
  });

  it("returns criticalEffects at zero condition", () => {
    const critical: ConditionEffect[] = [{ kind: "drop_probability", p: 1.0 }];
    const c = makeComp(0, { criticalEffects: critical });
    expect(getActiveConditionEffects(c)).toEqual(critical);
  });
});

describe("getUpkeepMultiplier", () => {
  it("returns 1 when no effects", () => {
    expect(getUpkeepMultiplier(makeComp(1.0))).toBe(1);
  });

  it("returns the product of all upkeep_multiplier effects", () => {
    const c = makeComp(0.2, {
      criticalEffects: [
        { kind: "upkeep_multiplier", factor: 2 },
        { kind: "upkeep_multiplier", factor: 1.5 },
        { kind: "drop_probability", p: 0.1 }, // ignored
      ],
    });
    expect(getUpkeepMultiplier(c)).toBe(3);
  });
});

describe("getThroughputMultiplier", () => {
  it("returns 1 when no effects", () => {
    expect(getThroughputMultiplier(makeComp(1.0))).toBe(1);
  });

  it("returns the product of throughput_multiplier effects", () => {
    const c = makeComp(0.5, {
      degradedEffects: [
        { kind: "throughput_multiplier", factor: 0.5 },
        { kind: "throughput_multiplier", factor: 0.5 },
      ],
    });
    expect(getThroughputMultiplier(c)).toBe(0.25);
  });
});

describe("getDropProbability", () => {
  it("returns 0 when no drop effects", () => {
    expect(getDropProbability(makeComp(1.0))).toBe(0);
  });

  it("sums drop_probability effects", () => {
    const c = makeComp(0.5, {
      degradedEffects: [
        { kind: "drop_probability", p: 0.2 },
        { kind: "drop_probability", p: 0.3 },
      ],
    });
    expect(getDropProbability(c)).toBeCloseTo(0.5, 10);
  });

  it("clamps to 1 when sum exceeds 1", () => {
    const c = makeComp(0.2, {
      criticalEffects: [
        { kind: "drop_probability", p: 0.6 },
        { kind: "drop_probability", p: 0.8 },
      ],
    });
    expect(getDropProbability(c)).toBe(1);
  });
});

describe("getLatencyMultiplier", () => {
  it("returns 1 when no latency effects", () => {
    expect(getLatencyMultiplier(makeComp(1.0))).toBe(1);
  });

  it("returns the product of latency_multiplier effects", () => {
    const c = makeComp(0.5, {
      degradedEffects: [
        { kind: "latency_multiplier", factor: 1.5 },
        { kind: "latency_multiplier", factor: 2.0 },
      ],
    });
    expect(getLatencyMultiplier(c)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm test tests/unit/condition-effects.test.ts`

Expected: all tests fail — `@core/engine/condition-effects` module does not exist.

- [ ] **Step 3: Create the module**

Create `src/core/engine/condition-effects.ts`:

```ts
import type { Component } from "../component/component.js";
import type { ConditionEffect } from "../types/condition.js";

/**
 * Tier selection (exact, in order):
 *   if (condition <= criticalThreshold)  return criticalEffects;
 *   if (condition <= degradedThreshold)  return degradedEffects;
 *   return [];
 *
 * Higher condition = healthier. Exactly-at-threshold is the lower tier.
 */
export function getActiveConditionEffects(
  component: Component,
): readonly ConditionEffect[] {
  const { condition, conditionProfile: profile } = component;
  if (condition <= profile.criticalThreshold) return profile.criticalEffects;
  if (condition <= profile.degradedThreshold) return profile.degradedEffects;
  return [];
}

export function getUpkeepMultiplier(component: Component): number {
  let product = 1;
  for (const e of getActiveConditionEffects(component)) {
    if (e.kind === "upkeep_multiplier") product *= e.factor;
  }
  return product;
}

export function getThroughputMultiplier(component: Component): number {
  let product = 1;
  for (const e of getActiveConditionEffects(component)) {
    if (e.kind === "throughput_multiplier") product *= e.factor;
  }
  return product;
}

export function getDropProbability(component: Component): number {
  let sum = 0;
  for (const e of getActiveConditionEffects(component)) {
    if (e.kind === "drop_probability") sum += e.p;
  }
  return sum > 1 ? 1 : sum;
}

export function getLatencyMultiplier(component: Component): number {
  let product = 1;
  for (const e of getActiveConditionEffects(component)) {
    if (e.kind === "latency_multiplier") product *= e.factor;
  }
  return product;
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm test tests/unit/condition-effects.test.ts`

Expected: all 13 assertions pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/condition-effects.ts tests/unit/condition-effects.test.ts
git commit -m "feat(engine): add condition-effects helper module"
```

---

## Task 3: `ActiveStream.request` + `updateActiveStreams` signature plumbing

**Why now:** The revenue-crediting work at STREAM_COMPLETED (Task 13) needs the full `Request` accessible on `ActiveStream`, and it needs `updateActiveStreams` to receive a `ModeController`. Doing the plumbing change alone first — with no behavior change — keeps it isolated and grepable in git history.

**Files:**
- Modify: `src/core/types/stream.ts`
- Modify: `src/core/engine/active-streams.ts`
- Modify: `src/core/engine/engine.ts`
- Modify: `src/core/engine/deliver-staged.ts` (construction site only)
- Modify: `tests/unit/engine-tick-ordering.test.ts`

- [ ] **Step 1: Add the `request` field to `ActiveStream`**

Open `src/core/types/stream.ts`. Add `Request` to imports and add the field:

```ts
import type { RequestId, ComponentId, ConnectionId } from "./ids.js";
import type { Request } from "./request.js";

export interface ActiveStream {
  readonly requestId: RequestId;
  readonly connectionId: ConnectionId;
  readonly originComponentId: ComponentId;
  readonly baseRevenue: number;
  readonly request: Request;
  remainingDuration: number;
  reservedBandwidth: number;
}
```

- [ ] **Step 2: Populate the field at the construction site**

Open `src/core/engine/deliver-staged.ts`. Find the `registerActiveStream` call (around line 98). The request is already in scope as `request`. Add the field:

```ts
        state.registerActiveStream({
          requestId: request.id,
          connectionId: streamConnectionId,
          originComponentId: request.origin,
          baseRevenue: 0,
          request,
          remainingDuration: request.streamDuration,
          reservedBandwidth: request.streamBandwidth ?? 0,
        });
```

- [ ] **Step 3: Change `updateActiveStreams` signature**

Open `src/core/engine/active-streams.ts`. The function is currently `(state: SimulationState): void`. Change it to accept `modeController`, but do NOT use it yet — that comes in Task 13. Adding it now keeps the plumbing isolated.

```ts
import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";

export function updateActiveStreams(
  state: SimulationState,
  _modeController: ModeController,
): void {
  // Snapshot entries up front so releaseActiveStream can safely delete during iteration.
  const streams = [...state.activeStreams.values()];
  for (const stream of streams) {
    stream.remainingDuration -= 1;
    if (stream.remainingDuration <= 0) {
      state.releaseActiveStream(stream.requestId);
      state.appendEvent(stream.requestId, {
        tick: state.currentTick,
        componentId: stream.originComponentId,
        capabilityId: null,
        connectionId: stream.connectionId,
        type: "STREAM_COMPLETED",
        latencyAdded: 0,
      });
    }
  }
}
```

- [ ] **Step 4: Update the `EngineSteps` interface and dispatch in `engine.ts`**

Open `src/core/engine/engine.ts`. Find the `EngineSteps` interface and change the `updateActiveStreams` line:

```ts
  updateActiveStreams: (state: SimulationState, mc: ModeController) => void;
```

Find the call site in `Engine.tick` that invokes `this.steps.updateActiveStreams(state)` and change it to pass `mc`:

```ts
    this.steps.updateActiveStreams(state, mc);
```

- [ ] **Step 5: Update the test that injects `updateActiveStreams` through `EngineSteps`**

Open `tests/unit/engine-tick-ordering.test.ts`. Around line 21 is the line:

```ts
      updateActiveStreams: record("updateActiveStreams"),
```

The `record` helper returns `(name: string) => () => void` — it produces a zero-arg function. Since the new signature is `(state, mc) => void`, the zero-arg function will silently accept extra arguments at runtime (JavaScript), but TypeScript will complain.

Change `record` (lines 12–14) so it accepts the wider signature while still pushing the name:

```ts
    const record =
      (name: string) =>
      (..._args: unknown[]): void => {
        order.push(name);
      };
```

All step-function mocks now type-match any step signature. No other changes needed in this file.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`

Expected: all tests still pass (no behavior change), typecheck clean. Note that the `_modeController` underscore prefix in `updateActiveStreams` signals intentional-unused and silences the `noUnusedParameters` lint.

- [ ] **Step 7: Commit**

```bash
git add src/core/types/stream.ts src/core/engine/active-streams.ts src/core/engine/engine.ts src/core/engine/deliver-staged.ts tests/unit/engine-tick-ordering.test.ts
git commit -m "refactor(engine): thread ModeController into updateActiveStreams; ActiveStream carries Request"
```

---

## Task 4: Real `updateCondition` (step 6)

**Files:**
- Modify: `src/core/engine/stubs.ts`
- Create: `tests/unit/condition-update.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/condition-update.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { updateCondition } from "@core/engine/stubs";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import { NoOpModeController } from "@harness/noop-mode-controller";

const profile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [],
  criticalEffects: [],
};

function makeComp(id: string, initialCondition: number): Component {
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map(),
    initialTiers: new Map<CapabilityId, number>(),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
    initialCondition,
  });
}

function place(state: SimulationState, comp: Component): void {
  state.placeComponent(comp);
  state.visitOrder.push(comp.id);
}

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("updateCondition", () => {
  let state: SimulationState;

  beforeEach(() => {
    state = new SimulationState({ zones: [], pairLatency: new Map() });
  });

  it("decays condition on a tick with any drops", () => {
    const c = makeComp("c1", 1.0);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 0, drops: 1, timeouts: 0, overloaded: 0, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.9, 10);
  });

  it("decays on a timeout-only tick", () => {
    const c = makeComp("c1", 0.8);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 5, drops: 0, timeouts: 1, overloaded: 0, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.7, 10);
  });

  it("decays on an overloaded-only tick", () => {
    const c = makeComp("c1", 0.9);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 0, drops: 0, timeouts: 0, overloaded: 2, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.8, 10);
  });

  it("decays on a backpressured-only tick", () => {
    const c = makeComp("c1", 0.5);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 0, drops: 0, timeouts: 0, overloaded: 0, backpressured: 3,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.4, 10);
  });

  it("recovers condition on a clean tick", () => {
    const c = makeComp("c1", 0.5);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 10, drops: 0, timeouts: 0, overloaded: 0, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.55, 10);
  });

  it("recovers when the component has no counter entry at all", () => {
    const c = makeComp("c1", 0.5);
    place(state, c);
    // No perComponentThisTick entry — treated as clean.
    updateCondition(state, mc);
    expect(c.condition).toBeCloseTo(0.55, 10);
  });

  it("clamps at 1.0 when healthy and recovering", () => {
    const c = makeComp("c1", 0.99);
    place(state, c);
    updateCondition(state, mc);
    expect(c.condition).toBe(1);
  });

  it("clamps at 0.0 when critical and decaying", () => {
    const c = makeComp("c1", 0.05);
    place(state, c);
    state.perComponentThisTick.set(c.id, {
      processed: 0, drops: 1, timeouts: 0, overloaded: 0, backpressured: 0,
    });
    updateCondition(state, mc);
    expect(c.condition).toBe(0);
  });

  it("updates each component independently in one pass", () => {
    const a = makeComp("a", 0.8);
    const b = makeComp("b", 0.8);
    place(state, a);
    place(state, b);
    state.perComponentThisTick.set(a.id, {
      processed: 0, drops: 1, timeouts: 0, overloaded: 0, backpressured: 0,
    });
    // b is clean (no counter entry).
    updateCondition(state, mc);
    expect(a.condition).toBeCloseTo(0.7, 10);
    expect(b.condition).toBeCloseTo(0.85, 10);
  });

  it("iterates in visitOrder (deterministic)", () => {
    const a = makeComp("a", 0.5);
    const b = makeComp("b", 0.5);
    place(state, a);
    place(state, b);
    expect(state.visitOrder).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/condition-update.test.ts`

Expected: the tests fail — `updateCondition` is still a no-op, so `c.condition` stays at its initial value and the assertions miss.

- [ ] **Step 3: Implement `updateCondition`**

Open `src/core/engine/stubs.ts`. Replace the `updateCondition` body:

```ts
export function updateCondition(
  state: SimulationState,
  _modeController: ModeController,
): void {
  for (const id of state.visitOrder) {
    const comp = state.components.get(id);
    if (!comp) continue;
    const counters = state.perComponentThisTick.get(id);
    const badTick =
      counters !== undefined &&
      counters.drops + counters.timeouts + counters.overloaded + counters.backpressured > 0;
    const delta = badTick
      ? -comp.conditionProfile.decayRate
      : comp.conditionProfile.recoveryRate;
    state.setCondition(id, comp.condition + delta);
  }
}
```

Leave `injectChaos` and `deductUpkeep` as no-ops for now — those come in Tasks 5 and 11.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm test tests/unit/condition-update.test.ts`

Expected: all assertions pass.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: no regressions. Stage 2a tests unaffected because they use components with condition 1.0, which recovers to 1.0 (clamped — no change).

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/stubs.ts tests/unit/condition-update.test.ts
git commit -m "feat(engine): implement updateCondition with decay/recovery"
```

---

## Task 5: Real `injectChaos` (step 6b)

**Files:**
- Modify: `src/core/engine/stubs.ts`
- Create: `tests/unit/chaos-injection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/chaos-injection.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { injectChaos } from "@core/engine/stubs";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId, ConnectionId } from "@core/types/ids";
import type { ChaosEvent } from "@core/types/chaos";
import type { ConditionProfile } from "@core/types/condition";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { ModeController } from "@core/mode/mode-controller";

const profile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [],
  criticalEffects: [],
};

function makeComp(id: string, zone: string | null = null): Component {
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map(),
    initialTiers: new Map<CapabilityId, number>(),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone,
    placementTick: 0,
    conditionProfile: profile,
    initialCondition: 1.0,
  });
}

class FakeChaosMc extends NoOpModeController {
  constructor(private readonly schedule: ReadonlyMap<number, readonly ChaosEvent[]>) {
    super({ targetEntryPointId: "x" as ComponentId, intensity: 0, requestType: "api_read" });
  }
  override getScheduledChaos(tick: number): readonly ChaosEvent[] {
    return this.schedule.get(tick) ?? [];
  }
}

function fresh(): SimulationState {
  return new SimulationState({ zones: [], pairLatency: new Map() });
}

describe("injectChaos", () => {
  let state: SimulationState;

  beforeEach(() => {
    state = fresh();
  });

  it("component_failure: zeros condition and registers an entry", () => {
    const c = makeComp("c1");
    state.placeComponent(c);
    const mc: ModeController = new FakeChaosMc(
      new Map([[0, [{ kind: "component_failure", componentId: c.id }]]]),
    );
    injectChaos(state, mc);
    expect(c.condition).toBe(0);
    expect(state.activeChaos.has("component:c1")).toBe(true);
  });

  it("zone_outage: zeros every component in the zone", () => {
    const a = makeComp("a", "us-east");
    const b = makeComp("b", "us-east");
    const c = makeComp("c", "eu-west");
    state.placeComponent(a);
    state.placeComponent(b);
    state.placeComponent(c);
    const mc = new FakeChaosMc(
      new Map([[0, [{ kind: "zone_outage", zone: "us-east", durationTicks: 5 }]]]),
    );
    injectChaos(state, mc);
    expect(a.condition).toBe(0);
    expect(b.condition).toBe(0);
    expect(c.condition).toBe(1);
    expect(state.activeChaos.has("zone:us-east")).toBe(true);
  });

  it("component_failure entry expires after one tick", () => {
    const c = makeComp("c1");
    state.placeComponent(c);
    const mc = new FakeChaosMc(
      new Map([[0, [{ kind: "component_failure", componentId: c.id }]]]),
    );
    injectChaos(state, mc);
    expect(state.activeChaos.size).toBe(1);
    state.currentTick = 1;
    injectChaos(state, mc); // no new events scheduled at tick 1
    expect(state.activeChaos.size).toBe(0);
  });

  it("connection_sever: stores with sever: prefix, does NOT touch condition", () => {
    const c = makeComp("c1");
    state.placeComponent(c);
    const mc = new FakeChaosMc(
      new Map([[0, [{
        kind: "connection_sever",
        connectionId: "conn-1" as ConnectionId,
        durationTicks: 3,
      }]]]),
    );
    injectChaos(state, mc);
    expect(state.activeChaos.has("sever:conn-1")).toBe(true);
    expect(c.condition).toBe(1);
  });

  it("latency_injection: stores with latency: prefix", () => {
    const mc = new FakeChaosMc(
      new Map([[0, [{
        kind: "latency_injection",
        connectionId: "conn-1" as ConnectionId,
        extraLatency: 50,
        durationTicks: 2,
      }]]]),
    );
    injectChaos(state, mc);
    expect(state.activeChaos.has("latency:conn-1")).toBe(true);
  });

  it("sever and latency on same connection coexist under distinct keys", () => {
    const mc = new FakeChaosMc(
      new Map([[0, [
        { kind: "connection_sever", connectionId: "c" as ConnectionId, durationTicks: 3 },
        { kind: "latency_injection", connectionId: "c" as ConnectionId, extraLatency: 10, durationTicks: 3 },
      ]]]),
    );
    injectChaos(state, mc);
    expect(state.activeChaos.size).toBe(2);
    expect(state.activeChaos.has("sever:c")).toBe(true);
    expect(state.activeChaos.has("latency:c")).toBe(true);
  });

  it("later latency_injection on the same key replaces the earlier one", () => {
    const first: ChaosEvent = {
      kind: "latency_injection",
      connectionId: "c" as ConnectionId,
      extraLatency: 10,
      durationTicks: 5,
    };
    const second: ChaosEvent = {
      kind: "latency_injection",
      connectionId: "c" as ConnectionId,
      extraLatency: 99,
      durationTicks: 5,
    };
    const mc = new FakeChaosMc(new Map([[0, [first, second]]]));
    injectChaos(state, mc);
    const entry = state.activeChaos.get("latency:c");
    expect(entry).toBeDefined();
    expect((entry!.event as { extraLatency: number }).extraLatency).toBe(99);
  });

  it("zone_outage re-applies condition=0 on every tick of its duration", () => {
    const a = makeComp("a", "us-east");
    state.placeComponent(a);
    const mc = new FakeChaosMc(
      new Map([[0, [{ kind: "zone_outage", zone: "us-east", durationTicks: 3 }]]]),
    );
    // Tick 0: inject
    injectChaos(state, mc);
    expect(a.condition).toBe(0);
    // Recovery would nudge it up, simulate by setting condition directly.
    a.condition = 0.5;
    state.currentTick = 1;
    injectChaos(state, mc);
    expect(a.condition).toBe(0); // re-applied
    a.condition = 0.5;
    state.currentTick = 2;
    injectChaos(state, mc);
    expect(a.condition).toBe(0);
    a.condition = 0.5;
    state.currentTick = 3; // expires at tick 3 (expiresAtTick = 0 + 3 = 3)
    injectChaos(state, mc);
    expect(a.condition).toBe(0.5); // no re-apply after expiry
  });

  it("sweeps expired entries before inserting new ones (same-tick re-arm)", () => {
    const c = makeComp("c1");
    state.placeComponent(c);
    const mc = new FakeChaosMc(new Map([
      [0, [{ kind: "component_failure", componentId: c.id }]],
      [1, [{ kind: "component_failure", componentId: c.id }]],
    ]));
    injectChaos(state, mc);
    expect(state.activeChaos.size).toBe(1);
    state.currentTick = 1;
    injectChaos(state, mc); // old entry expires, new one inserted same tick
    expect(state.activeChaos.size).toBe(1);
    expect(c.condition).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/chaos-injection.test.ts`

Expected: fails — `injectChaos` is still a no-op.

- [ ] **Step 3: Implement `injectChaos`**

Open `src/core/engine/stubs.ts`. Add imports at the top (if not already present):

```ts
import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { ChaosEvent } from "../types/chaos.js";
```

Add the helpers and replace the `injectChaos` body:

```ts
function chaosKey(event: ChaosEvent): string {
  switch (event.kind) {
    case "component_failure": return `component:${event.componentId}`;
    case "zone_outage":        return `zone:${event.zone}`;
    case "connection_sever":   return `sever:${event.connectionId}`;
    case "latency_injection":  return `latency:${event.connectionId}`;
  }
}

function computeExpiry(event: ChaosEvent, tick: number): number {
  switch (event.kind) {
    case "component_failure": return tick + 1;
    case "zone_outage":
    case "connection_sever":
    case "latency_injection":  return tick + event.durationTicks;
  }
}

export function injectChaos(
  state: SimulationState,
  mc: ModeController,
): void {
  // 1. Sweep expired entries first so same-tick re-arms can succeed.
  for (const [key, entry] of state.activeChaos) {
    if (entry.expiresAtTick <= state.currentTick) {
      state.activeChaos.delete(key);
    }
  }

  // 2. Pull new events and insert.
  const events = mc.getScheduledChaos(state.currentTick);
  for (const event of events) {
    state.activeChaos.set(chaosKey(event), {
      event,
      expiresAtTick: computeExpiry(event, state.currentTick),
    });
  }

  // 3. Re-apply instant-condition chaos across every still-active entry
  //    (not just new ones). This keeps zone_outage / component_failure
  //    pinned at 0 for the duration of the window.
  for (const entry of state.activeChaos.values()) {
    switch (entry.event.kind) {
      case "component_failure":
        state.setCondition(entry.event.componentId, 0);
        break;
      case "zone_outage": {
        const zone = entry.event.zone;
        for (const comp of state.components.values()) {
          if (comp.zone === zone) state.setCondition(comp.id, 0);
        }
        break;
      }
      // connection_sever, latency_injection are adapter-only.
    }
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm test tests/unit/chaos-injection.test.ts`

Expected: all 10 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/stubs.ts tests/unit/chaos-injection.test.ts
git commit -m "feat(engine): implement injectChaos with sweep/insert/re-apply"
```

---

## Task 6: `getEffectiveBandwidth` honors `connection_sever`

**Files:**
- Modify: `src/core/engine/effective-bandwidth.ts`
- Create: `tests/unit/effective-bandwidth-chaos.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/effective-bandwidth-chaos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { getEffectiveBandwidth } from "@core/engine/effective-bandwidth";
import type { ConnectionId, ComponentId, PortId } from "@core/types/ids";

function addConn(state: SimulationState, id: string, bandwidth = 100, latency = 10): ConnectionId {
  const cid = id as ConnectionId;
  state.addConnection({
    id: cid,
    source: { componentId: "s" as ComponentId, portId: "p" as PortId },
    target: { componentId: "t" as ComponentId, portId: "p" as PortId },
    bandwidth,
    latency,
    currentLoad: 0,
  });
  return cid;
}

describe("getEffectiveBandwidth with chaos", () => {
  it("returns raw bandwidth when no chaos", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cid = addConn(state, "c1");
    expect(getEffectiveBandwidth(state, cid)).toBe(100);
  });

  it("returns 0 when a connection_sever entry matches", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cid = addConn(state, "c1");
    state.activeChaos.set("sever:c1", {
      event: { kind: "connection_sever", connectionId: cid, durationTicks: 5 },
      expiresAtTick: 5,
    });
    expect(getEffectiveBandwidth(state, cid)).toBe(0);
  });

  it("ignores chaos targeting a different connection", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const a = addConn(state, "a");
    const b = addConn(state, "b");
    state.activeChaos.set("sever:a", {
      event: { kind: "connection_sever", connectionId: a, durationTicks: 5 },
      expiresAtTick: 5,
    });
    expect(getEffectiveBandwidth(state, b)).toBe(100);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/effective-bandwidth-chaos.test.ts`

Expected: the sever test fails because `getEffectiveBandwidth` returns 100 instead of 0.

- [ ] **Step 3: Update `getEffectiveBandwidth`**

Open `src/core/engine/effective-bandwidth.ts`. Add the chaos check at the top of `getEffectiveBandwidth`:

```ts
export function getEffectiveBandwidth(
  state: SimulationState,
  connectionId: ConnectionId,
): number {
  // Chaos check first — connection_sever forces 0 regardless of raw bandwidth.
  for (const entry of state.activeChaos.values()) {
    if (
      entry.event.kind === "connection_sever" &&
      entry.event.connectionId === connectionId
    ) {
      return 0;
    }
  }
  const conn = state.connections.get(connectionId);
  if (!conn) return 0;
  const load = state.connectionLoadThisTick.get(connectionId) ?? 0;
  let streamLoad = 0;
  for (const s of state.activeStreams.values()) {
    if (s.connectionId === connectionId) streamLoad += s.reservedBandwidth;
  }
  return conn.bandwidth - load - streamLoad;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm test tests/unit/effective-bandwidth-chaos.test.ts`

Expected: all 3 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/effective-bandwidth.ts tests/unit/effective-bandwidth-chaos.test.ts
git commit -m "feat(engine): getEffectiveBandwidth honors connection_sever chaos"
```

---

## Task 7: `getEffectiveLatency` honors `latency_injection` + `latency_multiplier`

**Files:**
- Modify: `src/core/engine/effective-bandwidth.ts` (hosts `getEffectiveLatency`)
- Create: `tests/unit/effective-latency.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/effective-latency.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { getEffectiveLatency } from "@core/engine/effective-bandwidth";
import { Component } from "@core/component/component";
import type { ConnectionId, ComponentId, PortId, CapabilityId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";

const healthy: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [{ kind: "latency_multiplier", factor: 2 }],
  criticalEffects: [{ kind: "latency_multiplier", factor: 3 }],
};

function makeSourceComp(id: string, condition: number): Component {
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map(),
    initialTiers: new Map<CapabilityId, number>(),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: healthy,
    initialCondition: condition,
  });
}

function addConnFrom(
  state: SimulationState,
  id: string,
  sourceId: string,
  latency = 10,
): ConnectionId {
  const cid = id as ConnectionId;
  state.addConnection({
    id: cid,
    source: { componentId: sourceId as ComponentId, portId: "p" as PortId },
    target: { componentId: "t" as ComponentId, portId: "p" as PortId },
    bandwidth: 100,
    latency,
    currentLoad: 0,
  });
  return cid;
}

describe("getEffectiveLatency", () => {
  it("returns raw latency when no chaos and source is healthy", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 1.0);
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    expect(getEffectiveLatency(state, cid)).toBe(10);
  });

  it("adds latency_injection extraLatency", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 1.0);
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    state.activeChaos.set("latency:c1", {
      event: { kind: "latency_injection", connectionId: cid, extraLatency: 50, durationTicks: 3 },
      expiresAtTick: 3,
    });
    expect(getEffectiveLatency(state, cid)).toBe(60);
  });

  it("applies source-component latency_multiplier at degraded tier", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 0.5); // degraded
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    expect(getEffectiveLatency(state, cid)).toBe(20); // 10 * 2
  });

  it("applies source-component latency_multiplier at critical tier", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 0.1); // critical
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    expect(getEffectiveLatency(state, cid)).toBe(30); // 10 * 3
  });

  it("chaos adder applies before condition multiplier", () => {
    // (base + extra) * multiplier
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 0.5); // degraded → 2x
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    state.activeChaos.set("latency:c1", {
      event: { kind: "latency_injection", connectionId: cid, extraLatency: 5, durationTicks: 3 },
      expiresAtTick: 3,
    });
    expect(getEffectiveLatency(state, cid)).toBe(30); // (10 + 5) * 2
  });

  it("returns 0 for unknown connection id", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    expect(getEffectiveLatency(state, "ghost" as ConnectionId)).toBe(0);
  });

  it("ignores source component when it's missing", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cid = addConnFrom(state, "c1", "missing", 10);
    // No placed component — multiplier should default to 1.
    expect(getEffectiveLatency(state, cid)).toBe(10);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/effective-latency.test.ts`

Expected: multiple cases fail — the adapter is currently a raw pass-through.

- [ ] **Step 3: Update `getEffectiveLatency`**

Open `src/core/engine/effective-bandwidth.ts`. Add the import for `getLatencyMultiplier`:

```ts
import type { SimulationState } from "../state/simulation-state.js";
import type { ConnectionId } from "../types/ids.js";
import { getLatencyMultiplier } from "./condition-effects.js";
```

Replace `getEffectiveLatency`:

```ts
export function getEffectiveLatency(
  state: SimulationState,
  connectionId: ConnectionId,
): number {
  const conn = state.connections.get(connectionId);
  if (!conn) return 0;
  let latency = conn.latency;

  // Chaos adder first — a latency_injection matching this connection.
  // The §5.3 collapse rule keeps at most one entry per key, so we can
  // break after the first hit.
  for (const entry of state.activeChaos.values()) {
    if (
      entry.event.kind === "latency_injection" &&
      entry.event.connectionId === connectionId
    ) {
      latency += entry.event.extraLatency;
      break;
    }
  }

  // Condition multiplier: from-component's outgoing latency scales by
  // its active latency_multiplier effects.
  const fromComp = state.components.get(conn.source.componentId);
  if (fromComp) {
    latency *= getLatencyMultiplier(fromComp);
  }
  return latency;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm test tests/unit/effective-latency.test.ts`

Expected: all 7 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: no regressions. Existing tests use healthy components (multiplier 1) and no chaos, so their latency reads are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/effective-bandwidth.ts tests/unit/effective-latency.test.ts
git commit -m "feat(engine): getEffectiveLatency honors latency_injection + latency_multiplier"
```

---

## Task 8: Route direct `conn.latency` reads through `getEffectiveLatency`

**Files:**
- Modify: `src/core/engine/deliver-staged.ts` (line 302 area)
- Modify: `src/core/engine/return-path.ts` (line 26)

- [ ] **Step 1: Write a regression test confirming routing**

Create or extend `tests/unit/effective-latency.test.ts` with this additional case at the end (it goes inside the existing `describe` block):

```ts
  it("all engine-internal latency reads go through getEffectiveLatency (grep invariant)", async () => {
    // This test documents the rule by grepping source. It is a cheap guard
    // against future drift. The implementation rule: no file under
    // src/core/engine/ should read `.latency` on a Connection except
    // effective-bandwidth.ts itself.
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = "src/core/engine";
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      if (name === "effective-bandwidth.ts") continue;
      const content = readFileSync(join(dir, name), "utf8");
      // match `.latency` that is not part of `.latencyAdded`
      const re = /\.latency(?!Added)\b/g;
      if (re.test(content)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/effective-latency.test.ts`

Expected: the new test fails, listing `deliver-staged.ts` and `return-path.ts` as offenders.

- [ ] **Step 3: Fix `deliver-staged.ts`**

Open `src/core/engine/deliver-staged.ts`. Add the import:

```ts
import { getEffectiveLatency } from "./effective-bandwidth.js";
```

Find the line around 302 (`latencyAdded: conn.latency,`) and change it:

```ts
        latencyAdded: getEffectiveLatency(state, connectionId),
```

- [ ] **Step 4: Fix `return-path.ts`**

Open `src/core/engine/return-path.ts`. Replace the direct `conn?.latency` read. The relevant block currently reads roughly:

```ts
    const conn = state.connections.get(reverseId);
    returnLatency += conn?.latency ?? 0;
```

Change it to:

```ts
    returnLatency += getEffectiveLatency(state, reverseId);
```

And add the import at the top:

```ts
import { getEffectiveLatency } from "./effective-bandwidth.js";
```

If the existing code still needs the `conn` binding for something else, keep it; otherwise delete the unused lookup.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: the grep regression test passes, and all Stage 2a tests still pass (a healthy component returns multiplier 1 and no chaos entries exist, so `getEffectiveLatency` returns exactly `conn.latency` — byte-identical behavior).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/engine/deliver-staged.ts src/core/engine/return-path.ts tests/unit/effective-latency.test.ts
git commit -m "refactor(engine): route all latency reads through getEffectiveLatency"
```

---

## Task 9: `process-pending` hooks — throughput multiplier + drop probability

**Files:**
- Modify: `src/core/engine/process-pending.ts`
- Create: `tests/unit/process-pending-condition.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/process-pending-condition.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId, RequestId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import type { Request } from "@core/types/request";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { RespondingCapability } from "@harness/test-capabilities";

function makeProfile(overrides: Partial<ConditionProfile> = {}): ConditionProfile {
  return {
    degradedThreshold: 0.7,
    criticalThreshold: 0.3,
    decayRate: 0,
    recoveryRate: 0,
    degradedEffects: [],
    criticalEffects: [],
    ...overrides,
  };
}

function makeComp(
  id: string,
  condition: number,
  profile: ConditionProfile,
  cap: RespondingCapability,
): Component {
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map<CapabilityId, RespondingCapability>([[cap.id, cap]]),
    initialTiers: new Map<CapabilityId, number>([[cap.id, 1]]),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
    initialCondition: condition,
  });
}

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

const mc = new NoOpModeController({
  targetEntryPointId: "c1" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("process-pending condition hooks", () => {
  it("throughput_multiplier 0.5 halves the per-tick throughput gate", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cap = new RespondingCapability("proc" as CapabilityId, { throughputPerTier: 4 });
    const comp = makeComp(
      "c1",
      0.5, // degraded
      makeProfile({
        degradedEffects: [{ kind: "throughput_multiplier", factor: 0.5 }],
      }),
      cap,
    );
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    for (let i = 0; i < 10; i++) state.enqueuePending(comp.id, makeReq(`r${i}`));

    new Engine(state).tick(mc);

    // Raw throughput = 4 per tier * 1 instance = 4. Multiplier 0.5 → 2.
    const processed = state.metricsHistory[0]?.perComponent.get(comp.id)?.processed;
    expect(processed).toBe(2);
  });

  it("throughput_multiplier 0 processes nothing", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cap = new RespondingCapability("proc" as CapabilityId, { throughputPerTier: 4 });
    const comp = makeComp(
      "c1",
      0.1, // critical
      makeProfile({
        criticalEffects: [{ kind: "throughput_multiplier", factor: 0 }],
      }),
      cap,
    );
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    for (let i = 0; i < 3; i++) state.enqueuePending(comp.id, makeReq(`r${i}`));

    new Engine(state).tick(mc);

    const processed = state.metricsHistory[0]?.perComponent.get(comp.id)?.processed;
    expect(processed).toBe(0);
  });

  it("drop_probability 1.0 drops every request before the pipeline runs", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cap = new RespondingCapability("proc" as CapabilityId, { throughputPerTier: 100 });
    const comp = makeComp(
      "c1",
      0.1, // critical
      makeProfile({
        criticalEffects: [{ kind: "drop_probability", p: 1.0 }],
      }),
      cap,
    );
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    for (let i = 0; i < 5; i++) state.enqueuePending(comp.id, makeReq(`r${i}`));

    new Engine(state).tick(mc);

    const snap = state.metricsHistory[0]?.perComponent.get(comp.id);
    expect(snap?.dropped).toBe(5);
    expect(snap?.processed).toBe(0);
  });

  it("drop_probability 0 passes every request through", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cap = new RespondingCapability("proc" as CapabilityId, { throughputPerTier: 100 });
    const comp = makeComp("c1", 1.0, makeProfile(), cap); // healthy
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    for (let i = 0; i < 5; i++) state.enqueuePending(comp.id, makeReq(`r${i}`));

    new Engine(state).tick(mc);

    const snap = state.metricsHistory[0]?.perComponent.get(comp.id);
    expect(snap?.dropped).toBe(0);
    expect(snap?.processed).toBe(5);
  });
});
```

**Note:** this test uses `RespondingCapability` from the test harness. Verify that it takes a `throughputPerTier` option in its constructor; if it does not, add it to the capability constructor options (look at `tests/harness/test-capabilities.ts`). If altering `RespondingCapability` is out of scope, use the existing constructor shape and adjust the assertions — the point of the test is the *ratio* between processed and dropped, not the exact number.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/process-pending-condition.test.ts`

Expected: the first two tests fail (throughput multiplier not applied), and the drop test fails (no drop hook yet).

- [ ] **Step 3: Add imports to `process-pending.ts`**

Open `src/core/engine/process-pending.ts`. Add imports:

```ts
import {
  getThroughputMultiplier,
  getDropProbability,
} from "./condition-effects.js";
```

Also add an import for `getOrInitCounters` if it's not already available — check the top of `deliver-staged.ts` for how it's done. If there's a shared utility for counter incrementing, use it; otherwise inline the counter bump.

- [ ] **Step 4: Hook throughput multiplier**

In `processPending`, find the line:

```ts
    const cap = componentThroughputPerTick(component);
```

Replace with:

```ts
    const rawCap = componentThroughputPerTick(component);
    const cap = Math.max(
      0,
      rawCap === Infinity ? Infinity : Math.floor(rawCap * getThroughputMultiplier(component)),
    );
```

The `Infinity` special case preserves the existing "no PROCESS capabilities = unlimited" contract in `throughput.ts`.

- [ ] **Step 5: Hook drop probability**

Inside the `while (true)` loop, after `const req = state.dequeuePending(componentId);` (and after the `if (!req) break;` guard), add the drop roll *before* the pipeline call:

```ts
      // Drop-probability roll from condition effects. Happens inside
      // the accepted throughput slice: a "lost" request still counts
      // against throughput this tick.
      const dropP = getDropProbability(component);
      if (dropP > 0) {
        const rng = createRng(`tick-${state.currentTick}|${component.id}|drop|${req.id}`);
        if (rng.next() < dropP) {
          state.appendEvent(req.id, {
            tick: state.currentTick,
            componentId: component.id,
            capabilityId: null,
            connectionId: null,
            type: "DROPPED",
            latencyAdded: 0,
            metadata: { reason: "condition_drop" },
          });
          const counters = state.perComponentThisTick.get(component.id) ?? {
            processed: 0, drops: 0, timeouts: 0, overloaded: 0, backpressured: 0,
          };
          counters.drops += 1;
          state.perComponentThisTick.set(component.id, counters);
          progressed = true;
          continue;
        }
      }
```

**RNG key note:** the Stage 2a `buildProcessContext` uses `createRng('tick-${state.currentTick}|${component.id}')` — a single RNG per component per tick. We use a *different* key here (`...|drop|${req.id}`) so the drop roll does not consume shared RNG state and break existing Stage 2a determinism. Each request gets its own drop-roll stream.

- [ ] **Step 6: Run tests and confirm pass**

Run: `pnpm test tests/unit/process-pending-condition.test.ts`

Expected: all 4 tests pass.

- [ ] **Step 7: Run the full suite**

Run: `pnpm test`

Expected: no regressions. All Stage 2a tests use condition 1.0 → `dropP = 0` → drop roll skipped → no RNG drift.

- [ ] **Step 8: Commit**

```bash
git add src/core/engine/process-pending.ts tests/unit/process-pending-condition.test.ts
git commit -m "feat(engine): apply throughput_multiplier + drop_probability in processPending"
```

---

## Task 10: `TestEconomyStrategy` + `TestChaosController` harnesses

**Why here:** Tasks 11–15 need inspection-friendly implementations of `EconomyStrategy` and a `ModeController` with a scripted chaos schedule. Build both before the tests that use them.

**Files:**
- Create: `tests/harness/test-economy.ts`
- Create: `tests/harness/test-chaos-controller.ts`

- [ ] **Step 1: Create `tests/harness/test-economy.ts`**

```ts
import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { ComponentReader } from "@core/component/component-reader";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { Request, RequestId } from "@core/types/request";
import type { SimulationStateReader } from "@core/state/state-reader";

export interface TestEconomyOpts {
  budget?: number;
  revenuePerRequest?: number | ((r: Request) => number);
  insolvencyRule?: (state: SimulationStateReader) => ComponentId[];
}

export class TestEconomyStrategy implements EconomyStrategy {
  budget: number;
  readonly creditLog: Array<{ requestId: RequestId; amount: number }> = [];
  readonly debitLog: number[] = [];
  private readonly revenueFn: (r: Request) => number;
  private readonly insolvencyFn: (state: SimulationStateReader) => ComponentId[];

  constructor(opts: TestEconomyOpts = {}) {
    this.budget = opts.budget ?? Infinity;
    const rev = opts.revenuePerRequest ?? 0;
    this.revenueFn = typeof rev === "function" ? rev : () => rev;
    this.insolvencyFn = opts.insolvencyRule ?? (() => []);
  }

  getBudget(): number {
    return this.budget;
  }

  canAfford(cost: number): boolean {
    return this.budget >= cost;
  }

  creditRevenue(request: Request): number {
    const amount = this.revenueFn(request);
    this.budget += amount;
    this.creditLog.push({ requestId: request.id, amount });
    return amount;
  }

  debitUpkeep(totalUpkeep: number): void {
    this.budget -= totalUpkeep;
    this.debitLog.push(totalUpkeep);
  }

  debitPlacement(_component: ComponentReader): void {
    /* noop in tests */
  }

  debitUpgrade(_component: ComponentReader, _capabilityId: CapabilityId): void {
    /* noop in tests */
  }

  resolveInsolvency(state: SimulationStateReader): ComponentId[] {
    return this.insolvencyFn(state);
  }
}
```

- [ ] **Step 2: Create `tests/harness/test-chaos-controller.ts`**

```ts
import type { ChaosEvent } from "@core/types/chaos";
import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { ComponentId } from "@core/types/ids";
import { NoOpModeController } from "./noop-mode-controller.js";
import type { FixedIntensityConfig } from "./fixed-intensity-traffic-source.js";

export interface TestChaosOpts {
  schedule?: Map<number, readonly ChaosEvent[]>;
  economy?: EconomyStrategy;
  traffic?: FixedIntensityConfig;
}

export class TestChaosController extends NoOpModeController {
  private readonly schedule: Map<number, readonly ChaosEvent[]>;
  private readonly overrideEconomy: EconomyStrategy | undefined;

  constructor(opts: TestChaosOpts = {}) {
    super(
      opts.traffic ?? {
        targetEntryPointId: "x" as ComponentId,
        intensity: 0,
        requestType: "api_read",
      },
    );
    this.schedule = opts.schedule ?? new Map();
    this.overrideEconomy = opts.economy;
  }

  override get economy(): EconomyStrategy {
    return this.overrideEconomy ?? super.economy;
  }

  override getScheduledChaos(tick: number): readonly ChaosEvent[] {
    return this.schedule.get(tick) ?? [];
  }
}
```

**Note:** `NoOpModeController` exposes `economy` as a `readonly` field. If TypeScript complains about the override, change the base class to use a getter (preferred) or make `economy` non-`readonly`. If the base change is too invasive, use composition instead of inheritance: store a `NoOpModeController` internally and delegate all methods. The test harness file must not break the `ModeController` interface — whichever approach keeps the base class cleanest is fine.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: clean. If `economy` override fails, switch to composition (store a private `NoOpModeController` field and implement the `ModeController` interface directly, forwarding calls).

- [ ] **Step 4: Run full suite to confirm the new files don't break anything**

Run: `pnpm test`

Expected: no behavior change since nothing uses the new harnesses yet.

- [ ] **Step 5: Commit**

```bash
git add tests/harness/test-economy.ts tests/harness/test-chaos-controller.ts
git commit -m "test(harness): add TestEconomyStrategy and TestChaosController"
```

---

## Task 11: Real `deductUpkeep` (step 7)

**Files:**
- Modify: `src/core/engine/stubs.ts`
- Create: `tests/unit/deduct-upkeep.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/deduct-upkeep.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { deductUpkeep } from "@core/engine/stubs";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import type { Capability } from "@core/capability/capability";
import { TestEconomyStrategy } from "@harness/test-economy";
import { TestChaosController } from "@harness/test-chaos-controller";

function makeCap(id: string, upkeep: number): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: (_tier: number) => upkeep,
  };
}

function makeComp(
  id: string,
  condition: number,
  upkeep: number,
  profile: ConditionProfile,
): Component {
  const cap = makeCap("c", upkeep);
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map([[cap.id, cap]]),
    initialTiers: new Map([[cap.id, 1]]),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
    initialCondition: condition,
  });
}

const healthyProfile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [{ kind: "upkeep_multiplier", factor: 2 }],
  criticalEffects: [{ kind: "upkeep_multiplier", factor: 4 }],
};

describe("deductUpkeep", () => {
  it("sums base upkeep with no multipliers", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("a", 1.0, 10, healthyProfile));
    state.placeComponent(makeComp("b", 1.0, 20, healthyProfile));
    const economy = new TestEconomyStrategy({ budget: 1000 });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);

    expect(economy.debitLog).toEqual([30]);
    expect(state.upkeepPaidThisTick).toBe(30);
  });

  it("applies upkeep_multiplier from condition effects", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("a", 0.5, 10, healthyProfile)); // degraded → 2x
    state.placeComponent(makeComp("b", 0.1, 20, healthyProfile)); // critical → 4x
    const economy = new TestEconomyStrategy({ budget: 1000 });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);

    expect(economy.debitLog).toEqual([10 * 2 + 20 * 4]); // 100
    expect(state.upkeepPaidThisTick).toBe(100);
  });

  it("writes condition=0 to every insolvent component", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const a = makeComp("a", 1.0, 10, healthyProfile);
    const b = makeComp("b", 1.0, 20, healthyProfile);
    state.placeComponent(a);
    state.placeComponent(b);
    const economy = new TestEconomyStrategy({
      budget: 1000,
      insolvencyRule: () => [a.id, b.id],
    });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);

    expect(a.condition).toBe(0);
    expect(b.condition).toBe(0);
  });

  it("does nothing to condition when insolvency returns []", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const a = makeComp("a", 0.8, 10, healthyProfile);
    state.placeComponent(a);
    const economy = new TestEconomyStrategy({ budget: 1000 });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);

    expect(a.condition).toBe(0.8);
  });

  it("calls debitUpkeep exactly once per tick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("a", 1.0, 5, healthyProfile));
    const economy = new TestEconomyStrategy({ budget: 1000 });
    const mc = new TestChaosController({ economy });

    deductUpkeep(state, mc);
    expect(economy.debitLog.length).toBe(1);
    deductUpkeep(state, mc);
    expect(economy.debitLog.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/deduct-upkeep.test.ts`

Expected: all assertions fail because `deductUpkeep` is still a no-op.

- [ ] **Step 3: Implement `deductUpkeep`**

Open `src/core/engine/stubs.ts`. Add imports:

```ts
import { computeEffectiveTiers } from "../component/effective-tier.js";
import { getUpkeepMultiplier } from "./condition-effects.js";
```

Replace the body:

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

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm test tests/unit/deduct-upkeep.test.ts`

Expected: all 5 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: no regressions. Stage 2a tests use `NoOpEconomy.debitUpkeep` which is a silent noop — they'll now receive a call with a real total, but they don't assert on it.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/stubs.ts tests/unit/deduct-upkeep.test.ts
git commit -m "feat(engine): implement deductUpkeep with multiplier + insolvency"
```

---

## Task 12: Revenue crediting at RESPONDED

**Files:**
- Modify: `src/core/engine/deliver-staged.ts`
- Create: `tests/unit/revenue-crediting.test.ts` (partial — Task 13 adds more)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/revenue-crediting.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId, RequestId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import type { Request } from "@core/types/request";
import { RespondingCapability } from "@harness/test-capabilities";
import { TestEconomyStrategy } from "@harness/test-economy";
import { TestChaosController } from "@harness/test-chaos-controller";

const healthy: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [],
  criticalEffects: [],
};

function makeRespondingComp(id: string): Component {
  const cap = new RespondingCapability("resp" as CapabilityId);
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map<CapabilityId, RespondingCapability>([[cap.id, cap]]),
    initialTiers: new Map<CapabilityId, number>([[cap.id, 1]]),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: healthy,
    initialCondition: 1.0,
  });
}

function makeReq(id: string, originId: ComponentId): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: originId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("revenue crediting at RESPONDED", () => {
  it("credits a non-stream root request exactly once", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    state.enqueuePending(comp.id, makeReq("r1", comp.id));
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 7,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(1);
    expect(economy.creditLog[0]?.amount).toBe(7);
    expect(state.metricsHistory[0]?.revenueEarned).toBe(7);
  });

  it("accumulates across multiple responses in one tick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    state.enqueuePending(comp.id, makeReq("r1", comp.id));
    state.enqueuePending(comp.id, makeReq("r2", comp.id));
    state.enqueuePending(comp.id, makeReq("r3", comp.id));
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 5,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(3);
    expect(state.metricsHistory[0]?.revenueEarned).toBe(15);
  });

  it("does NOT credit a child request", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    const req = makeReq("child", comp.id);
    state.enqueuePending(comp.id, req);
    // Mark as child of a fake parent.
    state.childToParent.set(req.id, "parent" as RequestId);
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 99,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(0);
    expect(state.metricsHistory[0]?.revenueEarned).toBe(0);
  });

  it("resets revenueEarnedThisTick after metrics snapshot", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    state.enqueuePending(comp.id, makeReq("r1", comp.id));
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 3,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(state.metricsHistory[0]?.revenueEarned).toBe(3);
    expect(state.revenueEarnedThisTick).toBe(0); // cleared by resetPerTickState
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/revenue-crediting.test.ts`

Expected: all 4 tests fail — `revenueEarned` is still hardcoded to 0 in `metrics-builder.ts` (Task 14 will fix that — for now the accumulator just stays unused). Actually, depending on Task 14's ordering, it's cleaner to do Task 14 before or alongside this. Let's do this one first, and accept that `state.metricsHistory[0]?.revenueEarned` will still be 0 until Task 14 — adjust these assertions to check `economy.creditLog` and `state.revenueEarnedThisTick` until Task 14, then uncomment the metric assertions.

**Simpler approach:** assert on `economy.creditLog` here (observes direct calls, not metric side effect), and defer the `metricsHistory[0]?.revenueEarned` assertions until Task 14. Rewrite each assertion to use `economy.creditLog.reduce((s, e) => s + e.amount, 0)` instead of reading from metrics. That way this task owns crediting semantics and Task 14 owns metric wiring — clean separation.

Update the tests above: replace any `state.metricsHistory[0]?.revenueEarned` assertion with a call-log sum:

```ts
    const totalCredited = economy.creditLog.reduce((s, e) => s + e.amount, 0);
    expect(totalCredited).toBe(7); // (or 15, etc.)
```

Leave the last test's `state.revenueEarnedThisTick` assertion as-is (it checks the reset behavior, which works regardless of metric wiring — but only if `revenueEarnedThisTick` was set and then cleared, which requires crediting to actually touch it).

- [ ] **Step 3: Implement RESPONDED crediting in `deliver-staged.ts`**

Open `src/core/engine/deliver-staged.ts`. Find the RESPOND branch, specifically the block that emits the `RESPONDED` event (around line 118). Immediately after the `appendEvent(..., type: "RESPONDED", ...)` call and before any cascade/blocked-parent handling, add:

```ts
      if (
        request.streamDuration == null &&
        !state.childToParent.has(request.id)
      ) {
        const credited = modeController.economy.creditRevenue(request);
        state.revenueEarnedThisTick += credited;
      }
```

**Where is `modeController` in scope?** `deliverStaged` receives a `ModeController` parameter (check the function signature — Stage 2a already threads it through). If the variable is named `mc` or similar, use that name. If no `ModeController` parameter exists on `deliverStaged`, add one and update the call site in `processPending` / `runFixedPointLoop`. Search for existing uses of `modeController` or `mc` within `deliver-staged.ts` to confirm.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm test tests/unit/revenue-crediting.test.ts`

Expected: all 4 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: no regressions. Stage 2a tests use `NoOpEconomy.creditRevenue` which returns 0 — `revenueEarnedThisTick += 0` is a no-op on behavior.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/deliver-staged.ts tests/unit/revenue-crediting.test.ts
git commit -m "feat(engine): credit revenue at RESPONDED for non-stream root requests"
```

---

## Task 13: Revenue crediting at STREAM_COMPLETED

**Files:**
- Modify: `src/core/engine/active-streams.ts`
- Modify: `tests/unit/revenue-crediting.test.ts` (append cases)

- [ ] **Step 1: Append stream-crediting tests**

Add to `tests/unit/revenue-crediting.test.ts` (inside the existing `describe` or in a new `describe("stream revenue", ...)` block):

```ts
import { StreamRespondingCapability } from "@harness/test-capabilities";
// ... or whichever existing test helper creates stream requests and
// responds with RESPOND (triggering STREAM_STARTED). If no such helper
// exists, inline-construct an ActiveStream directly and drive the
// updateActiveStreams step by running engine ticks.

describe("revenue crediting at STREAM_COMPLETED", () => {
  it("credits stream revenue at completion, not at STREAM_STARTED", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    // Construct an ActiveStream directly (simulating a prior tick's RESPOND).
    const req: Request = {
      ...makeReq("s1", comp.id),
      streamDuration: 3,
      streamBandwidth: 5,
    };
    state.registerActiveStream({
      requestId: req.id,
      connectionId: "conn-a" as any,
      originComponentId: comp.id,
      baseRevenue: 0,
      request: req,
      remainingDuration: 1,
      reservedBandwidth: 5,
    });
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 42,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(1);
    expect(economy.creditLog[0]?.amount).toBe(42);
  });

  it("does NOT credit a stream that is still running", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    const req: Request = { ...makeReq("s1", comp.id), streamDuration: 3, streamBandwidth: 5 };
    state.registerActiveStream({
      requestId: req.id,
      connectionId: "conn-a" as any,
      originComponentId: comp.id,
      baseRevenue: 0,
      request: req,
      remainingDuration: 5, // still running
      reservedBandwidth: 5,
    });
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 42,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(0);
  });

  it("does NOT credit a child stream", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    const req: Request = { ...makeReq("s1", comp.id), streamDuration: 3, streamBandwidth: 5 };
    state.childToParent.set(req.id, "parent" as RequestId);
    state.registerActiveStream({
      requestId: req.id,
      connectionId: "conn-a" as any,
      originComponentId: comp.id,
      baseRevenue: 0,
      request: req,
      remainingDuration: 1,
      reservedBandwidth: 5,
    });
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 42,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/revenue-crediting.test.ts`

Expected: the first stream test fails — currently `updateActiveStreams` does not call `creditRevenue`.

- [ ] **Step 3: Add crediting to `updateActiveStreams`**

Open `src/core/engine/active-streams.ts`. The function already receives `_modeController` as the second param (Task 3 added it). Rename to `modeController` (remove the underscore) and add the credit call inside the `remainingDuration <= 0` branch, after the `appendEvent` call:

```ts
import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";

export function updateActiveStreams(
  state: SimulationState,
  modeController: ModeController,
): void {
  const streams = [...state.activeStreams.values()];
  for (const stream of streams) {
    stream.remainingDuration -= 1;
    if (stream.remainingDuration <= 0) {
      state.releaseActiveStream(stream.requestId);
      state.appendEvent(stream.requestId, {
        tick: state.currentTick,
        componentId: stream.originComponentId,
        capabilityId: null,
        connectionId: stream.connectionId,
        type: "STREAM_COMPLETED",
        latencyAdded: 0,
      });
      if (!state.childToParent.has(stream.requestId)) {
        const credited = modeController.economy.creditRevenue(stream.request);
        state.revenueEarnedThisTick += credited;
      }
    }
  }
}
```

Note the child guard mirrors the RESPONDED site. No `streamDuration == null` guard here — this function only fires for already-registered streams, so all requests that reach it are streams by definition.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm test tests/unit/revenue-crediting.test.ts`

Expected: all tests pass (both the Task 12 tests and the new Task 13 tests).

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/active-streams.ts tests/unit/revenue-crediting.test.ts
git commit -m "feat(engine): credit stream revenue at STREAM_COMPLETED"
```

---

## Task 14: `metrics-builder` — real `revenueEarned`, `upkeepPaid`, per-component `condition`

**Files:**
- Modify: `src/core/engine/metrics-builder.ts`
- Extend: `tests/unit/revenue-crediting.test.ts` (re-enable metric assertions)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/revenue-crediting.test.ts` a targeted metrics-wiring test:

```ts
describe("metrics-builder wires real economy values", () => {
  it("populates revenueEarned, upkeepPaid, and per-component condition", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    state.enqueuePending(comp.id, makeReq("r1", comp.id));
    const economy = new TestEconomyStrategy({
      budget: 100,
      revenuePerRequest: 11,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    const snap = state.metricsHistory[0];
    expect(snap?.revenueEarned).toBe(11);
    // upkeepPaid: RespondingCapability's getUpkeepCost. Whatever the
    // harness returns, it must be what ends up in the metric.
    expect(snap?.upkeepPaid).toBe(economy.debitLog.reduce((s, d) => s + d, 0));
    expect(snap?.perComponent.get(comp.id)?.condition).toBe(comp.condition);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test tests/unit/revenue-crediting.test.ts`

Expected: the new metrics test fails — `revenueEarned` and `upkeepPaid` are still hardcoded to 0 in the snapshot.

- [ ] **Step 3: Wire real values in `metrics-builder.ts`**

Open `src/core/engine/metrics-builder.ts`. Replace the per-component `condition: 1.0` line. Find:

```ts
      condition: 1.0,
```

Replace with:

```ts
      condition: state.components.get(id)?.condition ?? 1.0,
```

Then replace the snapshot field hardcodes. Find:

```ts
    revenueEarned: 0,
    upkeepPaid: 0,
```

Replace with:

```ts
    revenueEarned: state.revenueEarnedThisTick,
    upkeepPaid: state.upkeepPaidThisTick,
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm test tests/unit/revenue-crediting.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: no regressions. Stage 2a tests do not assert on `condition` or the economy fields (they were 0/1.0 defaults), so populating them with real values does not change any existing assertion.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/metrics-builder.ts tests/unit/revenue-crediting.test.ts
git commit -m "feat(engine): metrics-builder returns real revenue/upkeep/condition"
```

---

## Task 15: Integration test — economic death spiral

**Files:**
- Create: `tests/integration/2b-economic-death-spiral.test.ts`

This is the one end-to-end test that confirms the economy loop closes. It sets up a single processing component with a finite budget, drives traffic through it, and watches the feedback loop: traffic spike → drops → condition decay → upkeep rise → insolvency → condition zero → every request drops → revenue zero.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/2b-economic-death-spiral.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId, RequestId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import type { Request } from "@core/types/request";
import { RespondingCapability } from "@harness/test-capabilities";
import { TestEconomyStrategy } from "@harness/test-economy";
import { TestChaosController } from "@harness/test-chaos-controller";

// A profile that decays fast and recovers slowly, with aggressive
// upkeep multipliers so the budget tips over quickly.
const deathSpiralProfile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.2,
  recoveryRate: 0.05,
  degradedEffects: [
    { kind: "upkeep_multiplier", factor: 2 },
    { kind: "drop_probability", p: 0.5 },
  ],
  criticalEffects: [
    { kind: "upkeep_multiplier", factor: 4 },
    { kind: "drop_probability", p: 1.0 },
  ],
};

function makeComp(id: string, throughput: number, upkeep: number): Component {
  const cap = new RespondingCapability("resp" as CapabilityId, {
    throughputPerTier: throughput,
    upkeepPerTier: upkeep,
  });
  return new Component({
    id: id as ComponentId,
    type: "server",
    name: id,
    description: "",
    capabilities: new Map<CapabilityId, RespondingCapability>([[cap.id, cap]]),
    initialTiers: new Map<CapabilityId, number>([[cap.id, 1]]),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: deathSpiralProfile,
    initialCondition: 1.0,
  });
}

function makeReq(id: string, origin: ComponentId, tick: number): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin,
    createdAt: tick,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("Stage 2b — economic death spiral", () => {
  it("closes the condition → upkeep → insolvency → condition loop", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComp("server", /*throughput=*/ 3, /*upkeep=*/ 10);
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);

    const economy = new TestEconomyStrategy({
      budget: 40, // enough for ~4 ticks of base upkeep
      revenuePerRequest: 5,
      insolvencyRule: (s) =>
        (s as unknown as { ___budget?: number }).___budget != null
          ? []
          : economy.budget < 0
          ? [comp.id]
          : [],
    });
    const mc = new TestChaosController({ economy });
    const engine = new Engine(state);

    // Phase 1: ticks 0..4 — sustainable. 3 requests in, 3 processed,
    // 15 revenue - 10 upkeep = +5/tick. Budget climbs.
    for (let t = 0; t < 5; t++) {
      state.enqueuePending(comp.id, makeReq(`r${t}a`, comp.id, t));
      state.enqueuePending(comp.id, makeReq(`r${t}b`, comp.id, t));
      state.enqueuePending(comp.id, makeReq(`r${t}c`, comp.id, t));
      engine.tick(mc);
    }
    expect(comp.condition).toBe(1.0);
    expect(economy.budget).toBeGreaterThan(40);

    // Phase 2: tick 5 — traffic spike (10 req vs throughput 3).
    // 3 processed, 7 queued. On tick 6 those 7 become overloaded/dropped.
    for (let i = 0; i < 10; i++) {
      state.enqueuePending(comp.id, makeReq(`spike${i}`, comp.id, 5));
    }
    engine.tick(mc); // tick 5: 3 processed, 7 still pending (will overload next tick)

    // Phase 3: tick 6 — drops happen, condition decays.
    engine.tick(mc);
    expect(comp.condition).toBeLessThan(1.0);

    // Phase 4: ticks 7..15 — upkeep multiplier kicks in, budget burns down.
    const earlyBudget = economy.budget;
    for (let t = 7; t <= 15; t++) {
      // Keep some pressure on.
      state.enqueuePending(comp.id, makeReq(`p${t}`, comp.id, t));
      engine.tick(mc);
    }

    // The loop should have closed: condition degraded, budget fell, and
    // at some point insolvency flipped condition to 0.
    expect(economy.budget).toBeLessThan(earlyBudget);
    expect(comp.condition).toBeLessThanOrEqual(deathSpiralProfile.degradedThreshold);

    // Metrics history should show non-zero upkeepPaid and revenueEarned
    // across the run.
    const totalUpkeep = state.metricsHistory.reduce((s, m) => s + m.upkeepPaid, 0);
    const totalRevenue = state.metricsHistory.reduce((s, m) => s + m.revenueEarned, 0);
    expect(totalUpkeep).toBeGreaterThan(0);
    expect(totalRevenue).toBeGreaterThan(0);
  });

  it("is deterministic across two runs with the same seed", () => {
    function run(): { conditions: number[]; budgets: number[] } {
      const state = new SimulationState({ zones: [], pairLatency: new Map() });
      const comp = makeComp("server", 3, 10);
      state.placeComponent(comp);
      state.visitOrder.push(comp.id);
      const economy = new TestEconomyStrategy({
        budget: 40,
        revenuePerRequest: 5,
        insolvencyRule: () => (economy.budget < 0 ? [comp.id] : []),
      });
      const mc = new TestChaosController({ economy });
      const engine = new Engine(state);
      const conditions: number[] = [];
      const budgets: number[] = [];
      for (let t = 0; t < 15; t++) {
        const reqCount = t < 5 ? 3 : 10;
        for (let i = 0; i < reqCount; i++) {
          state.enqueuePending(comp.id, makeReq(`t${t}i${i}`, comp.id, t));
        }
        engine.tick(mc);
        conditions.push(comp.condition);
        budgets.push(economy.budget);
      }
      return { conditions, budgets };
    }

    const a = run();
    const b = run();
    expect(a.conditions).toEqual(b.conditions);
    expect(a.budgets).toEqual(b.budgets);
  });
});
```

**Note on `RespondingCapability` options:** this test uses `{ throughputPerTier, upkeepPerTier }`. If those options don't exist on the harness capability, either (a) extend `RespondingCapability` to accept them (small change in `tests/harness/test-capabilities.ts`), or (b) define a local test capability in this file. Prefer option (a) — other tests benefit.

- [ ] **Step 2: Run and iterate**

Run: `pnpm test tests/integration/2b-economic-death-spiral.test.ts`

Expected: the test may need iteration on exact tick counts and thresholds. The goal is to demonstrate the loop *closes*, not to hit precise numbers. Adjust `revenuePerRequest`, `upkeepPerTier`, and `throughputPerTier` until the feedback loop is visible.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`

Expected: ~300 tests passing.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/2b-economic-death-spiral.test.ts tests/harness/test-capabilities.ts
git commit -m "test(integration): Stage 2b economic death spiral"
```

(Include `test-capabilities.ts` in the commit only if Step 2's iteration required extending it.)

---

## Task 16: Final verification pass

**Files:** none modified — this is a pure verification task.

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`

Expected: clean, no errors.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`

Expected: all tests pass. Target count: ~300 (267 Stage 2a + ~35 Stage 2b unit tests + 2 integration cases + 3 state fixture cases).

- [ ] **Step 3: Confirm Stage 2a invariants still hold**

Run the following Stage 2a test files individually to confirm no drift:

```bash
pnpm test tests/unit/engine-tick-ordering.test.ts
pnpm test tests/unit/process-pending.test.ts
pnpm test tests/unit/deliver-staged.test.ts
pnpm test tests/integration/
```

Expected: every file passes.

- [ ] **Step 4: Verify the grep invariant for latency reads**

This is already enforced by the test from Task 8, but double-check visually:

Run: `pnpm test tests/unit/effective-latency.test.ts -t "grep invariant"`

Expected: the grep test passes, confirming only `effective-bandwidth.ts` reads `.latency` on a `Connection` inside `src/core/engine/`.

- [ ] **Step 5: Manual review checklist**

Open `src/core/engine/stubs.ts` and confirm:
- `updateCondition` is fully implemented (not a no-op)
- `injectChaos` is fully implemented (not a no-op)
- `deductUpkeep` is fully implemented (not a no-op)
- No `TODO(stage-2b)` comments remain

Open `src/core/engine/metrics-builder.ts` and confirm:
- `revenueEarned: state.revenueEarnedThisTick` (not 0)
- `upkeepPaid: state.upkeepPaidThisTick` (not 0)
- Per-component `condition` reads from `state.components.get(id)?.condition`

Open `src/core/types/stream.ts` and confirm:
- `ActiveStream` has `readonly request: Request`

- [ ] **Step 6: Commit (marker-only, if needed)**

No file changes needed — this task is verification only. If your team wants a marker commit, use:

```bash
git commit --allow-empty -m "chore(stage-2b): verification pass complete"
```

Otherwise skip the empty commit and move on.

---

## Appendix: Spec coverage check

Every requirement in §2 (Goals) of the spec maps to at least one task:

| Goal | Tasks |
|------|-------|
| 1. Condition decays/recovers and is in metrics | 4, 14 |
| 2. Each `ConditionEffect` kind has one application site | 2 (module), 7 (latency), 9 (throughput + drop), 11 (upkeep) |
| 3. Each `ChaosEvent` kind flows through `getScheduledChaos`/`activeChaos` | 5 (injection), 6 (bandwidth), 7 (latency) |
| 4. `deductUpkeep` sums real upkeep + insolvency | 11 |
| 5. Successful responses credit revenue | 12 (non-stream), 13 (stream) |
| 6. `revenueEarned`, `upkeepPaid`, per-component `condition` are real | 14 |
| 7. No external interface changes | enforced across all tasks; only `ActiveStream` field + internal `EngineSteps.updateActiveStreams` signature change (Task 3) |

Every file listed in §4 of the spec's File Map appears in at least one task's `Modify:` / `Create:` section.

## Appendix: Known deviations from the spec

- **Task 9 (drop probability)** uses a per-request RNG key (`tick-N|comp-id|drop|req-id`) instead of sharing the process-context RNG. The spec does not mandate which, but this decision is intentional: it preserves Stage 2a replay determinism for healthy components.
- **Task 3** parks `_modeController` as an unused parameter on `updateActiveStreams` to decouple the plumbing change from the credit call added in Task 13. Some teams prefer doing both in one commit; splitting them makes git blame cleaner.
- **Task 15** iteration-driven — the precise tick counts and balance numbers will need tuning during implementation.

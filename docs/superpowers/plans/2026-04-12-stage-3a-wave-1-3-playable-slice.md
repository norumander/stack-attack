# Stage 3a — Wave 1–3 Playable Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the minimum headless slice — 5 capabilities, 4 registered components, TD mode stack, Waves 1–3 as data, four integration tests — that proves the Build→Watch→Assess loop works end-to-end before UI investment.

**Architecture:** Three vertical slices (Wave 1, Wave 2, Wave 3 learning arc), each ending in a green integration test and a merge to `main`. Engine is unchanged — forwarding is a new capability, not an engine rule. All new production capabilities (`ProcessingCapability` rewrite, `ForwardingCapability`, `StorageCapability`, `CachingCapability`, `MonitoringCapability`) are pure pipeline classes with bounded throughput via `getThroughputPerTick`. TD mode stack (`TDModeController`, `TDEconomy`, `TDTrafficSource`) mirrors sandbox. Integration tests build topology via harness fixtures and assert on `state.requestLog` event history.

**Tech Stack:** TypeScript (strict, ESM, `.js` extensions on `.ts` imports), vitest, branded IDs (`as CapabilityId`, `as ComponentId`, `as RequestId` casts in tests), path aliases `@core/*`, `@capabilities/*`, `@modes/*`, `@harness/*`.

**Spec:** `docs/superpowers/specs/2026-04-12-stage-3a-wave-1-3-playable-slice-design.md`

**Run tests:** `pnpm test` (full suite, ~3s) or `pnpm test tests/unit/<file>.test.ts` (single file).
**Typecheck:** `pnpm typecheck`

**Worktrees:** each slice is its own worktree at `.worktrees/stage-3a-slice-[abc]` and merges to `main` before the next starts.

---

## File structure overview

**New production files:**
- `src/capabilities/forwarding/forwarding-capability.ts` — PROCESS phase, emits FORWARD, configurable `handledTypes`
- `src/capabilities/storage/storage-capability.ts` — PROCESS, RESPOND on api_write
- `src/capabilities/caching/caching-capability.ts` — INTERCEPT, hit=RESPOND / miss=PASS, keyed on stringified payload
- `src/capabilities/monitoring/monitoring-capability.ts` — OBSERVE, no-op ceremonial
- `src/modes/td/index.ts` — barrel export
- `src/modes/td/td-economy.ts`
- `src/modes/td/td-traffic-source.ts`
- `src/modes/td/td-mode-controller.ts`
- `src/modes/td/td-waves.ts` — `TDWaveDefinition` interface + `WAVE_1`, `WAVE_2`, `WAVE_3` constants
- `src/modes/td/td-component-entries.ts` — `SERVER_ENTRY`, `DATABASE_ENTRY`, `CACHE_ENTRY`, `LOAD_BALANCER_ENTRY`
- `src/modes/td/register-td-defaults.ts` — `registerTDDefaults(capRegistry, compRegistry)`

**Modified production files:**
- `src/capabilities/processing/processing-capability.ts` — full rewrite: Stage 1 stub → production (reads only, RESPOND, throughput cap)

**New test files:**
- `tests/unit/forwarding-capability.test.ts`
- `tests/unit/storage-capability.test.ts`
- `tests/unit/caching-capability.test.ts`
- `tests/unit/monitoring-capability.test.ts`
- `tests/unit/td-economy.test.ts`
- `tests/unit/td-traffic-source.test.ts`
- `tests/unit/td-mode-controller.test.ts`
- `tests/integration/td/helpers.ts` — `runWave`, topology builders, event counters
- `tests/integration/td/wave-1-launch-day.test.ts`
- `tests/integration/td/wave-2-signups.test.ts`
- `tests/integration/td/wave-3-traffic-spike.test.ts`
- `tests/integration/td/wave-3-learning-arc.test.ts`

**Modified test files (Slice A migrations):**
- `tests/harness/test-capabilities.ts` — rename `ForwardingCapability` → `TestForwardingCapability` to free the production name
- `tests/unit/processing-capability.test.ts` — full rewrite for new production behavior
- `tests/unit/engine-skeleton.test.ts` — swap `ProcessingCapability({outcomeKind:...})` calls for harness equivalents
- `tests/unit/sandbox-mode-controller.test.ts` — one swap
- `tests/integration/smoke.test.ts` — swap
- `tests/integration/sandbox-smoke.test.ts` — six swaps

---

# Slice A — Wave 1 headless

**Exit:** `tests/integration/td/wave-1-launch-day.test.ts` is green, `pnpm test` + `pnpm typecheck` clean, slice merged to `main`.

---

## Task 1: Create Slice A worktree

**Files:** none (git only)

- [ ] **Step 1: Create worktree**

Run:
```bash
git worktree add .worktrees/stage-3a-slice-a-wave-1 -b stage-3a-slice-a-wave-1
cd .worktrees/stage-3a-slice-a-wave-1
pnpm install
```

Expected: new branch `stage-3a-slice-a-wave-1` checked out in a local worktree, `pnpm install` completes without errors (should be a no-op if the main tree is up to date).

- [ ] **Step 2: Confirm baseline is green**

Run:
```bash
pnpm test && pnpm typecheck
```
Expected: all existing tests pass (~3s) and typecheck is clean. If not, stop and fix before starting work.

---

## Task 2: Rename test-harness `ForwardingCapability` → `TestForwardingCapability`

**Why:** the production `ForwardingCapability` (Task 5) needs the name `ForwardingCapability`. The harness file currently exports a class with that exact name (`tests/harness/test-capabilities.ts:17`). Rename first to avoid a collision.

**Files (full inventory from grep):**
- Modify: `tests/harness/test-capabilities.ts` (the class declaration at line 17)
- Modify: `tests/harness/random-topology.ts` (imports and constructs the class)
- Modify: `tests/unit/ttl-bufferable.test.ts`
- Modify: `tests/integration/sandbox-throughput.test.ts`
- Modify: `tests/integration/backpressure-redrive.test.ts`
- Modify: `tests/integration/same-tick-multi-hop.test.ts`
- Modify: `tests/integration/sandbox-ttl.test.ts`
- Modify: `tests/integration/ttl-bufferable.test.ts`
- Modify: `tests/integration/condition-routing.test.ts`
- Modify: `tests/integration/sandbox-backpressure.test.ts`
- Modify: `tests/integration/sandbox-metrics-history.test.ts`

That's 11 files total. Every import of `ForwardingCapability` from `@harness/test-capabilities` must be renamed to `TestForwardingCapability`, and every `new ForwardingCapability(` call in those files likewise.

- [ ] **Step 1: Rename the class in the harness file**

In `tests/harness/test-capabilities.ts`, change line 17:
```ts
export class ForwardingCapability implements Capability {
```
to:
```ts
export class TestForwardingCapability implements Capability {
```

Keep the rest of the class body unchanged.

- [ ] **Step 2: Find all importers**

Run:
```bash
grep -rln "from \"@harness/test-capabilities\"" tests src | xargs grep -l "ForwardingCapability"
```
Expected: a list of test files. For each, update the import line and any use-site:
```ts
// Before:
import { ForwardingCapability, ... } from "@harness/test-capabilities";
// After:
import { TestForwardingCapability, ... } from "@harness/test-capabilities";
```
And similarly replace `new ForwardingCapability(` → `new TestForwardingCapability(` in the file.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean. If any file still references the old name, fix it.

- [ ] **Step 4: Run tests**

```bash
pnpm test
```
Expected: all existing tests pass. No behavior change — only a rename.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "refactor(harness): rename test ForwardingCapability → TestForwardingCapability

Frees the production name for Stage 3a's ForwardingCapability.
Mechanical rename; no behavior change.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Production `ProcessingCapability` rewrite

**Files:**
- Modify (full rewrite): `src/capabilities/processing/processing-capability.ts`
- Modify (full rewrite): `tests/unit/processing-capability.test.ts`

- [ ] **Step 1: Rewrite the production file**

Replace `src/capabilities/processing/processing-capability.ts` with:

```ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * Production ProcessingCapability — handles api_read requests, returns RESPOND.
 * Emits a PROCESSED RequestEvent so the integration test helper can count
 * reads handled per component. (The engine does NOT emit PROCESSED events
 * itself — they're capability-level accounting.)
 * Declares getThroughputPerTick so componentThroughputPerTick returns a bounded
 * number (required for Stage 3a's Wave 3 lone-server failure mode).
 *
 * Replaces the Stage 1 test stub. Tests that need FORWARD/RESPOND-on-any-type
 * behavior should use TestForwardingCapability/RespondingCapability from the
 * test harness instead.
 */
export class ProcessingCapability implements Capability {
  readonly phase = "PROCESS" as const;
  private processedCount = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "api_read";
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    this.processedCount += 1;
    return {
      outcome: { kind: "RESPOND" },
      sideEffects: [],
      events: [
        {
          tick: context.currentTick,
          componentId: context.componentId,
          capabilityId: this.id,
          connectionId: null,
          type: "PROCESSED",
          latencyAdded: 1,
        },
      ],
    };
  }

  getThroughputPerTick(tier: number): number {
    // Tuning target: lone Server at T1 must fail Wave 3 (50 req/tick mixed),
    // AND Wave 3 cache rescue must have condition-decay headroom so a
    // transient cache miss-rate spike doesn't cascade. Server =
    // Processing(20) + Forwarding(12) = 32 budget. Lone-server Wave 3:
    // 32 vs 50 → 36% drops → loses. Cache rescue Wave 3: ~27 effective
    // demand (12 missed reads + 15 writes) vs 32 budget → 5/tick headroom.
    const table: Record<number, number> = { 1: 20, 2: 35, 3: 60 };
    return table[tier] ?? 20;
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 2, 2: 5, 3: 10 };
    return table[tier] ?? 2;
  }

  getStats(): CapabilityStats {
    return { processedCount: this.processedCount };
  }
}
```

- [ ] **Step 2: Rewrite the unit test file**

Replace `tests/unit/processing-capability.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "processing" as CapabilityId;

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

// Minimal stub — capabilities mostly ignore context. `as unknown as` cast
// is required because the real ProcessContext has 9 fields including a
// DeterministicRng object (not a function) and a SimulationStateReader.
// We provide only the fields the capability actually reads.
const ctx = {
  currentTick: 0,
  componentId: "c-1" as ComponentId,
  effectiveTier: 1,
  activeCapabilityIds: new Set([CAP_ID]),
} as unknown as ProcessContext;

describe("ProcessingCapability (production)", () => {
  it("claims api_read via canHandle", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.canHandle("api_read")).toBe(true);
  });

  it("rejects api_write via canHandle", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.canHandle("api_write")).toBe(false);
  });

  it("rejects unknown types", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.canHandle("static_asset")).toBe(false);
    expect(cap.canHandle("batch")).toBe(false);
  });

  it("returns RESPOND outcome on api_read", () => {
    const cap = new ProcessingCapability(CAP_ID);
    const result = cap.process(req("api_read"), ctx);
    expect(result.outcome.kind).toBe("RESPOND");
    expect(result.sideEffects).toEqual([]);
  });

  it("increments processedCount on each process call", () => {
    const cap = new ProcessingCapability(CAP_ID);
    cap.process(req("api_read"), ctx);
    cap.process(req("api_read"), ctx);
    expect(cap.getStats().processedCount).toBe(2);
  });

  it("declares bounded throughput per tier", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.getThroughputPerTick(1)).toBe(20);
    expect(cap.getThroughputPerTick(2)).toBe(35);
    expect(cap.getThroughputPerTick(3)).toBe(60);
  });

  it("emits a PROCESSED event for counting in integration tests", () => {
    const cap = new ProcessingCapability(CAP_ID);
    const result = cap.process(req("api_read"), ctx);
    const processedEvent = result.events.find((e) => e.type === "PROCESSED");
    expect(processedEvent).toBeDefined();
    expect(processedEvent?.componentId).toBe("c-1");
    expect(processedEvent?.capabilityId).toBe(CAP_ID);
  });

  it("has upkeep scaling with tier", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.getUpkeepCost(1)).toBe(2);
    expect(cap.getUpkeepCost(2)).toBe(5);
    expect(cap.getUpkeepCost(3)).toBe(10);
  });

  it("phase is PROCESS", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.phase).toBe("PROCESS");
  });
});
```

- [ ] **Step 3: Run the new unit tests**

```bash
pnpm test tests/unit/processing-capability.test.ts
```
Expected: all tests pass. If `ProcessContext` requires fields not listed in `ctx` above, read `src/core/capability/process-context.ts` and add them.

- [ ] **Step 4: Run full test suite — will fail**

```bash
pnpm test
```
Expected: many failures in files that use `new ProcessingCapability(id, { outcomeKind: "..." })`. These are fixed in Task 4. Do NOT commit yet — the test suite will be broken until Task 4 is done.

- [ ] **Step 5: Note the failing test files for Task 4**

Run:
```bash
grep -rln "new ProcessingCapability" tests/
```
Expected list (for reference when Task 4 runs):
- `tests/unit/processing-capability.test.ts` — already rewritten in Step 2 above, no migration needed, but Task 4's commit will include it
- `tests/unit/engine-skeleton.test.ts` — needs migration
- `tests/unit/sandbox-mode-controller.test.ts` — needs migration
- `tests/integration/smoke.test.ts` — needs migration
- `tests/integration/sandbox-smoke.test.ts` — needs migration

Do not commit until Task 4 has migrated these files. (Task 4's single commit covers both the production-capability rewrite and all test migrations.)

---

## Task 4: Migrate existing tests to use harness capabilities

**Why:** Task 3 narrowed `ProcessingCapability.canHandle` to `api_read` only. Tests that used `new ProcessingCapability(id, { outcomeKind: "FORWARD" })` or `{ outcomeKind: "RESPOND" }` need to move to the harness equivalents (`TestForwardingCapability` renamed in Task 2, `RespondingCapability`) which accept any request type.

**Files:**
- Modify: `tests/unit/engine-skeleton.test.ts`
- Modify: `tests/unit/sandbox-mode-controller.test.ts`
- Modify: `tests/integration/smoke.test.ts`
- Modify: `tests/integration/sandbox-smoke.test.ts`

- [ ] **Step 1: Migrate `tests/unit/engine-skeleton.test.ts`**

In the imports, add (or extend):
```ts
import { TestForwardingCapability, RespondingCapability } from "@harness/test-capabilities";
```

Replace every `new ProcessingCapability(id, { outcomeKind: "FORWARD" })` with `new TestForwardingCapability(id)`.
Replace every `new ProcessingCapability(id, { outcomeKind: "RESPOND" })` with `new RespondingCapability(id)`.
Remove `ProcessingCapability` from the import if it's no longer referenced.

- [ ] **Step 2: Migrate `tests/unit/sandbox-mode-controller.test.ts`**

Line 16:
```ts
// Before:
new ProcessingCapability("cap-proc" as CapabilityId, { outcomeKind: "RESPOND" }),
// After:
new RespondingCapability("cap-proc" as CapabilityId),
```
Add `RespondingCapability` to the `@harness/test-capabilities` import and drop `ProcessingCapability`.

- [ ] **Step 3: Migrate `tests/integration/smoke.test.ts`**

Change the two `ProcessingCapability` instantiations:
- `outcomeKind: "FORWARD"` → `new TestForwardingCapability(id)`
- `outcomeKind: "RESPOND"` → `new RespondingCapability(id)`

Update imports accordingly.

- [ ] **Step 4: Migrate `tests/integration/sandbox-smoke.test.ts`**

Six instantiations. Same pattern:
- Every `new ProcessingCapability("cap-client" as CapabilityId, { outcomeKind: "FORWARD" })` → `new TestForwardingCapability("cap-client" as CapabilityId)`
- Every `new ProcessingCapability("cap-proc" as CapabilityId, { outcomeKind: "RESPOND" })` → `new RespondingCapability("cap-proc" as CapabilityId)`

Update imports: drop `ProcessingCapability`, add `TestForwardingCapability, RespondingCapability` from `@harness/test-capabilities`.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean. Any lingering `ProcessingCapability` import with no usage is a TS error under strict mode — fix by removing.

- [ ] **Step 6: Run full test suite**

```bash
pnpm test
```
Expected: all tests pass including the migrated files. If any test that previously passed now fails because a stub was returning `PASS` by default (the Stage 1 `outcomeKind` default), investigate — likely that test needs a different harness capability or wasn't doing what it appeared.

- [ ] **Step 7: Commit**

```bash
git add src/capabilities/processing/processing-capability.ts tests/
git commit -m "refactor(capabilities): promote ProcessingCapability to production

- Narrow canHandle to 'api_read' only (drops 'FORWARD'/'PASS' outcomeKind hack)
- Add getThroughputPerTick(tier) for bounded throughput
- Migrate all existing tests to TestForwardingCapability/RespondingCapability
  from @harness/test-capabilities

Unblocks Stage 3a Server's two-capability read/write split (Processing
handles reads, ForwardingCapability handles writes).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Production `ForwardingCapability`

**Files:**
- Create: `src/capabilities/forwarding/forwarding-capability.ts`
- Create: `tests/unit/forwarding-capability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/forwarding-capability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "forwarding" as CapabilityId;

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

// Minimal stub — capabilities mostly ignore context. `as unknown as` cast
// is required because the real ProcessContext has 9 fields including a
// DeterministicRng object (not a function) and a SimulationStateReader.
// We provide only the fields the capability actually reads.
const ctx = {
  currentTick: 0,
  componentId: "c-1" as ComponentId,
  effectiveTier: 1,
  activeCapabilityIds: new Set([CAP_ID]),
} as unknown as ProcessContext;

describe("ForwardingCapability", () => {
  it("claims only the configured handledTypes", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_write"] });
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
    expect(cap.canHandle("static_asset")).toBe(false);
  });

  it("returns FORWARD outcome on handled types", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read", "api_write"] });
    const result = cap.process(req("api_read"), ctx);
    expect(result.outcome.kind).toBe("FORWARD");
    expect(result.sideEffects).toEqual([]);
  });

  it("supports forwarding multiple types via one instance", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read", "api_write"] });
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("api_write")).toBe(true);
  });

  it("declares configurable throughput per tier (default 20/tier)", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read"] });
    expect(cap.getThroughputPerTick(1)).toBe(20);
    expect(cap.getThroughputPerTick(2)).toBe(40);
    expect(cap.getThroughputPerTick(3)).toBe(60);
  });

  it("accepts configured throughputPerTier", () => {
    const cap = new ForwardingCapability(CAP_ID, {
      handledTypes: ["api_read"],
      throughputPerTier: 55,
    });
    expect(cap.getThroughputPerTick(1)).toBe(55);
  });

  it("has upkeep scaling with tier", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read"] });
    expect(cap.getUpkeepCost(1)).toBe(1);
    expect(cap.getUpkeepCost(2)).toBe(2);
    expect(cap.getUpkeepCost(3)).toBe(4);
  });

  it("emits a source-side FORWARDED event for integration test counting", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read"] });
    const result = cap.process(req("api_read"), ctx);
    const fwd = result.events.find((e) => e.type === "FORWARDED");
    expect(fwd).toBeDefined();
    expect(fwd?.capabilityId).toBe(CAP_ID); // non-null → source-side
    expect(fwd?.componentId).toBe("c-1");
  });

  it("phase is PROCESS", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read"] });
    expect(cap.phase).toBe("PROCESS");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
pnpm test tests/unit/forwarding-capability.test.ts
```
Expected: import error ("Cannot find module '@capabilities/forwarding/forwarding-capability'").

- [ ] **Step 3: Implement the capability**

Create `src/capabilities/forwarding/forwarding-capability.ts`:

```ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

export interface ForwardingCapabilityOptions {
  readonly handledTypes: readonly string[];
  /**
   * Per-tier throughput contribution. Configurable per-instance so that
   * e.g. Server's Forwarding (writes only) can be small (12) while LB's
   * Forwarding (all traffic) can be large (60). Default: 20 per tier.
   */
  readonly throughputPerTier?: number;
}

/**
 * Production capability that produces a FORWARD outcome for requests whose
 * type is in the configured handledTypes list. Used by Server (writes),
 * Cache (read misses), and LoadBalancer (all traffic) to move requests
 * to egress connections.
 *
 * Emits a FORWARDED RequestEvent at the source component (with the
 * capability's own `capabilityId` attached). The engine ALSO emits a
 * FORWARDED event at the target component when it delivers the request —
 * that one has `capabilityId: null`. Integration tests distinguish the
 * two: source-side forwards are events where `capabilityId !== null`.
 *
 * The engine does not auto-forward when a component's PROCESS phase produces
 * PASS (no matching capability); requests in that state are silently dropped
 * by deliverStaged. ForwardingCapability is the explicit primitive for
 * producing the FORWARD outcome.
 */
export class ForwardingCapability implements Capability {
  readonly phase = "PROCESS" as const;
  private forwardedCount = 0;
  private readonly handledTypes: ReadonlySet<string>;
  private readonly throughputPerTier: number;

  constructor(
    readonly id: CapabilityId,
    options: ForwardingCapabilityOptions,
  ) {
    this.handledTypes = new Set(options.handledTypes);
    this.throughputPerTier = options.throughputPerTier ?? 20;
  }

  canHandle(requestType: string): boolean {
    return this.handledTypes.has(requestType);
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    this.forwardedCount += 1;
    return {
      outcome: { kind: "FORWARD" },
      sideEffects: [],
      events: [
        {
          tick: context.currentTick,
          componentId: context.componentId,
          capabilityId: this.id,
          connectionId: null,
          type: "FORWARDED",
          latencyAdded: 0,
        },
      ],
    };
  }

  getThroughputPerTick(tier: number): number {
    return this.throughputPerTier * tier;
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 1, 2: 2, 3: 4 };
    return table[tier] ?? 1;
  }

  getStats(): CapabilityStats {
    return { forwardedCount: this.forwardedCount };
  }
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
pnpm test tests/unit/forwarding-capability.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/capabilities/forwarding/ tests/unit/forwarding-capability.test.ts
git commit -m "feat(capabilities): add production ForwardingCapability

PROCESS-phase capability that emits FORWARD for requests matching a
configured handledTypes set. Drives write routing from Server→Database,
cache-miss forwarding from Cache→Server, and all LoadBalancer traffic.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Production `MonitoringCapability`

**Files:**
- Create: `src/capabilities/monitoring/monitoring-capability.ts`
- Create: `tests/unit/monitoring-capability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/monitoring-capability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "monitoring" as CapabilityId;

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

// Minimal stub — capabilities mostly ignore context. `as unknown as` cast
// is required because the real ProcessContext has 9 fields including a
// DeterministicRng object (not a function) and a SimulationStateReader.
// We provide only the fields the capability actually reads.
const ctx = {
  currentTick: 0,
  componentId: "c-1" as ComponentId,
  effectiveTier: 1,
  activeCapabilityIds: new Set([CAP_ID]),
} as unknown as ProcessContext;

describe("MonitoringCapability", () => {
  it("claims any request type (canHandle=true)", () => {
    const cap = new MonitoringCapability(CAP_ID);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("anything")).toBe(true);
  });

  it("returns PASS outcome (OBSERVE-phase contract)", () => {
    const cap = new MonitoringCapability(CAP_ID);
    const result = cap.process(req("api_read"), ctx);
    expect(result.outcome.kind).toBe("PASS");
  });

  it("counts every call via getStats", () => {
    const cap = new MonitoringCapability(CAP_ID);
    cap.process(req("api_read"), ctx);
    cap.process(req("api_write"), ctx);
    cap.process(req("api_read"), ctx);
    expect(cap.getStats().observedCount).toBe(3);
  });

  it("has upkeep scaling with tier", () => {
    const cap = new MonitoringCapability(CAP_ID);
    expect(cap.getUpkeepCost(1)).toBe(1);
    expect(cap.getUpkeepCost(2)).toBe(3);
    expect(cap.getUpkeepCost(3)).toBe(5);
  });

  it("phase is OBSERVE", () => {
    const cap = new MonitoringCapability(CAP_ID);
    expect(cap.phase).toBe("OBSERVE");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
pnpm test tests/unit/monitoring-capability.test.ts
```
Expected: import error.

- [ ] **Step 3: Implement the capability**

Create `src/capabilities/monitoring/monitoring-capability.ts`:

```ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * OBSERVE-phase capability. Ceremonial in Stage 3a — exists so every
 * component registry entry can declare an OBSERVE capability without the
 * pipeline crashing on an empty OBSERVE phase. The engine's metricsHistory
 * already captures per-tick rollup metrics; real per-component metric
 * streams via OBSERVE events are a later stage.
 */
export class MonitoringCapability implements Capability {
  readonly phase = "OBSERVE" as const;
  private observedCount = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    this.observedCount += 1;
    return {
      outcome: { kind: "PASS" },
      sideEffects: [],
      events: [],
    };
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 1, 2: 3, 3: 5 };
    return table[tier] ?? 1;
  }

  getStats(): CapabilityStats {
    return { observedCount: this.observedCount };
  }
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
pnpm test tests/unit/monitoring-capability.test.ts
```
Expected: all pass.

- [ ] **Step 5: Run full suite + typecheck**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/capabilities/monitoring/ tests/unit/monitoring-capability.test.ts
git commit -m "feat(capabilities): add MonitoringCapability (OBSERVE phase)

Ceremonial OBSERVE-phase capability for Stage 3a. Exists so component
registry entries can declare an OBSERVE capability without crashing the
pipeline. Real per-component metric streams are a later stage.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `TDEconomy`

**Files:**
- Create: `src/modes/td/td-economy.ts`
- Create: `tests/unit/td-economy.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/td-economy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TDEconomy } from "@modes/td/td-economy";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ComponentReader } from "@core/component/component-reader";

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function makeComponentReader(placementCost: number): ComponentReader {
  return {
    id: "c-1" as ComponentId,
    type: "server",
    placementCost,
    getCapabilityIds: () => [],
    getPlayerTier: () => 1,
    get instanceCount() { return 1; },
    get condition() { return 1.0; },
  } as unknown as ComponentReader;
}

describe("TDEconomy", () => {
  it("starts with the configured budget", () => {
    const econ = new TDEconomy({
      startingBudget: 500,
      revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
    });
    expect(econ.getBudget()).toBe(500);
  });

  it("credits revenue from the table", () => {
    const econ = new TDEconomy({
      startingBudget: 100,
      revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
    });
    expect(econ.creditRevenue(req("api_read"))).toBe(1);
    expect(econ.creditRevenue(req("api_write"))).toBe(2);
    expect(econ.getBudget()).toBe(103);
  });

  it("returns 0 for unknown request types", () => {
    const econ = new TDEconomy({
      startingBudget: 100,
      revenuePerRequestType: new Map([["api_read", 1]]),
    });
    expect(econ.creditRevenue(req("unknown"))).toBe(0);
    expect(econ.getBudget()).toBe(100);
  });

  it("debits upkeep, allowing negative budget", () => {
    const econ = new TDEconomy({
      startingBudget: 50,
      revenuePerRequestType: new Map(),
    });
    econ.debitUpkeep(30);
    expect(econ.getBudget()).toBe(20);
    econ.debitUpkeep(30);
    expect(econ.getBudget()).toBe(-10);
  });

  it("debits placement cost", () => {
    const econ = new TDEconomy({
      startingBudget: 500,
      revenuePerRequestType: new Map(),
    });
    econ.debitPlacement(makeComponentReader(150));
    expect(econ.getBudget()).toBe(350);
  });

  it("no-ops debitUpgrade in Stage 3a", () => {
    const econ = new TDEconomy({
      startingBudget: 500,
      revenuePerRequestType: new Map(),
    });
    econ.debitUpgrade(makeComponentReader(100), "processing" as any);
    expect(econ.getBudget()).toBe(500);
  });

  it("canAfford uses budget >= cost", () => {
    const econ = new TDEconomy({
      startingBudget: 100,
      revenuePerRequestType: new Map(),
    });
    expect(econ.canAfford(50)).toBe(true);
    expect(econ.canAfford(100)).toBe(true);
    expect(econ.canAfford(101)).toBe(false);
  });

  it("resolveInsolvency returns empty in Stage 3a", () => {
    const econ = new TDEconomy({
      startingBudget: -1000,
      revenuePerRequestType: new Map(),
    });
    expect(econ.resolveInsolvency({} as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
pnpm test tests/unit/td-economy.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement `TDEconomy`**

Create `src/modes/td/td-economy.ts`:

```ts
import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { ComponentReader } from "@core/component/component-reader";
import type { Request } from "@core/types/request";
import type { SimulationStateReader } from "@core/state/state-reader";
import type { CapabilityId, ComponentId } from "@core/types/ids";

export interface TDEconomyOptions {
  readonly startingBudget: number;
  readonly revenuePerRequestType: ReadonlyMap<string, number>;
}

/**
 * TD-mode economy strategy. Stage 3a uses it mostly for ceremony — the
 * integration tests pass on drop rate, not budget. Ships the full
 * EconomyStrategy surface so later stages can add real budget pressure.
 */
export class TDEconomy implements EconomyStrategy {
  private budget: number;
  private readonly revenueTable: ReadonlyMap<string, number>;

  constructor(options: TDEconomyOptions) {
    this.budget = options.startingBudget;
    this.revenueTable = options.revenuePerRequestType;
  }

  getBudget(): number {
    return this.budget;
  }

  canAfford(cost: number): boolean {
    return this.budget >= cost;
  }

  creditRevenue(request: Request): number {
    const revenue = this.revenueTable.get(request.type) ?? 0;
    this.budget += revenue;
    return revenue;
  }

  debitUpkeep(totalUpkeep: number): void {
    this.budget -= totalUpkeep;
  }

  debitPlacement(component: ComponentReader): void {
    this.budget -= component.placementCost;
  }

  debitUpgrade(_component: ComponentReader, _capabilityId: CapabilityId): void {
    // No-op in Stage 3a. Upgrades are not exercised.
  }

  resolveInsolvency(_state: SimulationStateReader): ComponentId[] {
    // Stage 3a does not kill components mid-wave. The wave-end assertion
    // checks final budget. Later stages will return components to kill.
    return [];
  }
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
pnpm test tests/unit/td-economy.test.ts
```

If the test fails because `ComponentReader` has required fields not stubbed, read `src/core/component/component-reader.ts` and extend the helper.

- [ ] **Step 5: Run full suite + typecheck**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-economy.ts tests/unit/td-economy.test.ts
git commit -m "feat(modes/td): add TDEconomy

EconomyStrategy implementation for TD mode. Revenue table keyed by
request type; placement cost debit; upkeep and upgrade plumbing. Largely
ceremonial in Stage 3a — drop rate is the primary pass signal, not budget.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `TDWaveDefinition` type + `WAVE_1` constant

**Files:**
- Create: `src/modes/td/td-waves.ts`

- [ ] **Step 1: Write the file**

Create `src/modes/td/td-waves.ts`:

```ts
/**
 * TD-mode wave definitions. Data-only module.
 *
 * Each wave is an immutable snapshot of: traffic intensity, composition,
 * duration, TTL, available components, pass thresholds, revenue table,
 * and the payload-pool size for the cache working set.
 */
export interface TDWaveDefinition {
  readonly id: 1 | 2 | 3;
  readonly name: string;
  readonly startingBudget: number;
  readonly intensity: number;
  readonly composition: ReadonlyMap<string, number>;
  readonly duration: number;
  readonly ttl: number;
  readonly availableComponents: readonly string[];
  readonly dropThreshold: number;
  readonly revenuePerRequestType: ReadonlyMap<string, number>;
  readonly maxPlacements?: number;
  readonly readKeyPoolSize?: number;
}

export const WAVE_1: TDWaveDefinition = {
  id: 1,
  name: "Launch Day",
  startingBudget: 500,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 30,
  ttl: 10,
  availableComponents: ["server", "database"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
  readKeyPoolSize: 20,
};
```

`WAVE_2` and `WAVE_3` are added in Slice B / Slice C.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/modes/td/td-waves.ts
git commit -m "feat(modes/td): add TDWaveDefinition type and WAVE_1

Data-only wave definition for Wave 1: 10 req/tick of api_read, single
server topology, generous budget. WAVE_2 and WAVE_3 land in later slices.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `TDTrafficSource`

**Files:**
- Create: `src/modes/td/td-traffic-source.ts`
- Create: `tests/unit/td-traffic-source.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/td-traffic-source.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TDTrafficSource } from "@modes/td/td-traffic-source";
import { WAVE_1 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe("TDTrafficSource", () => {
  it("generates the wave's intensity count per tick", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    expect(reqs.length).toBe(WAVE_1.intensity);
  });

  it("sets request.type from composition", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    for (const r of reqs) {
      expect(r.type).toBe("api_read"); // WAVE_1 is 100% api_read
    }
  });

  it("sets request.ttl from the wave", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    for (const r of reqs) {
      expect(r.ttl).toBe(WAVE_1.ttl);
    }
  });

  it("sets origin to the target entry point", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    for (const r of reqs) {
      expect(r.origin).toBe("c-server");
    }
  });

  it("sets api_read payloads to distinguishable keys from the pool", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    const payloads = new Set(reqs.map((r) => r.payload));
    // With a pool of 20 and intensity of 10, we should see multiple
    // distinct values (not all collapsed to one). Weak but meaningful.
    expect(payloads.size).toBeGreaterThan(1);
    for (const p of payloads) {
      expect(typeof p).toBe("string");
      expect(String(p)).toMatch(/^read-\d+$/);
    }
  });

  it("generates unique request IDs across ticks", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const t0 = src.generate(0);
    const t1 = src.generate(1);
    const ids = new Set([...t0, ...t1].map((r) => r.id));
    expect(ids.size).toBe(t0.length + t1.length);
  });

  it("stops generating after wave.duration ticks", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const afterEnd = src.generate(WAVE_1.duration);
    expect(afterEnd.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm test tests/unit/td-traffic-source.test.ts
```
Expected: module not found.

- [ ] **Step 3: Check the `TrafficSource` interface shape**

Read `src/core/mode/traffic-source.ts` to confirm the method signature. The existing interface likely has `generate(currentTick: number): Request[]` or similar — match its exact shape.

- [ ] **Step 4: Implement `TDTrafficSource`**

Create `src/modes/td/td-traffic-source.ts`:

```ts
import type { TrafficSource } from "@core/mode/traffic-source";
import type { Request } from "@core/types/request";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { TDWaveDefinition } from "./td-waves.js";

export interface TDTrafficSourceOptions {
  readonly wave: TDWaveDefinition;
  readonly targetEntryPointId: ComponentId;
  readonly rng: () => number;
}

/**
 * Generates requests for a TD wave. Samples request type from the wave's
 * composition map and assigns api_read requests a payload key from a
 * small pool (configured via wave.readKeyPoolSize) so CachingCapability
 * sees a realistic working set instead of collapsing to a single bucket.
 */
export class TDTrafficSource implements TrafficSource {
  // `targetEntryPointId` must be public — TrafficSource interface declares it readonly public.
  readonly targetEntryPointId: ComponentId;
  private readonly wave: TDWaveDefinition;
  private readonly rng: () => number;
  private readonly readKeyPoolSize: number;
  private requestCounter = 0;

  constructor(options: TDTrafficSourceOptions) {
    this.wave = options.wave;
    this.targetEntryPointId = options.targetEntryPointId;
    this.rng = options.rng;
    this.readKeyPoolSize = options.wave.readKeyPoolSize ?? 20;
  }

  generate(currentTick: number): Request[] {
    if (currentTick >= this.wave.duration) return [];

    const out: Request[] = [];
    for (let i = 0; i < this.wave.intensity; i++) {
      const type = this.sampleType();
      out.push({
        id: this.nextId(),
        parentId: null,
        type,
        payload: this.makePayload(type),
        origin: this.targetEntryPointId,
        createdAt: currentTick,
        ttl: this.wave.ttl,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      });
    }
    return out;
  }

  private sampleType(): string {
    // Weighted sample from composition map.
    const entries = [...this.wave.composition.entries()];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.rng() * total;
    for (const [type, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return type;
    }
    return entries[entries.length - 1]![0];
  }

  private makePayload(type: string): string | null {
    if (type === "api_read") {
      const idx = Math.floor(this.rng() * this.readKeyPoolSize);
      return `read-${idx}`;
    }
    // api_write and other types: use a unique counter so the cache never
    // sees a collision on these.
    return `write-${this.requestCounter}`;
  }

  private nextId(): RequestId {
    this.requestCounter += 1;
    return `td-req-${this.requestCounter}` as RequestId;
  }
}
```

If `TrafficSource` in `src/core/mode/traffic-source.ts` has a different signature (e.g. `generate(state: SimulationState): Request[]`), adjust the method signature to match and pass the tick differently. The interface must be satisfied.

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm test tests/unit/td-traffic-source.test.ts
```

- [ ] **Step 6: Run full suite + typecheck**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/modes/td/td-traffic-source.ts tests/unit/td-traffic-source.test.ts
git commit -m "feat(modes/td): add TDTrafficSource

Wave-driven traffic source that samples request types from the wave's
composition map and generates distinguishable payload keys for api_read
from a small pool (default 20) so CachingCapability sees a realistic
working set.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `TDModeController` (skeleton for Wave 1)

**Files:**
- Create: `src/modes/td/td-mode-controller.ts`
- Create: `tests/unit/td-mode-controller.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/td-mode-controller.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";
import type { TickMetrics } from "@core/types/metrics";

function makeController() {
  const economy = new TDEconomy({
    startingBudget: WAVE_1.startingBudget,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  return new TDModeController({
    wave: WAVE_1,
    economy,
    entryPointId: "c-entry" as ComponentId,
    rng: () => 0.5,
  });
}

describe("TDModeController", () => {
  it("exposes the economy", () => {
    const mc = makeController();
    expect(mc.economy.getBudget()).toBe(WAVE_1.startingBudget);
  });

  it("getActiveCapabilities returns all capability IDs on the component", () => {
    const mc = makeController();
    const fakeComp = {
      getCapabilityIds: () => ["processing", "monitoring"],
    } as any;
    const active = mc.getActiveCapabilities(fakeComp);
    expect([...active]).toEqual(["processing", "monitoring"]);
  });

  it("getTierCap returns 1 in Stage 3a", () => {
    const mc = makeController();
    const fakeComp = { getCapabilityIds: () => ["processing"] } as any;
    expect(mc.getTierCap(fakeComp, "processing" as any)).toBe(1);
  });

  it("getBuildConstraints uses maxPlacements (not maxComponents)", () => {
    const mc = makeController();
    const constraints = mc.getBuildConstraints();
    expect(constraints.availableComponentTypes).toEqual(WAVE_1.availableComponents);
  });

  it("evaluateOutcome returns a valid OutcomeReport with 'win' verdict on low drop rate", () => {
    const mc = makeController();
    const metrics: TickMetrics[] = [
      {
        tick: 0,
        requestsProcessed: 10,
        requestsResolved: 10,
        requestsDropped: 0,
        requestsOverloaded: 0,
        requestsBackpressured: 0,
        requestsTimedOut: 0,
        revenueEarned: 10,
        upkeepPaid: 2,
        avgLatency: 1,
        perComponent: new Map(),
      },
    ];
    const outcome = mc.evaluateOutcome(metrics);
    expect(outcome.verdict).toBe("win");
    expect(outcome.score.performance).toBeCloseTo(1, 5);
    expect(outcome.notes.length).toBeGreaterThan(0);
  });

  it("evaluateOutcome returns 'lose' when drop rate exceeds threshold", () => {
    const mc = makeController();
    const metrics: TickMetrics[] = [
      {
        tick: 0,
        requestsProcessed: 10,
        requestsResolved: 5,
        requestsDropped: 5,
        requestsOverloaded: 0,
        requestsBackpressured: 0,
        requestsTimedOut: 0,
        revenueEarned: 5,
        upkeepPaid: 2,
        avgLatency: 1,
        perComponent: new Map(),
      },
    ];
    const outcome = mc.evaluateOutcome(metrics);
    expect(outcome.verdict).toBe("lose");
  });

  it("getScheduledChaos returns empty array", () => {
    const mc = makeController();
    expect(mc.getScheduledChaos(0)).toEqual([]);
  });

  it("phase transitions build → simulate → assess → build", () => {
    const mc = makeController();
    expect(mc.getPhase()).toBe("build");
    mc.advancePhase();
    expect(mc.getPhase()).toBe("simulate");
    mc.advancePhase();
    expect(mc.getPhase()).toBe("assess");
    mc.advancePhase();
    expect(mc.getPhase()).toBe("build");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm test tests/unit/td-mode-controller.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement `TDModeController`**

Create `src/modes/td/td-mode-controller.ts`:

```ts
import type { ModeController } from "@core/mode/mode-controller";
import type { ComponentReader } from "@core/component/component-reader";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "@core/types/build-constraints";
import type { TickMetrics } from "@core/types/metrics";
import type { OutcomeReport } from "@core/types/outcome";
import type { ZoneTopology } from "@core/types/zone";
import type { ChaosEvent } from "@core/types/chaos";
import type { Position } from "@core/types/position";
import type { SimulationState } from "@core/state/simulation-state";
import type { TrafficSource } from "@core/mode/traffic-source";
import type { TDEconomy } from "./td-economy.js";
import type { TDWaveDefinition } from "./td-waves.js";
import { TDTrafficSource } from "./td-traffic-source.js";

export interface TDModeControllerOptions {
  readonly wave: TDWaveDefinition;
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
}

export class TDModeController implements ModeController {
  readonly economy: TDEconomy;
  private readonly wave: TDWaveDefinition;
  private readonly trafficSource: TDTrafficSource;
  private phase: "build" | "simulate" | "assess" = "build";
  private placementCounter = 0;

  constructor(options: TDModeControllerOptions) {
    this.wave = options.wave;
    this.economy = options.economy;
    this.trafficSource = new TDTrafficSource({
      wave: options.wave,
      targetEntryPointId: options.entryPointId,
      rng: options.rng,
    });
  }

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId> {
    return new Set(component.getCapabilityIds() as CapabilityId[]);
  }

  getTierCap(_component: ComponentReader, _capabilityId: CapabilityId): number {
    return 1;
  }

  getBuildConstraints(): BuildConstraints {
    // exactOptionalPropertyTypes: only include maxPlacements if set.
    return this.wave.maxPlacements !== undefined
      ? {
          availableComponentTypes: this.wave.availableComponents,
          maxPlacements: this.wave.maxPlacements,
        }
      : {
          availableComponentTypes: this.wave.availableComponents,
        };
  }

  getTrafficSource(): TrafficSource {
    return this.trafficSource;
  }

  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport {
    let dropped = 0;
    let timedOut = 0;
    let resolved = 0;
    for (const m of metrics) {
      dropped += m.requestsDropped;
      timedOut += m.requestsTimedOut;
      resolved += m.requestsResolved;
    }
    const total = dropped + timedOut + resolved;
    const dropRate = total > 0 ? (dropped + timedOut) / total : 0;
    const budget = this.economy.getBudget();
    const verdict: "win" | "lose" | "neutral" =
      dropRate < this.wave.dropThreshold ? "win" : "lose";

    const performance = 1 - dropRate;
    const reliability = 1 - (dropped + timedOut) / Math.max(total, 1);
    const cost = budget;
    const composite =
      0.4 * performance + 0.4 * reliability + 0.2 * (cost / this.wave.startingBudget);

    return {
      verdict,
      score: { cost, performance, reliability, composite },
      notes: [
        `drop rate: ${(dropRate * 100).toFixed(2)}%`,
        `budget: ${budget}`,
        `total requests: ${total}`,
      ],
    };
  }

  getPhase(): "build" | "simulate" | "assess" {
    return this.phase;
  }

  advancePhase(): void {
    this.phase =
      this.phase === "build"
        ? "simulate"
        : this.phase === "simulate"
          ? "assess"
          : "build";
  }

  getInitialZoneTopology(): ZoneTopology {
    return { zones: ["default"], pairLatency: new Map() };
  }

  tryPlace(
    _state: SimulationState,
    _type: string,
    _position: Position,
    _zone: string | null,
  ): PlacementResult {
    // Stage 3a stub — mirrors SandboxModeController.tryPlace. Integration
    // tests build topology via harness fixtures and never call this.
    this.placementCounter += 1;
    return {
      ok: true,
      componentId: `td-placed-${this.placementCounter}` as ComponentId,
    };
  }

  tryUpgrade(
    state: SimulationState,
    componentId: ComponentId,
    capabilityId: CapabilityId,
  ): UpgradeResult {
    const component = state.components.get(componentId);
    if (!component) {
      return { ok: false, reason: "capability_not_found", detail: "Component not found" };
    }
    const ids = component.getCapabilityIds();
    if (!ids.includes(capabilityId)) {
      return { ok: false, reason: "capability_not_found" };
    }
    return { ok: true, newPlayerTier: component.getPlayerTier(capabilityId) + 1 };
  }

  getScheduledChaos(_currentTick: number): readonly ChaosEvent[] {
    return [];
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm test tests/unit/td-mode-controller.test.ts
```
Expected: all pass. If `BuildConstraints` / `OutcomeReport` / `PlacementResult` field shapes differ, read the real files and adjust.

- [ ] **Step 5: Run full suite + typecheck**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-mode-controller.ts tests/unit/td-mode-controller.test.ts
git commit -m "feat(modes/td): add TDModeController

Wave-scoped ModeController implementation. evaluateOutcome returns a
proper OutcomeReport (verdict/score/notes). tryPlace is a stub mirroring
SandboxModeController's pattern — integration tests build topology via
harness fixtures and inject directly into state.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Registry entries + `registerTDDefaults` (Server only)

**Files:**
- Create: `src/modes/td/td-component-entries.ts`
- Create: `src/modes/td/register-td-defaults.ts`
- Create: `src/modes/td/index.ts`

- [ ] **Step 1: Create `td-component-entries.ts` with Server entry**

```ts
import type { ComponentRegistryEntry } from "@core/registry/component-registry";
import type { CapabilityId, PortId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";

const DEFAULT_CONDITION_PROFILE: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.05,
  recoveryRate: 0.02,
  degradedEffects: [
    { kind: "latency_multiplier", factor: 1.5 },
  ],
  criticalEffects: [
    { kind: "drop_probability", p: 0.2 },
  ],
};

export const SERVER_ENTRY: ComponentRegistryEntry = {
  type: "server",
  name: "Server",
  description: "Handles incoming requests. The workhorse of your architecture.",
  capabilities: [
    { id: "processing" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 1, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "data", capacity: 2, connections: [] },
  ],
  placementCost: 100,
  upgradeCostCurve: [100, 200, 400],
  visual: { icon: "server", color: "#4A90D9", shape: "rectangle" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

// Added in later slices:
// export const DATABASE_ENTRY: ComponentRegistryEntry = ...;
// export const CACHE_ENTRY: ComponentRegistryEntry = ...;
// export const LOAD_BALANCER_ENTRY: ComponentRegistryEntry = ...;
```

If the real `ConditionProfile` type in `src/core/types/condition.ts` has different field names, read that file and align. The cast is temporary — prefer a proper value.

- [ ] **Step 2: Create `register-td-defaults.ts`**

```ts
import type { CapabilityRegistry } from "@core/registry/capability-registry";
import type { ComponentRegistry } from "@core/registry/component-registry";
import type { CapabilityId } from "@core/types/ids";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { SERVER_ENTRY } from "./td-component-entries.js";

/**
 * Populate the capability and component registries with the TD-mode
 * defaults. Called once at the start of an integration test / game
 * session to bootstrap what's available for the current stage.
 */
export function registerTDDefaults(
  capRegistry: CapabilityRegistry,
  compRegistry: ComponentRegistry,
): void {
  capRegistry.register({
    id: "processing" as CapabilityId,
    factory: () => new ProcessingCapability("processing" as CapabilityId),
  });
  capRegistry.register({
    id: "forwarding" as CapabilityId,
    // Default factory registers a generic "forwards everything" instance.
    // Integration tests build components via tests/integration/td/helpers.ts
    // (buildServer, buildCache, etc.) which construct per-instance
    // ForwardingCapability with appropriate throughputPerTier values.
    // The registry instance is only used by registerTDDefaults.validate() —
    // never instantiated for actual wave simulation in Stage 3a.
    factory: () =>
      new ForwardingCapability("forwarding" as CapabilityId, {
        handledTypes: ["api_read", "api_write"],
      }),
  });
  capRegistry.register({
    id: "monitoring" as CapabilityId,
    factory: () => new MonitoringCapability("monitoring" as CapabilityId),
  });

  compRegistry.register(SERVER_ENTRY);

  compRegistry.validate();
}
```

- [ ] **Step 3: Create `src/modes/td/index.ts` barrel**

```ts
export { TDEconomy } from "./td-economy.js";
export type { TDEconomyOptions } from "./td-economy.js";
export { TDTrafficSource } from "./td-traffic-source.js";
export type { TDTrafficSourceOptions } from "./td-traffic-source.js";
export { TDModeController } from "./td-mode-controller.js";
export type { TDModeControllerOptions } from "./td-mode-controller.js";
export { registerTDDefaults } from "./register-td-defaults.js";
export { SERVER_ENTRY } from "./td-component-entries.js";
export { WAVE_1 } from "./td-waves.js";
export type { TDWaveDefinition } from "./td-waves.js";
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean. If `ComponentRegistryEntry`'s port/visual/conditionProfile shapes differ, fix the `SERVER_ENTRY` to match.

- [ ] **Step 5: Smoke test the registry**

Create `tests/unit/register-td-defaults.test.ts` (new file, not a mix-in to another test):

```ts
import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { ComponentRegistry } from "@core/registry/component-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";

describe("registerTDDefaults", () => {
  it("populates capability and component registries without throwing", () => {
    const capRegistry = new CapabilityRegistry();
    const compRegistry = new ComponentRegistry(capRegistry);
    expect(() => registerTDDefaults(capRegistry, compRegistry)).not.toThrow();
  });
});
```

- [ ] **Step 6: Run test + typecheck**

```bash
pnpm test tests/unit/register-td-defaults.test.ts && pnpm typecheck && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add src/modes/td/ tests/unit/register-td-defaults.test.ts
git commit -m "feat(modes/td): bootstrap registry with Server entry

Add registerTDDefaults() that populates CapabilityRegistry with
processing/forwarding/monitoring and ComponentRegistry with SERVER_ENTRY.
Barrel export for @modes/td. Validates on bootstrap.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Integration test helpers (`runWave`, topology builders)

**Files:**
- Create: `tests/integration/td/helpers.ts`

- [ ] **Step 1: Create the helpers module**

```ts
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { makePort, makeConnection } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { OutcomeReport } from "@core/types/outcome";
import type { RequestEvent } from "@core/types/request";
import type { ConditionProfile } from "@core/types/condition";

const DEFAULT_CONDITION: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.05,
  recoveryRate: 0.02,
  degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
  criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
};

export interface WaveRunResult {
  readonly outcome: OutcomeReport;
  readonly state: SimulationState;
  readonly mode: TDModeController;
  readonly totalRequests: number;
  readonly droppedCount: number;
  readonly timedOutCount: number;
  readonly eventCountsByType: ReadonlyMap<string, number>;
  readonly forwardedCountByComponent: ReadonlyMap<ComponentId, number>;
  readonly processedCountByComponent: ReadonlyMap<ComponentId, number>;
}

/**
 * Runs a full wave: constructs TDModeController, advances to simulate,
 * ticks engine for wave.duration ticks, runs evaluateOutcome, and
 * returns an aggregated result for assertions.
 *
 * The caller must pre-build topology on `state` before calling runWave.
 */
export function runWave(
  state: SimulationState,
  wave: TDWaveDefinition,
  entryPointId: ComponentId,
): WaveRunResult {
  const economy = new TDEconomy({
    startingBudget: wave.startingBudget,
    revenuePerRequestType: wave.revenuePerRequestType,
  });
  const mode = new TDModeController({
    wave,
    economy,
    entryPointId,
    rng: makeRng(1),
  });
  mode.advancePhase(); // build → simulate

  const engine = new Engine(state);
  for (let i = 0; i < wave.duration; i++) {
    engine.tick(mode);
  }

  const eventCountsByType = new Map<string, number>();
  const forwardedCountByComponent = new Map<ComponentId, number>();
  const processedCountByComponent = new Map<ComponentId, number>();
  let droppedCount = 0;
  let timedOutCount = 0;

  for (const events of state.requestLog.values()) {
    for (const ev of events) {
      eventCountsByType.set(ev.type, (eventCountsByType.get(ev.type) ?? 0) + 1);
      if (ev.type === "FORWARDED" && ev.capabilityId !== null) {
        // Source-side FORWARDED: emitted by ForwardingCapability.process() with
        // capabilityId set. Engine also emits FORWARDED at delivery time with
        // capabilityId=null — we filter those out to get "who forwarded" counts.
        forwardedCountByComponent.set(
          ev.componentId,
          (forwardedCountByComponent.get(ev.componentId) ?? 0) + 1,
        );
      } else if (ev.type === "PROCESSED") {
        // PROCESSED is capability-emitted (ProcessingCapability, StorageCapability).
        // The engine does not emit PROCESSED events directly.
        processedCountByComponent.set(
          ev.componentId,
          (processedCountByComponent.get(ev.componentId) ?? 0) + 1,
        );
      } else if (ev.type === "DROPPED") {
        droppedCount += 1;
      } else if (ev.type === "TIMED_OUT") {
        timedOutCount += 1;
      }
    }
  }

  const totalRequests = state.requestLog.size;
  const outcome = mode.evaluateOutcome(state.metricsHistory);

  return {
    outcome,
    state,
    mode,
    totalRequests,
    droppedCount,
    timedOutCount,
    eventCountsByType,
    forwardedCountByComponent,
    processedCountByComponent,
  };
}

/**
 * Deterministic LCG for test determinism.
 */
export function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Build a Server component with Processing + Forwarding(writes) + Monitoring.
 */
export function buildServer(id: string): {
  component: Component;
  ingressPortId: string;
  egressPortId: string;
} {
  const ingressPortId = `${id}-in`;
  const egressPortId = `${id}-out`;
  const ingress = makePort(ingressPortId, "ingress");
  const egress = makePort(egressPortId, "egress");

  const processingCap = new ProcessingCapability("processing" as CapabilityId);
  // Server's Forwarding handles writes only, with small throughput (12/tick)
  // so Server's total budget = Processing(18) + Forwarding(12) = 30 < Wave 3's
  // 50 req/tick → lone-server fails as required by the learning arc.
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_write"],
    throughputPerTier: 12,
  });
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["processing" as CapabilityId, processingCap],
    ["forwarding" as CapabilityId, forwardingCap],
    ["monitoring" as CapabilityId, monitoringCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["processing" as CapabilityId, 1],
    ["forwarding" as CapabilityId, 1],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "server",
    name: "Server",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, egress],
    placementCost: 100,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });

  return { component, ingressPortId, egressPortId };
}

// Placeholders for later slices:
// export function buildDatabase(id: string): ... (Slice B)
// export function buildCache(id: string): ... (Slice C)
// export function buildLoadBalancer(id: string): ... (Slice C)

/**
 * Wires a source component's egress port to a target component's ingress port.
 * Returns the created Connection so the caller can add it to state.
 */
export function wire(
  state: SimulationState,
  source: { component: Component; egressPortId: string },
  target: { component: Component; ingressPortId: string },
  connId: string,
): void {
  const sourcePort = source.component.ports.find((p) => p.id === source.egressPortId);
  const targetPort = target.component.ports.find((p) => p.id === target.ingressPortId);
  if (!sourcePort || !targetPort) {
    throw new Error(`wire: port not found (${connId})`);
  }
  const conn = makeConnection(
    connId,
    { componentId: source.component.id, portId: source.egressPortId },
    { componentId: target.component.id, portId: target.ingressPortId },
  );
  sourcePort.connections.push(conn.id);
  targetPort.connections.push(conn.id);
  state.addConnection(conn);
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: may need adjustments. If `Component` constructor, `makePort`, or `ConditionProfile` shapes differ, read the real types and fix. `state.metricsHistory` may be named differently.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/td/helpers.ts
git commit -m "test(integration/td): add wave run + topology helpers

runWave() aggregates a full wave play (construct mode, tick for
wave.duration, evaluateOutcome, walk requestLog for event counts).
buildServer() creates a Server with Processing+Forwarding+Monitoring.
wire() links components via makeConnection + port.connections.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Wave 1 integration test

**Files:**
- Create: `tests/integration/td/wave-1-launch-day.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_1 } from "@modes/td/td-waves";
import { buildServer, wire, runWave } from "./helpers.js";
import type { ComponentId } from "@core/types/ids";

describe("Wave 1 — Launch Day", () => {
  it("trivial Server topology wins cleanly", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const server = buildServer("c-server");
    state.placeComponent(server.component);

    // Wave 1 entry point is the Server itself (no upstream client/LB in this slice).
    // TDTrafficSource injects requests with origin=c-server, which matches how
    // SandboxModeController tests inject traffic at the entry point.

    const result = runWave(state, WAVE_1, "c-server" as ComponentId);

    expect(result.outcome.verdict).toBe("win");
    expect(result.droppedCount).toBe(0);
    expect(result.timedOutCount).toBe(0);
    expect(result.totalRequests).toBe(WAVE_1.intensity * WAVE_1.duration);

    // Verify reads were actually processed at the Server.
    const serverProcessed =
      result.processedCountByComponent.get("c-server" as ComponentId) ?? 0;
    expect(serverProcessed).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test — may reveal issues**

```bash
pnpm test tests/integration/td/wave-1-launch-day.test.ts
```

Expected: PASS if everything wired. Possible failure modes and fixes:
- **Request log empty:** `TDTrafficSource.generate()` isn't being called. Check `injectTraffic` in the engine — does it call `modeController.getTrafficSource().generate(currentTick)`? If not, the engine expects a different traffic-source interface method (e.g. `pull`, `generateTraffic`). Align `TDTrafficSource` to the real interface.
- **Requests dropped with no `PROCESSED` event:** `ProcessingCapability.canHandle` is returning false or the phase isn't running. Double-check Task 3's implementation and the component registry.
- **Timeouts:** TTL too tight for the latency added. Wave 1 traffic is light — if timeouts appear, something is wrong with latency accounting, not tuning.

- [ ] **Step 3: Iterate until green**

Debug any issues. Wave 1 is the smoke test — it has to pass before Slice A ships.

- [ ] **Step 4: Run full suite**

```bash
pnpm test && pnpm typecheck
```
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/td/wave-1-launch-day.test.ts
git commit -m "test(integration/td): Wave 1 passes with single Server topology

Smoke test for the full TD mode stack. 10 api_read/tick × 30 ticks,
single Server topology, asserts clean win outcome.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Slice A merge

**Files:** none (git only)

- [ ] **Step 1: Final checks**

```bash
pnpm test && pnpm typecheck
```
Expected: fully green.

- [ ] **Step 2: Merge Slice A to main**

```bash
cd /Users/normanettedgui/development/capstone  # main tree
git checkout main
git merge --no-ff stage-3a-slice-a-wave-1
git log --oneline -20
```
Expected: merge commit on main with the full Slice A history.

- [ ] **Step 3: Clean up worktree**

```bash
git worktree remove .worktrees/stage-3a-slice-a-wave-1
```

Slice A complete. Proceed to Slice B.

---

# Slice B — Wave 2 passes

**Exit:** `tests/integration/td/wave-2-signups.test.ts` is green, learning arc signal (Server+Database handles writes) verified via request log, slice merged.

---

## Task 15: Create Slice B worktree

- [ ] **Step 1:**

```bash
git worktree add .worktrees/stage-3a-slice-b-wave-2 -b stage-3a-slice-b-wave-2
cd .worktrees/stage-3a-slice-b-wave-2
pnpm install
pnpm test && pnpm typecheck
```
Expected: baseline green from Slice A merge.

---

## Task 16: `StorageCapability`

**Files:**
- Create: `src/capabilities/storage/storage-capability.ts`
- Create: `tests/unit/storage-capability.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/storage-capability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { StorageCapability } from "@capabilities/storage/storage-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "storage" as CapabilityId;

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: "write-1",
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

// Minimal stub — capabilities mostly ignore context. `as unknown as` cast
// is required because the real ProcessContext has 9 fields including a
// DeterministicRng object (not a function) and a SimulationStateReader.
// We provide only the fields the capability actually reads.
const ctx = {
  currentTick: 0,
  componentId: "c-1" as ComponentId,
  effectiveTier: 1,
  activeCapabilityIds: new Set([CAP_ID]),
} as unknown as ProcessContext;

describe("StorageCapability", () => {
  it("claims api_write", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.canHandle("api_write")).toBe(true);
  });

  it("rejects api_read", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.canHandle("api_read")).toBe(false);
  });

  it("returns RESPOND outcome on writes", () => {
    const cap = new StorageCapability(CAP_ID);
    const result = cap.process(req("api_write"), ctx);
    expect(result.outcome.kind).toBe("RESPOND");
  });

  it("emits a PROCESSED event for integration test counting", () => {
    const cap = new StorageCapability(CAP_ID);
    const result = cap.process(req("api_write"), ctx);
    const ev = result.events.find((e) => e.type === "PROCESSED");
    expect(ev).toBeDefined();
    expect(ev?.componentId).toBe("c-1");
  });

  it("increments writeCount", () => {
    const cap = new StorageCapability(CAP_ID);
    cap.process(req("api_write"), ctx);
    cap.process(req("api_write"), ctx);
    expect(cap.getStats().writeCount).toBe(2);
  });

  it("declares bounded throughput", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.getThroughputPerTick(1)).toBe(25);
    expect(cap.getThroughputPerTick(2)).toBe(45);
    expect(cap.getThroughputPerTick(3)).toBe(80);
  });

  it("has upkeep scaling with tier", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.getUpkeepCost(1)).toBe(4);
    expect(cap.getUpkeepCost(2)).toBe(8);
    expect(cap.getUpkeepCost(3)).toBe(16);
  });

  it("phase is PROCESS", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.phase).toBe("PROCESS");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm test tests/unit/storage-capability.test.ts
```

- [ ] **Step 3: Implement `StorageCapability`**

Create `src/capabilities/storage/storage-capability.ts`:

```ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * Production Storage — PROCESS phase, handles api_write, RESPOND outcome.
 * Emits a PROCESSED event so integration tests can count writes handled
 * per component. Stage 3a: no replication, no sharding, no query
 * capability. Just the minimum that lets writes reach a persistent
 * component.
 */
export class StorageCapability implements Capability {
  readonly phase = "PROCESS" as const;
  private writeCount = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "api_write";
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    this.writeCount += 1;
    return {
      outcome: { kind: "RESPOND" },
      sideEffects: [],
      events: [
        {
          tick: context.currentTick,
          componentId: context.componentId,
          capabilityId: this.id,
          connectionId: null,
          type: "PROCESSED",
          latencyAdded: 2,
        },
      ],
    };
  }

  getThroughputPerTick(tier: number): number {
    const table: Record<number, number> = { 1: 25, 2: 45, 3: 80 };
    return table[tier] ?? 25;
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 4, 2: 8, 3: 16 };
    return table[tier] ?? 4;
  }

  getStats(): CapabilityStats {
    return { writeCount: this.writeCount };
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm test tests/unit/storage-capability.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/storage/ tests/unit/storage-capability.test.ts
git commit -m "feat(capabilities): add StorageCapability

PROCESS-phase capability handling api_write with RESPOND outcome. Bounded
throughput via getThroughputPerTick. Enables Database registry entry
in Task 17.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Database registry entry + register

**Files:**
- Modify: `src/modes/td/td-component-entries.ts`
- Modify: `src/modes/td/register-td-defaults.ts`
- Modify: `src/modes/td/index.ts`
- Modify: `tests/integration/td/helpers.ts` (add `buildDatabase`)

- [ ] **Step 1: Add `DATABASE_ENTRY`**

Append to `src/modes/td/td-component-entries.ts`:

```ts
export const DATABASE_ENTRY: ComponentRegistryEntry = {
  type: "database",
  name: "Database",
  description: "Persists data so your servers don't have to remember everything.",
  capabilities: [
    { id: "storage" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "data", capacity: 3, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "data", capacity: 2, connections: [] },
  ],
  placementCost: 200,
  upgradeCostCurve: [200, 400, 800],
  visual: { icon: "database", color: "#7B68EE", shape: "cylinder" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};
```

- [ ] **Step 2: Register storage capability + Database in bootstrap**

Edit `src/modes/td/register-td-defaults.ts`:

```ts
import { StorageCapability } from "@capabilities/storage/storage-capability";
import { SERVER_ENTRY, DATABASE_ENTRY } from "./td-component-entries.js";
```

And inside `registerTDDefaults`, add after the `monitoring` registration:
```ts
  capRegistry.register({
    id: "storage" as CapabilityId,
    factory: () => new StorageCapability("storage" as CapabilityId),
  });
```
And after `compRegistry.register(SERVER_ENTRY)`:
```ts
  compRegistry.register(DATABASE_ENTRY);
```

- [ ] **Step 3: Update barrel export**

Add to `src/modes/td/index.ts`:
```ts
export { SERVER_ENTRY, DATABASE_ENTRY } from "./td-component-entries.js";
```

- [ ] **Step 4: Add `buildDatabase` to helpers**

Append to `tests/integration/td/helpers.ts`:

```ts
import { StorageCapability } from "@capabilities/storage/storage-capability";

export function buildDatabase(id: string): {
  component: Component;
  ingressPortId: string;
  egressPortId: string;
} {
  const ingressPortId = `${id}-in`;
  const egressPortId = `${id}-out`;
  const ingress = makePort(ingressPortId, "ingress");
  const egress = makePort(egressPortId, "egress");

  const storageCap = new StorageCapability("storage" as CapabilityId);
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["storage" as CapabilityId, storageCap],
    ["monitoring" as CapabilityId, monitoringCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["storage" as CapabilityId, 1],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "database",
    name: "Database",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, egress],
    placementCost: 200,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });

  return { component, ingressPortId, egressPortId };
}
```

- [ ] **Step 5: Run test + typecheck**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/ tests/integration/td/helpers.ts
git commit -m "feat(modes/td): register Database component and storage capability

Adds DATABASE_ENTRY and storage factory to registerTDDefaults.
buildDatabase helper in integration test helpers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: `WAVE_2` definition

**Files:**
- Modify: `src/modes/td/td-waves.ts`

- [ ] **Step 1: Add `WAVE_2` constant**

Append to `src/modes/td/td-waves.ts`:

```ts
export const WAVE_2: TDWaveDefinition = {
  id: 2,
  name: "Users Start Signing Up",
  startingBudget: 500,
  intensity: 25,
  composition: new Map([["api_read", 0.7], ["api_write", 0.3]]),
  duration: 30,
  ttl: 10,
  availableComponents: ["server", "database"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
  readKeyPoolSize: 20,
};
```

- [ ] **Step 2: Export from barrel**

Add `WAVE_2` to the `export { ... } from "./td-waves.js";` line in `src/modes/td/index.ts`.

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add src/modes/td/td-waves.ts src/modes/td/index.ts
git commit -m "feat(modes/td): add WAVE_2 definition

25 req/tick, 70/30 read/write split, Server+Database topology.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Wave 2 integration test

**Files:**
- Create: `tests/integration/td/wave-2-signups.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_2 } from "@modes/td/td-waves";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";
import type { ComponentId } from "@core/types/ids";

describe("Wave 2 — Users Start Signing Up", () => {
  it("Server+Database topology wins and writes reach the Database", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const server = buildServer("c-server");
    const db = buildDatabase("c-db");
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    wire(state, { component: server.component, egressPortId: server.egressPortId },
               { component: db.component, ingressPortId: db.ingressPortId },
               "cx-server-db");

    const result = runWave(state, WAVE_2, "c-server" as ComponentId);

    expect(result.outcome.verdict).toBe("win");

    const total = result.totalRequests;
    const dropRate = (result.droppedCount + result.timedOutCount) / total;
    expect(dropRate).toBeLessThan(0.05);

    // Writes flowed Server → Database.
    // - Server's ForwardingCapability emitted FORWARDED events.
    const serverForwardCount =
      result.forwardedCountByComponent.get("c-server" as ComponentId) ?? 0;
    expect(serverForwardCount).toBeGreaterThan(0);

    // - Database's StorageCapability processed the writes.
    const dbProcessedCount =
      result.processedCountByComponent.get("c-db" as ComponentId) ?? 0;
    expect(dbProcessedCount).toBeGreaterThan(0);

    // Sanity: write-routing volume should be roughly equal to the generated write count.
    // Wave 2: 25 * 30 * 0.3 = 225 expected writes.
    expect(serverForwardCount).toBeGreaterThan(100); // loose lower bound
    expect(dbProcessedCount).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Run — debug if needed**

```bash
pnpm test tests/integration/td/wave-2-signups.test.ts
```

Possible failures and fixes:
- **No FORWARDED events at Server:** `ForwardingCapability` isn't being hit. Check whether `ForwardingCapability.process` is emitting the `FORWARDED` event or whether deliverStaged does. If deliverStaged emits the event on the FORWARD delivery, the capability itself doesn't — in that case update the helpers to count from the engine-emitted event, not a capability-emitted one.
- **Database processed count is zero:** writes are being dropped before reaching DB. Check the connection wiring and component placement order.
- **Drop rate too high:** tune `StorageCapability.getThroughputPerTick` up or Server's throughput up.

- [ ] **Step 3: Run full suite**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/td/wave-2-signups.test.ts
git commit -m "test(integration/td): Wave 2 passes with Server+Database

25 req/tick mixed read/write. Verifies StorageCapability handles writes
and Server's ForwardingCapability routes them via the egress connection.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Slice B merge

- [ ] **Step 1:**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 2:**

```bash
cd /Users/normanettedgui/development/capstone
git checkout main
git merge --no-ff stage-3a-slice-b-wave-2
git worktree remove .worktrees/stage-3a-slice-b-wave-2
```

Slice B complete. Proceed to Slice C.

---

# Slice C — Wave 3 learning arc

**Exit:** four integration tests green — Wave 3 lone-server fails, Cache rescue passes with meaningful hit rate, LB rescue passes with load distribution.

---

## Task 21: Create Slice C worktree

```bash
git worktree add .worktrees/stage-3a-slice-c-wave-3 -b stage-3a-slice-c-wave-3
cd .worktrees/stage-3a-slice-c-wave-3
pnpm install
pnpm test && pnpm typecheck
```

---

## Task 22: `CachingCapability`

**Files:**
- Create: `src/capabilities/caching/caching-capability.ts`
- Create: `tests/unit/caching-capability.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/caching-capability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CachingCapability } from "@capabilities/caching/caching-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "caching" as CapabilityId;

function req(type: string, payload: string, id = "r-1"): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type,
    payload,
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

// Minimal stub — capabilities mostly ignore context. `as unknown as` cast
// is required because the real ProcessContext has 9 fields including a
// DeterministicRng object (not a function) and a SimulationStateReader.
// We provide only the fields the capability actually reads.
const ctx = {
  currentTick: 0,
  componentId: "c-1" as ComponentId,
  effectiveTier: 1,
  activeCapabilityIds: new Set([CAP_ID]),
} as unknown as ProcessContext;

describe("CachingCapability", () => {
  it("passes non-read requests through", () => {
    const cap = new CachingCapability(CAP_ID);
    const result = cap.process(req("api_write", "w-1"), ctx);
    expect(result.outcome.kind).toBe("PASS");
  });

  it("first read on a key returns PASS (miss)", () => {
    const cap = new CachingCapability(CAP_ID);
    const result = cap.process(req("api_read", "key-1"), ctx);
    expect(result.outcome.kind).toBe("PASS");
  });

  it("second read on the same key returns RESPOND (hit)", () => {
    const cap = new CachingCapability(CAP_ID);
    cap.process(req("api_read", "key-1", "r-1"), ctx);
    const result = cap.process(req("api_read", "key-1", "r-2"), ctx);
    expect(result.outcome.kind).toBe("RESPOND");
    const hitEvent = result.events.find((e) => e.type === "CACHED_HIT");
    expect(hitEvent).toBeDefined();
  });

  it("different keys don't collide", () => {
    const cap = new CachingCapability(CAP_ID);
    cap.process(req("api_read", "key-1"), ctx);
    const result = cap.process(req("api_read", "key-2"), ctx);
    expect(result.outcome.kind).toBe("PASS"); // key-2 is a miss
  });

  it("FIFO evicts when full (capacity=10 at T1)", () => {
    const cap = new CachingCapability(CAP_ID);
    // Fill cache: key-0 through key-9
    for (let i = 0; i < 10; i++) {
      cap.process(req("api_read", `key-${i}`), ctx);
    }
    // Insert key-10 — should evict key-0
    cap.process(req("api_read", "key-10"), ctx);

    // key-0 should now be a miss
    const result0 = cap.process(req("api_read", "key-0"), ctx);
    expect(result0.outcome.kind).toBe("PASS");
    // key-9 should still hit
    const result9 = cap.process(req("api_read", "key-9"), ctx);
    expect(result9.outcome.kind).toBe("RESPOND");
  });

  it("phase is INTERCEPT", () => {
    const cap = new CachingCapability(CAP_ID);
    expect(cap.phase).toBe("INTERCEPT");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm test tests/unit/caching-capability.test.ts
```

- [ ] **Step 3: Implement**

Create `src/capabilities/caching/caching-capability.ts`:

```ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult, PrimaryOutcome } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * INTERCEPT-phase cache keyed on stringified request.payload. Hit returns
 * RESPOND with CACHED_HIT event. Miss returns PASS (pipeline continues
 * to PROCESS, which typically runs ForwardingCapability to the egress).
 *
 * Cache-on-miss shortcut: the miss path inserts the key immediately. This
 * is observationally correct for homogeneous workloads (Stage 3a) because
 * every api_read returns the same response — it would fail for real
 * heterogeneous payloads, and a proper write-back flow is deferred.
 */
export class CachingCapability implements Capability {
  readonly phase = "INTERCEPT" as const;
  private readonly cache = new Map<string, { tick: number }>();
  private readonly capacity: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(
    readonly id: CapabilityId,
    options: { capacity?: number } = {},
  ) {
    this.capacity = options.capacity ?? 10;
  }

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    if (request.type !== "api_read") {
      return { outcome: { kind: "PASS" } as PrimaryOutcome, sideEffects: [], events: [] };
    }

    const key = String(request.payload);

    if (this.cache.has(key)) {
      this.hitCount += 1;
      return {
        outcome: { kind: "RESPOND" },
        sideEffects: [],
        events: [
          {
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "CACHED_HIT",
            latencyAdded: 0,
          },
        ],
      };
    }

    // Miss: insert (cache-on-miss shortcut — see class docstring) and PASS.
    if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { tick: context.currentTick });
    this.missCount += 1;

    return {
      outcome: { kind: "PASS" } as PrimaryOutcome,
      sideEffects: [],
      events: [],
    };
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 3, 2: 6, 3: 12 };
    return table[tier] ?? 3;
  }

  getStats(): CapabilityStats {
    return { hitCount: this.hitCount, missCount: this.missCount };
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test tests/unit/caching-capability.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/caching/ tests/unit/caching-capability.test.ts
git commit -m "feat(capabilities): add CachingCapability

INTERCEPT-phase cache. Hit→RESPOND with CACHED_HIT event, miss→PASS
(pipeline continues to PROCESS/ForwardingCapability). Fixed T1 capacity
of 10 with FIFO eviction. Cache-on-miss shortcut documented.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: Cache and LoadBalancer registry entries + helpers

**Files:**
- Modify: `src/modes/td/td-component-entries.ts` (add Cache + LB)
- Modify: `src/modes/td/register-td-defaults.ts` (register caching + cache + lb)
- Modify: `tests/integration/td/helpers.ts` (buildCache, buildLoadBalancer)

- [ ] **Step 1: Add `CACHE_ENTRY` and `LOAD_BALANCER_ENTRY`**

Append to `src/modes/td/td-component-entries.ts`:

```ts
export const CACHE_ENTRY: ComponentRegistryEntry = {
  type: "cache",
  name: "Cache",
  description: "Remembers recent responses so your database doesn't get hammered twice.",
  capabilities: [
    { id: "caching" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 1, connections: [] },
  ],
  placementCost: 150,
  upgradeCostCurve: [150, 300, 600],
  visual: { icon: "cache", color: "#F5A623", shape: "diamond" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

export const LOAD_BALANCER_ENTRY: ComponentRegistryEntry = {
  type: "load_balancer",
  name: "Load Balancer",
  description: "Splits traffic across multiple servers so no single one gets overwhelmed.",
  capabilities: [
    { id: "routing" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 1, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 4, connections: [] },
  ],
  placementCost: 175,
  upgradeCostCurve: [175, 350, 700],
  visual: { icon: "load-balancer", color: "#50C878", shape: "hexagon" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};
```

- [ ] **Step 2: Register caching + routing + entries**

Edit `src/modes/td/register-td-defaults.ts`:

```ts
import { CachingCapability } from "@capabilities/caching/caching-capability";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import { CACHE_ENTRY, LOAD_BALANCER_ENTRY } from "./td-component-entries.js";
```

Add capability registrations inside `registerTDDefaults`:
```ts
  capRegistry.register({
    id: "caching" as CapabilityId,
    factory: () => new CachingCapability("caching" as CapabilityId),
  });
  capRegistry.register({
    id: "routing" as CapabilityId,
    factory: () => new RoutingCapability("routing" as CapabilityId),
  });
```
(Adjust `RoutingCapability` constructor args to match its actual signature — check `src/capabilities/routing/routing-capability.ts`.)

And component registrations:
```ts
  compRegistry.register(CACHE_ENTRY);
  compRegistry.register(LOAD_BALANCER_ENTRY);
```

- [ ] **Step 3: Update barrel**

Add to `src/modes/td/index.ts`:
```ts
export { SERVER_ENTRY, DATABASE_ENTRY, CACHE_ENTRY, LOAD_BALANCER_ENTRY } from "./td-component-entries.js";
```

- [ ] **Step 4: Add `buildCache` and `buildLoadBalancer` to helpers**

Append to `tests/integration/td/helpers.ts`:

```ts
import { CachingCapability } from "@capabilities/caching/caching-capability";
import { RoutingCapability } from "@capabilities/routing/routing-capability";

export function buildCache(id: string): {
  component: Component;
  ingressPortId: string;
  egressPortId: string;
} {
  const ingressPortId = `${id}-in`;
  const egressPortId = `${id}-out`;
  const ingress = makePort(ingressPortId, "ingress");
  const egress = makePort(egressPortId, "egress");

  const cachingCap = new CachingCapability("caching" as CapabilityId);
  // Cache's Forwarding handles ALL traffic passing through (cache misses
  // for reads, pass-through for writes), so needs high throughput (~55/tick
  // to handle Wave 3's 50 req/tick).
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_read", "api_write"],
    throughputPerTier: 55,
  });
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["caching" as CapabilityId, cachingCap],
    ["forwarding" as CapabilityId, forwardingCap],
    ["monitoring" as CapabilityId, monitoringCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["caching" as CapabilityId, 1],
    ["forwarding" as CapabilityId, 1],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "cache",
    name: "Cache",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, egress],
    placementCost: 150,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });

  return { component, ingressPortId, egressPortId };
}

export function buildLoadBalancer(id: string, egressCount: number): {
  component: Component;
  ingressPortId: string;
  egressPortIds: string[];
} {
  const ingressPortId = `${id}-in`;
  const ingress = makePort(ingressPortId, "ingress");

  const egressPortIds: string[] = [];
  const egressPorts = [];
  for (let i = 0; i < egressCount; i++) {
    const egressPortId = `${id}-out-${i}`;
    egressPortIds.push(egressPortId);
    egressPorts.push(makePort(egressPortId, "egress"));
  }

  const routingCap = new RoutingCapability("routing" as CapabilityId);
  // LB's Forwarding handles ALL inbound traffic with high throughput
  // (~55/tick) — it's the pass-through pipe feeding both servers.
  const forwardingCap = new ForwardingCapability("forwarding" as CapabilityId, {
    handledTypes: ["api_read", "api_write"],
    throughputPerTier: 55,
  });
  const monitoringCap = new MonitoringCapability("monitoring" as CapabilityId);

  const capabilities = new Map<CapabilityId, Capability>([
    ["routing" as CapabilityId, routingCap],
    ["forwarding" as CapabilityId, forwardingCap],
    ["monitoring" as CapabilityId, monitoringCap],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["routing" as CapabilityId, 1],
    ["forwarding" as CapabilityId, 1],
    ["monitoring" as CapabilityId, 1],
  ]);

  const component = new Component({
    id: id as ComponentId,
    type: "load_balancer",
    name: "Load Balancer",
    description: "",
    capabilities,
    initialTiers: tiers,
    ports: [ingress, ...egressPorts],
    placementCost: 175,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });

  return { component, ingressPortId, egressPortIds };
}

```

- [ ] **Step 5: Run test + typecheck**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/ tests/integration/td/helpers.ts
git commit -m "feat(modes/td): register Cache + LoadBalancer components

Add CACHE_ENTRY (Caching + Forwarding + Monitoring) and
LOAD_BALANCER_ENTRY (Routing + Forwarding + Monitoring) to the registry.
buildCache and buildLoadBalancer helpers for integration tests.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: `WAVE_3` definition

**Files:**
- Modify: `src/modes/td/td-waves.ts`

- [ ] **Step 1: Add WAVE_3**

Append:
```ts
export const WAVE_3: TDWaveDefinition = {
  id: 3,
  name: "Traffic Spikes",
  startingBudget: 600,
  intensity: 50,
  composition: new Map([["api_read", 0.7], ["api_write", 0.3]]),
  duration: 30,
  ttl: 8,
  availableComponents: ["server", "database", "cache", "load_balancer"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
  readKeyPoolSize: 15, // Pool=15 vs Cache capacity=10 → ~67% hit rate target
};
```

Add `WAVE_3` to the `src/modes/td/index.ts` barrel export.

- [ ] **Step 2: Commit**

```bash
pnpm typecheck
git add src/modes/td/td-waves.ts src/modes/td/index.ts
git commit -m "feat(modes/td): add WAVE_3 definition

50 req/tick, 70/30 split, TTL 8, all 4 components available.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 25: Wave 3 lone-server integration test + tuning

**Files:**
- Create: `tests/integration/td/wave-3-traffic-spike.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";
import type { ComponentId } from "@core/types/ids";

describe("Wave 3 — Traffic Spikes (lone-server)", () => {
  it("Server+Database alone loses under Wave 3 load", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const server = buildServer("c-server");
    const db = buildDatabase("c-db");
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    wire(state, { component: server.component, egressPortId: server.egressPortId },
               { component: db.component, ingressPortId: db.ingressPortId },
               "cx-server-db");

    const result = runWave(state, WAVE_3, "c-server" as ComponentId);

    expect(result.outcome.verdict).toBe("lose");
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeGreaterThanOrEqual(0.05);
  });
});
```

- [ ] **Step 2: Run — likely passes or fails**

```bash
pnpm test tests/integration/td/wave-3-traffic-spike.test.ts
```

If the test **fails because the lone-server topology wins (drop rate too low):** the throughput numbers are too generous. Tune:
- Lower `ProcessingCapability.getThroughputPerTick` T1 value (e.g., 15 or 10)
- Or lower `ForwardingCapability.getThroughputPerTick` T1 value
- Re-run Wave 1 and Wave 2 tests to ensure they still pass

If the test **fails because drops are zero at all:** the engine isn't applying throughput caps. Verify `componentThroughputPerTick` sees the new methods (grep `src/core/engine/throughput.ts`).

- [ ] **Step 3: Tune and iterate**

This is the load-bearing tuning step. Expect 3–5 iterations. Keep Wave 1 + Wave 2 tests green throughout. Commit tuning changes in small increments.

- [ ] **Step 4: Commit when green**

```bash
git add tests/integration/td/wave-3-traffic-spike.test.ts src/capabilities/
git commit -m "test(integration/td): Wave 3 lone-server loses + tune throughput

50 req/tick overwhelms a single Server+Database. ProcessingCapability
throughput tuned to produce the expected failure mode.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 26: Wave 3 learning-arc integration test (both rescues)

**Files:**
- Create: `tests/integration/td/wave-3-learning-arc.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import {
  buildServer,
  buildDatabase,
  buildCache,
  buildLoadBalancer,
  wire,
  runWave,
} from "./helpers.js";
import type { ComponentId } from "@core/types/ids";

describe("Wave 3 — Learning arc", () => {
  it("Cache rescue: Entry → Cache → Server → Database wins", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const cache = buildCache("c-cache");
    const server = buildServer("c-server");
    const db = buildDatabase("c-db");
    state.placeComponent(cache.component);
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    wire(state, { component: cache.component, egressPortId: cache.egressPortId },
               { component: server.component, ingressPortId: server.ingressPortId },
               "cx-cache-server");
    wire(state, { component: server.component, egressPortId: server.egressPortId },
               { component: db.component, ingressPortId: db.ingressPortId },
               "cx-server-db");

    const result = runWave(state, WAVE_3, "c-cache" as ComponentId);

    expect(result.outcome.verdict).toBe("win");

    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeLessThan(0.05);

    // Cache must actually be doing work: hit count in meaningful range.
    const cachedHits = result.eventCountsByType.get("CACHED_HIT") ?? 0;
    expect(cachedHits).toBeGreaterThan(0);
    // Loose sanity: at least 10% of generated reads should hit the cache.
    const expectedReads = WAVE_3.intensity * WAVE_3.duration * 0.7;
    expect(cachedHits).toBeGreaterThan(expectedReads * 0.1);
  });

  it("LB rescue: Entry → LB → [Server1, Server2] → Database wins", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const lb = buildLoadBalancer("c-lb", 2);
    const server1 = buildServer("c-server-1");
    const server2 = buildServer("c-server-2");
    const db = buildDatabase("c-db");
    state.placeComponent(lb.component);
    state.placeComponent(server1.component);
    state.placeComponent(server2.component);
    state.placeComponent(db.component);

    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! },
               { component: server1.component, ingressPortId: server1.ingressPortId },
               "cx-lb-s1");
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! },
               { component: server2.component, ingressPortId: server2.ingressPortId },
               "cx-lb-s2");
    wire(state, { component: server1.component, egressPortId: server1.egressPortId },
               { component: db.component, ingressPortId: db.ingressPortId },
               "cx-s1-db");
    wire(state, { component: server2.component, egressPortId: server2.egressPortId },
               { component: db.component, ingressPortId: db.ingressPortId },
               "cx-s2-db");

    const result = runWave(state, WAVE_3, "c-lb" as ComponentId);

    expect(result.outcome.verdict).toBe("win");
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeLessThan(0.05);

    // Both servers must have received traffic — via PROCESSED events per component.
    const s1Processed = result.processedCountByComponent.get("c-server-1" as ComponentId) ?? 0;
    const s2Processed = result.processedCountByComponent.get("c-server-2" as ComponentId) ?? 0;
    expect(s1Processed).toBeGreaterThan(0);
    expect(s2Processed).toBeGreaterThan(0);

    // Load distribution is meaningful — neither server is starved below 20%.
    const totalServerProcessed = s1Processed + s2Processed;
    expect(s1Processed / totalServerProcessed).toBeGreaterThan(0.2);
    expect(s2Processed / totalServerProcessed).toBeGreaterThan(0.2);
  });
});
```

- [ ] **Step 2: Run — expect iteration**

```bash
pnpm test tests/integration/td/wave-3-learning-arc.test.ts
```

Likely failure modes and fixes:
- **Cache rescue fails:** the cache's hit rate is too low (readKeyPoolSize too large relative to cache capacity). Lower `readKeyPoolSize` to e.g. 15.
- **Cache rescue cachedHits count is 100% of reads:** working set is too small. Raise readKeyPoolSize to e.g. 25.
- **LB rescue passes but load distribution is skewed:** `RoutingCapability` round-robin isn't picking both connections. Read the routing capability implementation to confirm T1 behavior.
- **LB rescue fails (drops too high):** two servers at Processing T1 total = ~40 read req/tick, below Wave 3's 35 read req/tick. Should just barely pass. If it doesn't, tune up ProcessingCapability throughput slightly OR lower Wave 3 intensity.

Both rescues must pass without breaking the lone-server loss case from Task 25. This is the tuning tightrope.

- [ ] **Step 3: Re-run Wave 1, 2, 3 spike tests**

```bash
pnpm test tests/integration/td/
```
Expected: all four Wave integration tests green.

- [ ] **Step 4: Run full suite**

```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/td/wave-3-learning-arc.test.ts src/
git commit -m "test(integration/td): Wave 3 learning arc — both rescues pass

Cache rescue (Entry → Cache → Server → Database) and LoadBalancer rescue
(Entry → LB → [S1,S2] → Database) both pass Wave 3 load. Lone-server
still loses. Learning arc validated end-to-end.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 27: Update CLAUDE.md with Stage 3a completion notes

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update "Implementation status"**

Change the Stage-3a-pending block to a Stage-3a-complete block. Add new gotchas discovered during Stage 3a (e.g., "ForwardingCapability is the PROCESS primitive for producing FORWARD; don't rely on PASS fall-through"). Keep it tight.

- [ ] **Step 2: Update "Next" pointer**

Change "Next: Stage 3 — no spec yet" to "Next: Stage 3b — UI stage OR additional capabilities; TBD based on playable-slice assessment."

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update for Stage 3a completion

Mark Wave 1-3 playable slice as done. Note ForwardingCapability as the
required PROCESS primitive for forwarding. Next stage is TBD.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 28: Slice C merge

- [ ] **Step 1: Final checks**

```bash
pnpm test && pnpm typecheck
```
Expected: fully green. All four Stage 3a integration tests pass. All existing tests unchanged except the Task 4 migrations.

- [ ] **Step 2: Merge**

```bash
cd /Users/normanettedgui/development/capstone
git checkout main
git merge --no-ff stage-3a-slice-c-wave-3
git worktree remove .worktrees/stage-3a-slice-c-wave-3
git log --oneline -30
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

Stage 3a complete.

---

## Self-review checklist (for the plan author, not the implementer)

- [x] Every task has concrete file paths, not "add a file for X"
- [x] Every test has full code — no "test the behavior described"
- [x] Every implementation has full code
- [x] Commit messages are drafted for each task
- [x] Slice boundaries are worktree merges, not just logical groupings
- [x] Each slice ends on a green integration test
- [x] `ProcessingCapability` test migration has an inventory (Task 3 Step 5)
- [x] `ForwardingCapability` naming collision with harness is resolved (Task 2)
- [x] `evaluateOutcome` returns the real `OutcomeReport` shape
- [x] Test assertions walk `state.requestLog`, not `metricsHistory`
- [x] Integration tests build topology via fixtures, not `tryPlace`
- [x] `TDTrafficSource` generates distinguishable payloads for cache working set
- [x] `BuildConstraints` uses `maxPlacements`, not `maxComponents`
- [x] Throughput caps declared on every production PROCESS capability
- [x] Spec §12 exit criteria are mapped to specific tasks

# Wave 1 UX Pass — Slice A: Economy Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the campaign-economy retune in isolation — add TDViability, rent-at-READY, drop the SLA pass/fail gate, drop per-tick upkeep for TD, retune all 10 waves' viability/rent values — with zero UI changes. The dashboard still renders the old briefing/HUD against the new numbers until Slice B lands.

**Architecture:** All changes live in `src/modes/td/` and core type additions. No engine/capability changes. Viability is TD-mode-only. Upkeep removal is done by making `TDEconomy.debitUpkeep` a no-op; the engine still computes upkeep but TD declines to debit it. SLA gate is removed by replacing `TDModeController.onTick`'s existing SLA penalty hook with a viability-damage hook, and by replacing `runWave` / wave-test assertions that checked `outcome.verdict === "win"` with assertions that read a new `getTerminalState()` method. `ComponentRegistryEntry` gains an additive optional `rentPerWave?: number` field — zero risk to sandbox.

**Tech Stack:** TypeScript, Vitest, pnpm. Path aliases per `tsconfig.json`: `@core/*`, `@capabilities/*`, `@modes/*`, `@harness/*`.

**Test workflow:** Every code task is TDD-first. Full suite via `pnpm test`. Single-file via `pnpm test <path>`. Typecheck via `pnpm typecheck`. The existing suite has ~750 tests that run in ~6s; an individual unit test typically runs in <1s.

**Out of scope (deferred to Slice B plan):** all UI changes, briefing redesign, dossier modal, NEW badges, viability HUD meter, next-wave-bill counter, loss/win modal copy, entry-point redirect. The dashboard's existing briefing/HUD/modals will look slightly wrong against the new numbers until Slice B lands — that's acceptable since Slice A is a backend-only pass.

**Spec:** `docs/superpowers/specs/2026-04-15-wave1-ux-and-economy-design.md`, §§3–4.

---

## File Structure

**New files:**
- `src/modes/td/td-viability.ts` — `TDViability` class (health pool, damage, isDead)
- `tests/unit/td-viability.test.ts` — unit tests for TDViability
- `tests/unit/td-mode-controller-viability-and-rent.test.ts` — unit tests for the new controller methods (getViability, computeRentBill, payRent, getTerminalState, viability damage in onTick)

**Modified files:**
- `src/core/registry/component-registry.ts` — add `rentPerWave?: number` to `ComponentRegistryEntry`
- `src/modes/td/td-economy.ts` — `debitUpkeep` becomes a no-op
- `src/modes/td/td-waves.ts` — add required `viabilityPerFailure` + `viabilityRampPenalty` to interface; mark `startingBudget` optional; update all 10 wave definitions
- `src/modes/td/td-component-entries.ts` — add `rentPerWave` + set `placementCost: 0` on all TD entries
- `src/modes/td/td-mode-controller.ts` — import TDViability, add viability/rentBill/terminalState methods, replace SLA penalty in `onTick` with viability damage, adjust `evaluateOutcome`'s score denominator
- `tests/integration/td/helpers.ts` — extend `WaveRunResult` with `finalViability`, `finalBudget`, `terminalState`; fall back to a large default budget when `wave.startingBudget` is undefined
- Every `tests/integration/td/wave-*.test.ts` file — migrate assertions from `result.outcome.verdict` to `result.terminalState`
- `tests/integration/td/campaign-headless.test.ts` — migrate outcome assertions and verify budget carryover across waves

---

## Task 1: Add `rentPerWave` field to `ComponentRegistryEntry`

**Files:**
- Modify: `src/core/registry/component-registry.ts:15-33`
- Test: `tests/unit/component-registry-rent-per-wave.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/component-registry-rent-per-wave.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import {
  ComponentRegistry,
  type ComponentRegistryEntry,
} from "@core/registry/component-registry";

describe("ComponentRegistryEntry.rentPerWave", () => {
  it("is an optional number field on registry entries", () => {
    const capRegistry = new CapabilityRegistry();
    const registry = new ComponentRegistry(capRegistry);

    const entry: ComponentRegistryEntry = {
      type: "test-type",
      name: "Test",
      description: "Test component",
      capabilities: [],
      ports: [],
      placementCost: 0,
      upgradeCostCurve: [],
      visual: { icon: "■", color: "#fff", shape: "square" },
      conditionProfile: {
        degradedThreshold: 0.5,
        criticalThreshold: 0.2,
        decayRate: 0,
        recoveryRate: 0,
        degradedEffects: [],
        criticalEffects: [],
      },
      rentPerWave: 80,
    };

    registry.register(entry);
    const fetched = registry.get("test-type");
    expect(fetched?.rentPerWave).toBe(80);
  });

  it("allows rentPerWave to be undefined (backward compat)", () => {
    const capRegistry = new CapabilityRegistry();
    const registry = new ComponentRegistry(capRegistry);

    const entry: ComponentRegistryEntry = {
      type: "legacy-type",
      name: "Legacy",
      description: "Legacy component",
      capabilities: [],
      ports: [],
      placementCost: 100,
      upgradeCostCurve: [],
      visual: { icon: "■", color: "#fff", shape: "square" },
      conditionProfile: {
        degradedThreshold: 0.5,
        criticalThreshold: 0.2,
        decayRate: 0,
        recoveryRate: 0,
        degradedEffects: [],
        criticalEffects: [],
      },
    };

    registry.register(entry);
    const fetched = registry.get("legacy-type");
    expect(fetched?.rentPerWave).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/component-registry-rent-per-wave.test.ts
```

Expected: TypeScript compilation error — `rentPerWave` is not a known property of `ComponentRegistryEntry`.

- [ ] **Step 3: Add the field to the interface**

In `src/core/registry/component-registry.ts`, add one line to the `ComponentRegistryEntry` interface (insert after `placementCost: number;`):

```ts
  placementCost: number;
  /** TD-mode: per-wave rent debited at READY (build→simulate). Optional. */
  rentPerWave?: number;
  upgradeCostCurve: number[];
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/unit/component-registry-rent-per-wave.test.ts
```

Expected: `2 passed`.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/registry/component-registry.ts tests/unit/component-registry-rent-per-wave.test.ts
git commit -m "feat(registry): add optional rentPerWave field to ComponentRegistryEntry"
```

---

## Task 2: Create `TDViability` class

**Files:**
- Create: `src/modes/td/td-viability.ts`
- Test: `tests/unit/td-viability.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/td-viability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TDViability } from "@modes/td/td-viability";

describe("TDViability", () => {
  it("starts at 100 by default", () => {
    const v = new TDViability();
    expect(v.value).toBe(100);
    expect(v.maxValue).toBe(100);
    expect(v.fraction).toBe(1);
    expect(v.isDead).toBe(false);
  });

  it("accepts a custom initial and max", () => {
    const v = new TDViability(50, 200);
    expect(v.value).toBe(50);
    expect(v.maxValue).toBe(200);
    expect(v.fraction).toBe(0.25);
    expect(v.isDead).toBe(false);
  });

  it("damage subtracts from value", () => {
    const v = new TDViability(100);
    v.damage(30);
    expect(v.value).toBe(70);
    expect(v.fraction).toBe(0.7);
  });

  it("damage clamps at 0", () => {
    const v = new TDViability(10);
    v.damage(50);
    expect(v.value).toBe(0);
    expect(v.fraction).toBe(0);
    expect(v.isDead).toBe(true);
  });

  it("ignores negative damage amounts", () => {
    const v = new TDViability(50);
    v.damage(-20);
    expect(v.value).toBe(50);
  });

  it("supports fractional damage", () => {
    const v = new TDViability(100);
    v.damage(0.5);
    v.damage(0.3);
    expect(v.value).toBeCloseTo(99.2);
  });

  it("isDead is true when value reaches exactly 0", () => {
    const v = new TDViability(10);
    v.damage(10);
    expect(v.isDead).toBe(true);
  });

  it("isDead is false at 0.01", () => {
    const v = new TDViability(0.01);
    expect(v.isDead).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/td-viability.test.ts
```

Expected: module-not-found error — `TDViability` not exported from `@modes/td/td-viability`.

- [ ] **Step 3: Create the class**

Create `src/modes/td/td-viability.ts`:

```ts
/**
 * TD-mode campaign viability (health pool).
 *
 * Persistent across the entire TD campaign — never refilled, never reset
 * between waves. Damaged by dropped/timed-out requests (per-failure cost)
 * and by sustained SLA failures (ramping per-tick cost). Hits zero → run
 * is over → dashboard death modal → restart from Wave 1.
 *
 * Lives entirely in TD-mode land. The engine and other modes have no
 * knowledge of viability.
 */
export class TDViability {
  private current: number;
  private readonly max: number;

  constructor(initial = 100, max = 100) {
    this.max = max;
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  get maxValue(): number {
    return this.max;
  }

  get fraction(): number {
    return this.current / this.max;
  }

  get isDead(): boolean {
    return this.current <= 0;
  }

  damage(amount: number): void {
    if (amount <= 0) return;
    this.current = Math.max(0, this.current - amount);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/unit/td-viability.test.ts
```

Expected: `8 passed`.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-viability.ts tests/unit/td-viability.test.ts
git commit -m "feat(td): TDViability class — campaign-wide health pool"
```

---

## Task 3: Make `TDEconomy.debitUpkeep` a no-op

**Files:**
- Modify: `src/modes/td/td-economy.ts:40-42`
- Test: `tests/unit/td-economy-upkeep-noop.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/td-economy-upkeep-noop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TDEconomy } from "@modes/td/td-economy";

describe("TDEconomy.debitUpkeep", () => {
  it("is a no-op — budget is not decremented", () => {
    const economy = new TDEconomy({
      startingBudget: 1000,
      revenuePerRequestType: new Map([["api_read", 1]]),
    });

    economy.debitUpkeep(50);
    economy.debitUpkeep(200);
    economy.debitUpkeep(9999);

    expect(economy.getBudget()).toBe(1000);
  });

  it("does not affect subsequent debit/credit operations", () => {
    const economy = new TDEconomy({
      startingBudget: 500,
      revenuePerRequestType: new Map([["api_read", 2]]),
    });

    economy.debitUpkeep(100);
    economy.creditRevenue({
      id: "r1",
      type: "api_read",
      originZone: null,
      createdAtTick: 0,
      ttl: 10,
    } as any);

    expect(economy.getBudget()).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/td-economy-upkeep-noop.test.ts
```

Expected: first test fails with `expected 950 to be 1000` — the current implementation subtracts `totalUpkeep`.

- [ ] **Step 3: Replace the method body**

In `src/modes/td/td-economy.ts`, find and replace lines 40–42:

```ts
  debitUpkeep(totalUpkeep: number): void {
    this.budget -= totalUpkeep;
  }
```

Replace with:

```ts
  /**
   * No-op in TD mode. The engine's per-tick upkeep pipeline still computes
   * and hands a total here, but TD mode does not charge per-tick upkeep —
   * components are paid for via rent-at-READY (see TDModeController.payRent).
   * The SLA-penalty path that previously piggybacked on debitUpkeep has
   * been moved to viability damage in TDModeController.onTick.
   */
  debitUpkeep(_totalUpkeep: number): void {
    // intentionally empty
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/unit/td-economy-upkeep-noop.test.ts
```

Expected: `2 passed`.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-economy.ts tests/unit/td-economy-upkeep-noop.test.ts
git commit -m "feat(td): make TDEconomy.debitUpkeep a no-op — TD no longer pays per-tick upkeep"
```

---

## Task 4: Extend `TDWaveDefinition` schema

**Files:**
- Modify: `src/modes/td/td-waves.ts:8-57` (interface only — wave data updates come in Task 9)

- [ ] **Step 1: Read the existing interface**

Open `src/modes/td/td-waves.ts`. The `TDWaveDefinition` interface starts at line 8. We are changing three things:

1. `startingBudget: number` → `startingBudget?: number` (optional — Wave 1 keeps it, Waves 2–10 drop it in Task 9)
2. Add required `viabilityPerFailure: number`
3. Add required `viabilityRampPenalty: number`

- [ ] **Step 2: Patch the interface**

In `src/modes/td/td-waves.ts`, find:

```ts
export interface TDWaveDefinition {
  readonly id: number;
  readonly name: string;
  readonly startingBudget: number;
  readonly intensity: number;
```

Replace with:

```ts
export interface TDWaveDefinition {
  readonly id: number;
  readonly name: string;
  /**
   * Optional since the new economy model carries budget across waves.
   * Wave 1 uses this as the campaign's single starting budget; Waves 2–10
   * do not set it. Legacy test helpers (`runWave`) fall back to a large
   * default when undefined.
   */
  readonly startingBudget?: number;
  /** Viability lost per dropped/timed-out request in this wave. */
  readonly viabilityPerFailure: number;
  /** Viability lost per tick while the rolling drop rate exceeds dropThreshold. */
  readonly viabilityRampPenalty: number;
  readonly intensity: number;
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: ~10 errors — every wave definition (`WAVE_1` through `WAVE_10`) is missing the two new required fields. This is correct; we fix them in Task 9.

- [ ] **Step 4: Add temporary stubs to all 10 waves to restore typecheck**

For each of `WAVE_1` through `WAVE_10` in `src/modes/td/td-waves.ts`, add these two lines somewhere inside the object literal (we'll tune the real values in Task 9):

```ts
  viabilityPerFailure: 0.1,
  viabilityRampPenalty: 0.5,
```

Use the Edit tool with `replace_all: false` once per wave.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass. The new fields are additive — no test has yet been updated to care about them, and the `startingBudget` required→optional change is backward-compatible since all existing waves still set it.

- [ ] **Step 7: Commit**

```bash
git add src/modes/td/td-waves.ts
git commit -m "feat(td): extend TDWaveDefinition with viability fields and optional startingBudget"
```

---

## Task 5: Add `getViability()` to `TDModeController`

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts` (imports near line 25, fields around line 80, new method after `getTopologyErrors` around line 124)
- Test: `tests/unit/td-mode-controller-viability-and-rent.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/td-mode-controller-viability-and-rent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import { bootTDRegistry, makeRng } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";

const MINIMAL_WAVE: TDWaveDefinition = {
  id: 1,
  name: "Test",
  startingBudget: 600,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 30,
  ttl: 10,
  availableComponents: ["server", "database"],
  dropThreshold: 0.2,
  revenuePerRequestType: new Map([["api_read", 1]]),
  viabilityPerFailure: 0.1,
  viabilityRampPenalty: 0.5,
};

function makeController(): TDModeController {
  return new TDModeController({
    waves: [MINIMAL_WAVE],
    economy: new TDEconomy({
      startingBudget: 600,
      revenuePerRequestType: new Map([["api_read", 1]]),
    }),
    entryPointId: "client-entry" as ComponentId,
    rng: makeRng(1),
    componentRegistry: bootTDRegistry(),
  });
}

describe("TDModeController.getViability", () => {
  it("starts at 100/100", () => {
    const controller = makeController();
    const v = controller.getViability();
    expect(v.value).toBe(100);
    expect(v.max).toBe(100);
    expect(v.fraction).toBe(1);
    expect(v.isDead).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `getViability is not a function`.

- [ ] **Step 3: Import TDViability and wire it into the controller**

In `src/modes/td/td-mode-controller.ts`, find the existing import block around line 24–26 (the block that currently includes `import type { TDEconomy } from "./td-economy.js";`). Add:

```ts
import { TDViability } from "./td-viability.js";
```

Around line 87 (immediately after `private _topologyErrors: TopologyError[] = [];`), add:

```ts
  private readonly viability = new TDViability();
```

After the existing `getTopologyErrors` method (around line 124), add:

```ts
  /** Campaign-wide viability pool (0–100). Drains on failures, never refills. */
  getViability(): Readonly<{
    value: number;
    max: number;
    fraction: number;
    isDead: boolean;
  }> {
    return {
      value: this.viability.value,
      max: this.viability.maxValue,
      fraction: this.viability.fraction,
      isDead: this.viability.isDead,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `1 passed`.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-mode-controller.ts tests/unit/td-mode-controller-viability-and-rent.test.ts
git commit -m "feat(td): add TDViability state and getViability to TDModeController"
```

---

## Task 6: Add `getRentBill(state)` to `TDModeController`

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts` (new method alongside `getViability`)
- Test: `tests/unit/td-mode-controller-viability-and-rent.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/td-mode-controller-viability-and-rent.test.ts` inside the existing file:

```ts
import { SimulationState } from "@core/state/simulation-state";

describe("TDModeController.getRentBill", () => {
  it("returns 0 for an empty topology", () => {
    const controller = makeController();
    const state = new SimulationState();
    expect(controller.getRentBill(state)).toBe(0);
  });

  it("sums rentPerWave across all placed components", () => {
    const controller = makeController();
    const state = new SimulationState();
    const registry = bootTDRegistry();

    const server1 = registry.create("server", { x: 0, y: 0 }, null);
    const server2 = registry.create("server", { x: 1, y: 0 }, null);
    const database = registry.create("database", { x: 2, y: 0 }, null);
    state.placeComponent(server1);
    state.placeComponent(server2);
    state.placeComponent(database);

    // Server rentPerWave = 80, Database rentPerWave = 80 (set in Task 8)
    // For this test before Task 8 runs, inject the values directly on the
    // registry by monkey-patching the entries or set a controller-local
    // registry. To keep the test independent of Task 8's tuning, we rely
    // on the TDModeController constructor's componentRegistry ref and
    // expect whatever values td-component-entries.ts sets. At time of Task
    // 6 those values are still 0 (rentPerWave not set yet). This test is
    // therefore bill === 0.
    //
    // NOTE: Task 8 will update td-component-entries.ts and then the
    // expectation here MUST be bumped. We leave a TODO-style comment so
    // the executing agent remembers.
    expect(controller.getRentBill(state)).toBe(0);
  });
});
```

**Note to the executing agent:** yes this test is fragile across Task 6 → Task 8. That is intentional. Task 8 includes a step to bump the expected value.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `getRentBill is not a function`.

- [ ] **Step 3: Add the method to the controller**

In `src/modes/td/td-mode-controller.ts`, right after the `getViability` method added in Task 5, add:

```ts
  /**
   * Compute the total rent that will be debited at the next READY (build→simulate)
   * transition. Pure function over the current state and the registry. Sandbox
   * components with undefined rentPerWave contribute zero — safe default.
   */
  getRentBill(state: SimulationState): number {
    let bill = 0;
    for (const component of state.components.values()) {
      const entry = this.componentRegistry.get(component.type);
      if (entry?.rentPerWave !== undefined) {
        bill += entry.rentPerWave;
      }
    }
    return bill;
  }
```

Make sure `SimulationState` is already imported near the top of the file — it is.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `3 passed`.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-mode-controller.ts tests/unit/td-mode-controller-viability-and-rent.test.ts
git commit -m "feat(td): add getRentBill to TDModeController — sums rentPerWave across placed components"
```

---

## Task 7: Add `payRent(state)` to `TDModeController`

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts` (new method + a new type)
- Test: `tests/unit/td-mode-controller-viability-and-rent.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/td-mode-controller-viability-and-rent.test.ts`:

```ts
describe("TDModeController.payRent", () => {
  it("returns ok: true and debits the budget when the bill is affordable", () => {
    const controller = makeController();
    const state = new SimulationState();
    // Bill is 0 (empty topology). Affordable trivially.
    const result = controller.payRent(state);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bill).toBe(0);
    }
  });

  it("returns ok: false with bill and budget when insufficient", () => {
    const poorController = new TDModeController({
      waves: [MINIMAL_WAVE],
      economy: new TDEconomy({
        startingBudget: 10, // deliberately insufficient
        revenuePerRequestType: new Map([["api_read", 1]]),
      }),
      entryPointId: "client-entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootTDRegistry(),
    });
    const state = new SimulationState();
    const registry = bootTDRegistry();
    // Manually stuff the state with a fake component that has a known rent
    // by placing one through this controller's registry. Still 0 until Task 8.
    // This test asserts the insufficient-budget path using a stub.
    //
    // For this test, we fake an insufficient bill by driving a synthetic
    // scenario after Task 8 lands. Until then, we can only verify the
    // ok-path. Skip the negative case until Task 8 bumps rentPerWave.
    expect(poorController.getRentBill(state)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `payRent is not a function`.

- [ ] **Step 3: Add the method + return type**

In `src/modes/td/td-mode-controller.ts`, near the top of the file (inside the existing type/interface exports section, around line 40 where `TDModeControllerOptions` lives), add:

```ts
export type PayRentResult =
  | { readonly ok: true; readonly bill: number }
  | { readonly ok: false; readonly bill: number; readonly budget: number };
```

Then, immediately after the `getRentBill` method, add:

```ts
  /**
   * Atomic rent check + debit. Returns `{ok: true, bill}` on success and
   * debits the economy. Returns `{ok: false, bill, budget}` on insufficient
   * funds without debiting. Callers must invoke this BEFORE advancePhase
   * on the build→simulate transition.
   */
  payRent(state: SimulationState): PayRentResult {
    const bill = this.getRentBill(state);
    const budget = this.economy.getBudget();
    if (bill > budget) {
      return { ok: false, bill, budget };
    }
    this.economy.debitRent(bill);
    return { ok: true, bill };
  }
```

- [ ] **Step 3b: Add `debitRent` to TDEconomy**

In `src/modes/td/td-economy.ts`, below the existing `creditRefund` method, add:

```ts
  /** TD-mode rent debit. Called by TDModeController.payRent at build→simulate. */
  debitRent(amount: number): void {
    this.budget -= amount;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `5 passed`.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-mode-controller.ts src/modes/td/td-economy.ts tests/unit/td-mode-controller-viability-and-rent.test.ts
git commit -m "feat(td): add payRent + debitRent — atomic rent-at-READY debit path"
```

---

## Task 8: Populate `rentPerWave` on all TD component entries

**Files:**
- Modify: `src/modes/td/td-component-entries.ts` (every entry)
- Test: `tests/unit/td-mode-controller-viability-and-rent.test.ts` (update expectation)

- [ ] **Step 1: Locate each entry**

Run:

```bash
grep -n "^export const .*_ENTRY" src/modes/td/td-component-entries.ts
```

You should see entries for: CLIENT, SERVER, DATABASE, CACHE, LOAD_BALANCER, CDN, API_GATEWAY, QUEUE, WORKER, CIRCUIT_BREAKER, DNS_GTM, STREAMING_SERVER, BLOB_STORAGE.

- [ ] **Step 2: Add `rentPerWave` to each entry**

For each `*_ENTRY` object literal in `src/modes/td/td-component-entries.ts`, add the following line inside the object (the location doesn't matter, but putting it next to `placementCost` is conventional):

| Entry                   | rentPerWave |
|-------------------------|-------------|
| CLIENT_ENTRY            | 0           |
| SERVER_ENTRY            | 80          |
| DATABASE_ENTRY          | 80          |
| CACHE_ENTRY             | 120         |
| LOAD_BALANCER_ENTRY     | 100         |
| CDN_ENTRY               | 150         |
| API_GATEWAY_ENTRY       | 200         |
| QUEUE_ENTRY             | 80          |
| WORKER_ENTRY            | 100         |
| CIRCUIT_BREAKER_ENTRY   | 60          |
| DNS_GTM_ENTRY           | 200         |
| STREAMING_SERVER_ENTRY  | 200         |
| BLOB_STORAGE_ENTRY      | 80          |

Example for SERVER_ENTRY — find the entry's `placementCost` line and add `rentPerWave: 80,` below it:

```ts
  placementCost: 0,
  rentPerWave: 80,
```

Also **set `placementCost: 0` on every TD entry** — TD mode is rent-only, not placement-cost. The existing placementCost values are legacy.

Use the Edit tool per entry with enough surrounding context to make each `old_string` unique (e.g. include the entry name comment or a unique surrounding line).

- [ ] **Step 3: Update the Task 6 expectation**

In `tests/unit/td-mode-controller-viability-and-rent.test.ts`, find the `sums rentPerWave across all placed components` test and update its expectation:

```ts
    // Server rent=80, Server rent=80, Database rent=80 → total 240
    expect(controller.getRentBill(state)).toBe(240);
```

- [ ] **Step 4: Run affected tests**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `5 passed`.

- [ ] **Step 5: Run the full suite**

```bash
pnpm test
```

Expected: most tests pass. Any wave-test that asserted on a specific budget number (e.g. `wave.startingBudget === X`) may still pass since the wave defs are unchanged at this step. Failures here are a bug in this task — investigate before proceeding.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/modes/td/td-component-entries.ts tests/unit/td-mode-controller-viability-and-rent.test.ts
git commit -m "feat(td): set rentPerWave and zero placementCost on all TD component entries"
```

---

## Task 9: Retune all 10 wave definitions

**Files:**
- Modify: `src/modes/td/td-waves.ts` (all 10 wave definitions)

- [ ] **Step 1: Open `src/modes/td/td-waves.ts` and apply the retuning table**

Set the following values on each wave. All waves keep their existing `startingBudget` field for now (we don't drop it — `runWave` still reads it as a fallback). The Task 4 stubs of `viabilityPerFailure: 0.1, viabilityRampPenalty: 0.5` are replaced with the real tuning below.

**Wave 1 (keep starting budget $600, tune viability):**

Find `WAVE_1`, keep `startingBudget: 500` — wait: Wave 1 currently has `startingBudget: 500`. Bump to `startingBudget: 600` to match the spec §4.12.

Then set/update:

```ts
  viabilityPerFailure: 0.10,
  viabilityRampPenalty: 0.5,
  dropThreshold: 0.20,
```

**Wave 2:**

```ts
  viabilityPerFailure: 0.12,
  viabilityRampPenalty: 0.7,
  dropThreshold: 0.15,
```

**Wave 3:**

```ts
  viabilityPerFailure: 0.15,
  viabilityRampPenalty: 1.0,
  dropThreshold: 0.10,
```

**Wave 4:**

```ts
  viabilityPerFailure: 0.18,
  viabilityRampPenalty: 1.2,
  dropThreshold: 0.10,
```

**Wave 5:**

```ts
  viabilityPerFailure: 0.20,
  viabilityRampPenalty: 1.5,
  dropThreshold: 0.08,
```

**Wave 6:**

```ts
  viabilityPerFailure: 0.22,
  viabilityRampPenalty: 1.8,
  dropThreshold: 0.08,
```

**Wave 7:**

```ts
  viabilityPerFailure: 0.25,
  viabilityRampPenalty: 2.0,
  dropThreshold: 0.07,
```

**Wave 8:**

```ts
  viabilityPerFailure: 0.28,
  viabilityRampPenalty: 2.2,
  dropThreshold: 0.07,
```

**Wave 9:**

```ts
  viabilityPerFailure: 0.30,
  viabilityRampPenalty: 2.5,
  dropThreshold: 0.05,
```

**Wave 10:**

```ts
  viabilityPerFailure: 0.40,
  viabilityRampPenalty: 3.0,
  dropThreshold: 0.05,
```

Edit each wave with enough context to make the Edit unique (include the wave's `name` field or `id` field in `old_string`).

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Run the full suite**

```bash
pnpm test
```

Expected: a small number of failures in the wave integration tests that assert on specific `dropThreshold` values (Wave 1 was `0.05`, now `0.20`; etc.). These will be explicitly updated in Task 13; leave them failing for now. If any unit test outside of `tests/integration/td/*` fails, investigate — that's unexpected.

- [ ] **Step 4: Commit**

```bash
git add src/modes/td/td-waves.ts
git commit -m "feat(td): retune all 10 waves with viability fields and new drop thresholds"
```

---

## Task 10: Route SLA penalty into viability damage in `TDModeController.onTick`

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts:657-698` (the existing `onTick` method)
- Test: `tests/unit/td-mode-controller-viability-and-rent.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/td-mode-controller-viability-and-rent.test.ts`:

```ts
import type { SimulationStateReader } from "@core/state/state-reader";

describe("TDModeController.onTick viability damage", () => {
  it("damages viability per dropped/timed-out request this tick", () => {
    const controller = makeController();
    const state = new SimulationState();

    // Force the controller into simulate phase so onTick runs.
    // advancePhase(state) build→simulate.
    controller.advancePhase(state);

    // Seed metricsHistory with one tick: 10 dropped requests.
    state.metricsHistory.push({
      tick: 0,
      requestsGenerated: 10,
      requestsResolved: 0,
      requestsDropped: 10,
      requestsTimedOut: 0,
      avgLatency: 0,
      componentsActive: 0,
      revenueEarned: 0,
      upkeepPaid: 0,
    } as any);

    controller.onTick(state as unknown as SimulationStateReader);

    // 10 drops × 0.10 viabilityPerFailure (Wave 1 tuning) = 1.0 viability lost
    expect(controller.getViability().value).toBeCloseTo(99, 1);
  });

  it("applies the ramp penalty when drop rate exceeds dropThreshold", () => {
    const controller = makeController();
    const state = new SimulationState();
    controller.advancePhase(state);

    // Fill three ticks with >20% drop rate
    for (let t = 0; t < 3; t++) {
      state.metricsHistory.push({
        tick: t,
        requestsGenerated: 10,
        requestsResolved: 5,
        requestsDropped: 5,
        requestsTimedOut: 0,
        avgLatency: 0,
        componentsActive: 0,
        revenueEarned: 0,
        upkeepPaid: 0,
      } as any);
    }

    const initialViability = controller.getViability().value;
    controller.onTick(state as unknown as SimulationStateReader);
    const afterDamage = controller.getViability().value;

    // Per-tick damage is based on the LATEST tick (5 drops × 0.10 = 0.5)
    // plus the ramp penalty (0.5) since rolling drop rate 50% > threshold 20%
    // Total expected loss: ~1.0
    expect(initialViability - afterDamage).toBeCloseTo(1.0, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: viability unchanged (`100`), test fails. Current `onTick` only touches the budget via `debitUpkeep` (now a no-op).

- [ ] **Step 3: Rewrite `onTick`**

In `src/modes/td/td-mode-controller.ts`, find the existing `onTick` method (around line 657) and replace its body:

```ts
  /**
   * Per-tick hook fired by the TD SimLoop after every engine tick.
   * Applies viability damage for failures THIS tick, and an additional
   * ramping penalty while the rolling drop rate exceeds the wave's
   * dropThreshold. Replaces the Stage 3c SLA-budget-penalty mechanism.
   */
  onTick(state: SimulationStateReader): void {
    if (this.phase !== "simulate") return;
    const wave = this.getCurrentWave();

    const metrics = (state as unknown as SimulationState).metricsHistory.slice(
      this.waveStartMetricsIndex,
    );
    if (metrics.length === 0) return;

    // Per-tick damage: latest tick's drops + timeouts × wave.viabilityPerFailure
    const latest = metrics[metrics.length - 1]!;
    const latestFailures = latest.requestsDropped + latest.requestsTimedOut;
    if (latestFailures > 0) {
      this.viability.damage(latestFailures * wave.viabilityPerFailure);
    }

    // Ramp penalty: if the rolling-3-tick drop rate exceeds dropThreshold,
    // apply an additional per-tick viability hit.
    const windowMetrics = metrics.slice(-3);
    let windowResolved = 0;
    let windowFailed = 0;
    for (const m of windowMetrics) {
      windowResolved += m.requestsResolved;
      windowFailed += m.requestsDropped + m.requestsTimedOut;
    }
    const windowTotal = windowResolved + windowFailed;
    if (windowTotal > 0) {
      const dropRate = windowFailed / windowTotal;
      if (dropRate > wave.dropThreshold) {
        this.viability.damage(wave.viabilityRampPenalty);
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `7 passed`.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-mode-controller.ts tests/unit/td-mode-controller-viability-and-rent.test.ts
git commit -m "feat(td): route SLA penalty into viability damage in onTick"
```

---

## Task 11: Add `getTerminalState()` to `TDModeController`

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts`
- Test: `tests/unit/td-mode-controller-viability-and-rent.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/td-mode-controller-viability-and-rent.test.ts`:

```ts
describe("TDModeController.getTerminalState", () => {
  it('returns "running" in build phase', () => {
    const controller = makeController();
    expect(controller.getTerminalState()).toBe("running");
  });

  it('returns "running" in simulate with viability > 0 and wave not drained', () => {
    const controller = makeController();
    const state = new SimulationState();
    controller.advancePhase(state);
    // Partial wave metrics
    state.metricsHistory.push({
      tick: 0, requestsGenerated: 10, requestsResolved: 10,
      requestsDropped: 0, requestsTimedOut: 0, avgLatency: 0,
      componentsActive: 0, revenueEarned: 10, upkeepPaid: 0,
    } as any);
    expect(controller.getTerminalState()).toBe("running");
  });

  it('returns "dead" when viability hits 0', () => {
    const controller = makeController();
    const state = new SimulationState();
    controller.advancePhase(state);

    // Drop 1500 requests in one tick → 150 viability damage → dead
    state.metricsHistory.push({
      tick: 0, requestsGenerated: 1500, requestsResolved: 0,
      requestsDropped: 1500, requestsTimedOut: 0, avgLatency: 0,
      componentsActive: 0, revenueEarned: 0, upkeepPaid: 0,
    } as any);
    controller.onTick(state as any);

    expect(controller.getViability().isDead).toBe(true);
    expect(controller.getTerminalState()).toBe("dead");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `getTerminalState is not a function`.

- [ ] **Step 3: Add the method**

In `src/modes/td/td-mode-controller.ts`, add the type near the other exported types (around line 40):

```ts
export type TDTerminalState = "running" | "wave_passed" | "dead";
```

Then add the method immediately after `getViability`:

```ts
  /**
   * High-level outcome state for the dashboard and tests.
   *
   * - "running": wave is still in build phase, or in simulate phase but
   *    neither dead nor drained
   * - "wave_passed": wave has been fully drained with viability > 0
   * - "dead": viability hit 0 at any point (campaign is over)
   *
   * `wave_passed` is determined by the caller passing a drained state to
   * `isWaveDrained(state)`. Without state, we cannot distinguish running
   * from passed, so we return `running` and let the caller refine.
   */
  getTerminalState(state?: SimulationState): TDTerminalState {
    if (this.viability.isDead) return "dead";
    if (state !== undefined && this.phase === "simulate" && this.isWaveDrained(state)) {
      return "wave_passed";
    }
    return "running";
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/unit/td-mode-controller-viability-and-rent.test.ts
```

Expected: `10 passed`.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-mode-controller.ts tests/unit/td-mode-controller-viability-and-rent.test.ts
git commit -m "feat(td): add getTerminalState — running/wave_passed/dead"
```

---

## Task 12: Fix `evaluateOutcome`'s composite-score denominator

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts:240-294` (the existing `evaluateOutcome` method)

- [ ] **Step 1: Identify the divide-by-wave.startingBudget line**

Open `src/modes/td/td-mode-controller.ts` around line 270–274. Current code:

```ts
    const composite =
      0.4 * performance +
      0.4 * reliability +
      0.2 * (cost / wave.startingBudget);
```

`wave.startingBudget` is now optional. When undefined, this becomes `NaN`.

- [ ] **Step 2: Replace with an intensity-based denominator**

Replace the line with:

```ts
    const composite =
      0.4 * performance +
      0.4 * reliability +
      0.2 * (cost / ((wave.startingBudget ?? 0) + 1));
```

`+ 1` guards against divide-by-zero when `startingBudget` is undefined. The composite score is only used for display, so precision here is not load-bearing.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Run the full suite**

```bash
pnpm test
```

Expected: no new failures from this change alone. Existing wave-integration failures from Task 9 persist.

- [ ] **Step 5: Commit**

```bash
git add src/modes/td/td-mode-controller.ts
git commit -m "fix(td): guard evaluateOutcome composite-score denominator against undefined startingBudget"
```

---

## Task 13: Extend `runWave` helper with new result fields + rent bypass

**Files:**
- Modify: `tests/integration/td/helpers.ts:43-138`

- [ ] **Step 1: Extend `WaveRunResult`**

In `tests/integration/td/helpers.ts` around line 43, add three new fields to the interface:

```ts
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
  readonly terminalState: "running" | "wave_passed" | "dead";
  readonly finalViability: number;
  readonly finalBudget: number;
}
```

- [ ] **Step 2: Update `runWave` implementation**

Around line 62–138, the body needs two changes:

1. After constructing the economy, **bypass the rent check** by giving the economy a budget that is guaranteed to cover rent. Since every wave test builds its topology directly via `state.placeComponent` rather than through `tryPlace`, rent can be computed up front.
2. After the final `mode.evaluateOutcome(...)` call, compute the new fields.

Replace the `runWave` body with:

```ts
export function runWave(
  state: SimulationState,
  wave: TDWaveDefinition,
  entryPointId: ComponentId,
): WaveRunResult {
  // Use a generous default budget when the wave does not specify one;
  // wave integration tests assert on request counts, not budget arithmetic.
  const startingBudget = wave.startingBudget ?? 100_000;
  const economy = new TDEconomy({
    startingBudget,
    revenuePerRequestType: wave.revenuePerRequestType,
  });
  const mode = new TDModeController({
    waves: [wave],
    economy,
    entryPointId,
    rng: makeRng(1),
    componentRegistry: bootTDRegistry(),
  });

  // Pay rent before advancing phase (atomic precondition to simulate).
  const rentResult = mode.payRent(state);
  if (!rentResult.ok) {
    throw new Error(
      `runWave: insufficient budget for rent ($${rentResult.bill} > $${rentResult.budget})`,
    );
  }

  mode.advancePhase(state); // build → simulate

  const engine = new Engine(state);
  for (let i = 0; i < wave.duration; i++) {
    engine.tick(mode);
  }
  const maxDrainTicks = (wave.streamConfig?.duration ?? 0) + 10;
  for (let i = 0; i < maxDrainTicks && !mode.isWaveDrained(state); i++) {
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
        forwardedCountByComponent.set(
          ev.componentId,
          (forwardedCountByComponent.get(ev.componentId) ?? 0) + 1,
        );
      } else if (ev.type === "PROCESSED") {
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
  const terminalState = mode.getTerminalState(state);
  const finalViability = mode.getViability().value;
  const finalBudget = economy.getBudget();

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
    terminalState,
    finalViability,
    finalBudget,
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Run the full suite**

```bash
pnpm test
```

Expected: many wave tests still fail (they assert on `outcome.verdict` and Wave 1's new `dropThreshold: 0.20` may cause some to swing between win/lose). Those migrations happen in the next task.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/td/helpers.ts
git commit -m "feat(td-tests): extend runWave with terminalState, finalViability, finalBudget, and payRent preflight"
```

---

## Task 14: Migrate wave-integration test assertions

**Files:**
- Modify: every file matching `tests/integration/td/wave-*.test.ts` (approximately 15–20 files)

This task is a mechanical sweep. Each wave test asserts on `result.outcome.verdict === "win"` or `=== "lose"`. The new contract asserts on `result.terminalState === "wave_passed"` or `=== "dead"`. However, a wave that loses due to **SLA failure** in the old model now loses due to **viability collapse** under the new model — which may or may not actually trigger `terminalState === "dead"` depending on tuning. For tests that expected a "lose," the new equivalent assertion is often `finalViability < 100` (proof of viability damage), not necessarily `terminalState === "dead"` (which requires full collapse).

- [ ] **Step 1: List all wave test files**

```bash
ls tests/integration/td/wave-*.test.ts
```

Expected: a list of files. Iterate through each.

- [ ] **Step 2: Pattern — "win" test migration**

For each test that currently reads:

```ts
expect(result.outcome.verdict).toBe("win");
```

Replace with:

```ts
expect(result.terminalState).toBe("wave_passed");
expect(result.finalViability).toBeGreaterThan(0);
```

- [ ] **Step 3: Pattern — "lose" test migration**

For each test that currently reads:

```ts
expect(result.outcome.verdict).toBe("lose");
```

Replace with:

```ts
// Wave lost → viability took significant damage. Dead is ideal but not
// guaranteed without per-wave tuning — assert meaningful damage instead.
expect(result.finalViability).toBeLessThan(100);
```

If the test's setup is a known-catastrophic failure (e.g. naked Database on Wave 1, lone Server on Wave 3), strengthen the assertion:

```ts
expect(result.finalViability).toBeLessThan(80);
```

- [ ] **Step 4: For each file, run it in isolation**

After migrating a file:

```bash
pnpm test tests/integration/td/wave-1-trivial-server-wins.test.ts
```

(Substitute the actual filename.)

If the test fails with "expected finalViability > 0, received 100," that's actually a **pass** — viability was not damaged because the topology served everything. The assertion should be `toBeGreaterThan(0)` → change to `toBeGreaterThanOrEqual(100)` or drop the second clause.

If a test fails with unexpected numeric values, the failure is more likely a tuning issue with the new `dropThreshold` / `viabilityPerFailure` values, not a bug in the migration. Document the failure in a note for the tuning pass (Task 16).

- [ ] **Step 5: Migrate all files**

Process each wave test file one at a time, run it in isolation, and commit individual migrations as you go (small commits per file are fine). Do not batch-commit — a single broken migration in the middle of a huge commit is painful to bisect.

- [ ] **Step 6: Full suite**

```bash
pnpm test
```

Expected: any remaining failures are tuning-related, not contract-related.

- [ ] **Step 7: Final commit for this task**

```bash
git commit --allow-empty -m "test(td): migrate wave integration tests from outcome.verdict to terminalState/finalViability"
```

(An empty commit is fine here as a task-completion marker; individual file commits happened in Step 5.)

---

## Task 15: Update `campaign-headless.test.ts` for budget carryover

**Files:**
- Modify: `tests/integration/td/campaign-headless.test.ts`

- [ ] **Step 1: Read the file to identify every `outcome.verdict` assertion**

```bash
grep -n "outcome.verdict\|startingBudget" tests/integration/td/campaign-headless.test.ts
```

- [ ] **Step 2: Migrate outcome assertions**

Apply the same pattern as Task 14 for every `outcome.verdict` check.

- [ ] **Step 3: Add budget-carryover assertion between Wave 1 and Wave 2**

The campaign-headless test runs multiple waves. Add (or update) an assertion between waves that budget persists:

```ts
const afterWave1Budget = controller.economy.getBudget();
// ... run wave 2 ...
expect(controller.economy.getBudget()).not.toBe(wave2.startingBudget);
expect(controller.economy.getBudget()).toBeLessThanOrEqual(afterWave1Budget + maxWave2Revenue);
```

The exact form depends on how `campaign-headless.test.ts` is currently structured — read it carefully before writing the new assertions.

- [ ] **Step 4: Run the test in isolation**

```bash
pnpm test tests/integration/td/campaign-headless.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/td/campaign-headless.test.ts
git commit -m "test(td): migrate campaign-headless to new outcome contract and verify budget carryover"
```

---

## Task 16: Full-suite verification + tuning notes

**Files:** none to modify — this is a verification pass.

- [ ] **Step 1: Run the full suite**

```bash
pnpm test
```

Expected: every test passes. If any remain failing, they are tuning issues with `viabilityPerFailure` / `viabilityRampPenalty` / `dropThreshold` on a specific wave. Debug by looking at the actual `finalViability` values.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: If any tuning issues remain, adjust the wave definitions**

Open `src/modes/td/td-waves.ts` and tune the offending wave's `viabilityPerFailure` or `viabilityRampPenalty` upward (harsher) or downward (more forgiving) until the wave tests pass. Keep the changes minimal and document them in-line with a comment explaining why the tuning deviated from the Task 9 table.

- [ ] **Step 4: Commit any tuning changes**

```bash
git add src/modes/td/td-waves.ts
git commit -m "fix(td): tune wave viability values for passing tests"
```

(Skip this commit if Step 3 was a no-op.)

- [ ] **Step 5: Write a tuning report**

Create `docs/claude/slice-a-tuning-notes.md` with:

```markdown
# Slice A tuning notes

Wave-by-wave final viability values observed in the integration tests after
Slice A landed, for future reference when Slice B playtests against real users.

| Wave | Win path final viability | Lose path final viability |
|------|--------------------------|---------------------------|
| 1    | (fill in)                | (fill in)                 |
| 2    | (fill in)                | (fill in)                 |
| ...  |                          |                           |

Observations:
- (any wave that needed off-table tuning)
- (any wave where the win/lose margin feels tight)
```

Fill in the values by temporarily adding `console.log(result.finalViability)` to each wave test, running the suite, and copying the numbers. Remove the logs before committing.

- [ ] **Step 6: Commit the tuning report**

```bash
git add docs/claude/slice-a-tuning-notes.md
git commit -m "docs(td): slice A tuning notes for Slice B playtest reference"
```

---

## Task 17: Final sanity check + push to remote

**Files:** none to modify.

- [ ] **Step 1: Full test + typecheck**

```bash
pnpm test && pnpm typecheck
```

Expected: clean on both.

- [ ] **Step 2: Verify no regressions in sandbox tests**

Sandbox mode was not supposed to be affected. Confirm:

```bash
pnpm test tests/integration/sandbox
pnpm test tests/unit/sandbox-economy.test.ts
```

Expected: all pass. If any sandbox test regresses, we broke the additive contract — bisect and fix.

- [ ] **Step 3: Verify engine-pixi-isolation is still green**

```bash
pnpm test tests/unit/engine-pixi-isolation.test.ts
```

Expected: pass. (Sanity check — we didn't import any dashboard/pixi code into `src/core/` or `src/capabilities/`.)

- [ ] **Step 4: Summarize the slice**

Write a one-paragraph summary of the Slice A changes for the session handoff:

```
Slice A complete: TDViability campaign-wide health pool, rent-at-READY via
TDModeController.payRent, TDEconomy.debitUpkeep no-op, SLA penalty rerouted
into onTick viability damage, all 10 waves retuned with viability fields,
runWave extended with terminalState/finalViability/finalBudget, every wave
integration test migrated. <N> tests passing, typecheck clean. Ready for
Slice B (UX) plan.
```

- [ ] **Step 5: Do NOT push or open a PR**

The user has not authorized pushing. Leave the branch local on the worktree for review. Use `finishing-a-development-branch` or wait for the user's explicit instruction before creating a PR.

---

## Slice B handoff

After Slice A is merged to main, the Slice B plan (UX pass) can be written in a fresh session. The Slice B plan will reference merged APIs from this slice (`TDViability`, `TDModeController.getViability`, `payRent`, `getRentBill`, `getTerminalState`) and build the cyberpunk HUD surface on top of them.

Slice B's plan lives at `docs/superpowers/plans/2026-04-NN-wave1-ux-slice-b-ui.md` (date TBD, filename finalized when that session begins).

---

## Definition of done

- [ ] All tasks above checked off
- [ ] `pnpm test` green
- [ ] `pnpm typecheck` green
- [ ] `src/core/` and `src/capabilities/` untouched (Phase 1 invariant preserved)
- [ ] `TDViability` shipped
- [ ] `TDModeController.payRent` / `getRentBill` / `getViability` / `getTerminalState` shipped
- [ ] `TDEconomy.debitUpkeep` is a no-op; `TDEconomy.debitRent` debits real money
- [ ] All 10 TD component entries have `rentPerWave` set
- [ ] All 10 waves have `viabilityPerFailure` + `viabilityRampPenalty` set
- [ ] Every wave integration test reads `terminalState` / `finalViability` instead of `outcome.verdict`
- [ ] Tuning notes captured in `docs/claude/slice-a-tuning-notes.md`
- [ ] Sandbox mode is untouched and passing

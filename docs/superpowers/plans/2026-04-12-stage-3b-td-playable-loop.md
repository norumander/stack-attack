# Stage 3b — TD Mode Playable Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TD mode actually playable end-to-end — a human can sit at the dashboard, place components, watch waves run, and progress through the existing 3-wave learning arc interactively.

**Architecture:** Real `tryPlace` / new `tryConnect` on `TDModeController`, multi-wave support in the controller, self-counting `TDTrafficSource`, TD-tuned capability factories in `registerTDDefaults`, new `CLIENT_ENTRY`, dashboard TD-mode toggle. No engine changes, no new capabilities. Stage 3a tests pinned via a back-compat shim on `TDModeController`'s constructor.

**Tech Stack:** TypeScript (strict, ESM, branded IDs), Vitest, pnpm, Vite (existing dashboard).

**Spec:** [`docs/superpowers/specs/2026-04-12-stage-3b-td-playable-loop-design.md`](../specs/2026-04-12-stage-3b-td-playable-loop-design.md) — read §5 (Architecture) and §7 (Tests) before starting any task.

**Key file paths (memorize):**
- Controller: `src/modes/td/td-mode-controller.ts`
- Traffic source: `src/modes/td/td-traffic-source.ts`
- Waves: `src/modes/td/td-waves.ts`
- TD entries: `src/modes/td/td-component-entries.ts`
- TD bootstrap: `src/modes/td/register-td-defaults.ts`
- Component registry: `src/core/registry/component-registry.ts`
- Connection type: `src/core/types/connection.ts`
- Dashboard main: `src/dashboard/main.ts`
- Dashboard sim loop: `src/dashboard/sim-loop.ts`
- TD test helpers: `tests/integration/td/helpers.ts`
- Stage 3a wave tests (DO NOT MODIFY): `tests/integration/td/wave-{1,2,3}-*.test.ts`

**Run tests:** `pnpm test` (full, ~5s) or `pnpm test tests/unit/td-...` (single file). **Typecheck:** `pnpm typecheck`. **Dashboard:** `pnpm dev` then visit `http://localhost:5173`.

**Stage 3b is mode-layer + dashboard work only.** No edits to `src/core/engine/**`, no edits to `src/capabilities/**` (only their factory call sites in `register-td-defaults.ts`).

---

## File Structure

**New files:**
- `tests/unit/td-mode-controller-place.test.ts` — `tryPlace` paths
- `tests/unit/td-mode-controller-connect.test.ts` — `tryConnect` paths
- `tests/unit/td-mode-controller-phase.test.ts` — multi-wave phase + `isWaveDrained` cases
- `tests/unit/td-traffic-source-self-counting.test.ts` — internal counter
- `tests/integration/td/campaign-headless.test.ts` — full 3-wave registry-path campaign
- `src/dashboard/td-mode.ts` — TD-mode-specific dashboard logic (palette, click handlers)

**Modified files:**
- `src/modes/td/td-mode-controller.ts` — multi-wave shape, real `tryPlace`/`tryConnect`, phase changes
- `src/modes/td/td-traffic-source.ts` — `ticksGenerated` counter, `isExhausted`
- `src/modes/td/td-waves.ts` — widen `id: 1 | 2 | 3` to `id: number`
- `src/modes/td/td-component-entries.ts` — new `CLIENT_ENTRY`; Cache/LB use `forwarding-pipe`
- `src/modes/td/register-td-defaults.ts` — TD-tuned factory options, `forwarding-pipe`, register Client
- `src/core/registry/component-registry.ts` — add `tryCreate`
- `src/dashboard/main.ts` — mode toggle, TD wiring
- `src/dashboard/sim-loop.ts` — parameterize over `ModeController`
- `src/dashboard/index.html` — TD HUD container, palette, READY button (hidden by default)
- `src/dashboard/styles.css` — TD HUD styles
- `CLAUDE.md` — implementation status update

**Untouched (must remain green):**
- `tests/integration/td/wave-{1,2,3}-*.test.ts` — Stage 3a tests
- `tests/integration/td/helpers.ts` — single-wave construction path preserved via shim
- `src/core/engine/**`, `src/capabilities/**`, `src/modes/sandbox/**`, `src/modes/td/td-economy.ts`

---

## Task 1: Widen `TDWaveDefinition.id` to `number`

**Why first:** trivial, isolated, unblocks adding Wave 4+ in Stage 3c without churning this stage's types.

**Files:**
- Modify: `src/modes/td/td-waves.ts:9`

- [ ] **Step 1: Open the file and locate the type**

Read `src/modes/td/td-waves.ts`. The current `TDWaveDefinition` has `readonly id: 1 | 2 | 3;` on line 9.

- [ ] **Step 2: Verify nothing else narrows on the literal**

Run:
```bash
grep -rn "wave.id ===\|wave\.id ==" src tests
```
Expected: zero hits. If anything matches, stop and report — the widening will break those call sites.

- [ ] **Step 3: Apply the change**

Edit `src/modes/td/td-waves.ts`:

```ts
export interface TDWaveDefinition {
  readonly id: number;          // was: 1 | 2 | 3
  readonly name: string;
  // ... rest unchanged
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: clean (no errors)

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: 564 tests passing (no behavioral change)

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-waves.ts
git commit -m "feat(td): widen TDWaveDefinition.id from literal union to number"
```

---

## Task 2: Add `ComponentRegistry.tryCreate`

**Why:** `tryPlace` needs a non-throwing variant of `create` to translate "unknown type" into a `PlacementResult` failure cleanly.

**Files:**
- Modify: `src/core/registry/component-registry.ts`
- Test: `tests/unit/component-registry-try-create.test.ts` (NEW)

- [ ] **Step 1: Read the existing `create` method**

Open `src/core/registry/component-registry.ts`. Find the `create(type, position, zone)` method. Note its signature, return type, and the throw behavior on unknown type.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/component-registry-try-create.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { SERVER_ENTRY } from "@modes/td/td-component-entries";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import type { CapabilityId } from "@core/types/ids";

function freshRegistry(): { capRegistry: CapabilityRegistry; compRegistry: ComponentRegistry } {
  const capRegistry = new CapabilityRegistry();
  capRegistry.register({ id: "processing" as CapabilityId, factory: () => new ProcessingCapability("processing" as CapabilityId) });
  capRegistry.register({ id: "forwarding" as CapabilityId, factory: () => new ForwardingCapability("forwarding" as CapabilityId, { handledTypes: ["api_read", "api_write"] }) });
  capRegistry.register({ id: "monitoring" as CapabilityId, factory: () => new MonitoringCapability("monitoring" as CapabilityId) });
  const compRegistry = new ComponentRegistry(capRegistry);
  compRegistry.register(SERVER_ENTRY);
  compRegistry.validate();
  return { capRegistry, compRegistry };
}

describe("ComponentRegistry.tryCreate", () => {
  it("returns a Component on known type", () => {
    const { compRegistry } = freshRegistry();
    const component = compRegistry.tryCreate("server", { x: 0, y: 0 }, null);
    expect(component).not.toBeNull();
    expect(component?.type).toBe("server");
  });

  it("returns null on unknown type instead of throwing", () => {
    const { compRegistry } = freshRegistry();
    expect(() => compRegistry.tryCreate("not_a_real_type", { x: 0, y: 0 }, null)).not.toThrow();
    const component = compRegistry.tryCreate("not_a_real_type", { x: 0, y: 0 }, null);
    expect(component).toBeNull();
  });

  it("create() still throws on unknown type (back-compat)", () => {
    const { compRegistry } = freshRegistry();
    expect(() => compRegistry.create("not_a_real_type", { x: 0, y: 0 }, null)).toThrow();
  });
});
```

- [ ] **Step 3: Run the test, expect failure**

Run: `pnpm test tests/unit/component-registry-try-create.test.ts`
Expected: test fails with "tryCreate is not a function"

- [ ] **Step 4: Implement `tryCreate`**

In `src/core/registry/component-registry.ts`, add the method (place it adjacent to `create`):

```ts
/**
 * Non-throwing variant of create. Returns null on unknown type.
 * Used by TDModeController.tryPlace to translate to PlacementResult.
 */
tryCreate(type: string, position: Position, zone: string | null): Component | null {
  if (!this.entries.has(type)) return null;
  return this.create(type, position, zone);
}
```

(Adjust `this.entries` to whatever the actual entries-map field is called — read the file to confirm.)

- [ ] **Step 5: Run the test, expect pass**

Run: `pnpm test tests/unit/component-registry-try-create.test.ts`
Expected: 3 tests passing

- [ ] **Step 6: Run full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/core/registry/component-registry.ts tests/unit/component-registry-try-create.test.ts
git commit -m "feat(registry): add tryCreate non-throwing variant"
```

---

## Task 3: Add `CLIENT_ENTRY` to `td-component-entries.ts`

**Why:** `campaign-headless.test.ts` and the dashboard need to seed an entry-point Client component via the registry. No `client` entry exists in the TD bundle today.

**Files:**
- Modify: `src/modes/td/td-component-entries.ts`

- [ ] **Step 1: Read the current file**

Read `src/modes/td/td-component-entries.ts` in full. Note the imports, the `DEFAULT_CONDITION_PROFILE` constant (file-private), and the existing entry pattern (`SERVER_ENTRY`, `DATABASE_ENTRY`, etc.).

- [ ] **Step 2: Add the new entry**

Append to `src/modes/td/td-component-entries.ts` (after `LOAD_BALANCER_ENTRY`):

```ts
export const CLIENT_ENTRY: ComponentRegistryEntry = {
  type: "client",
  name: "Client",
  description: "Traffic entry point. Forwards requests into the architecture.",
  capabilities: [
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 1 },
  ],
  ports: [
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 4, connections: [] },
  ],
  placementCost: 0,
  upgradeCostCurve: [0],
  visual: { icon: "client", color: "#94a3b8", shape: "circle" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};
```

`DEFAULT_CONDITION_PROFILE` is the file-private const already declared at the top of the file — reuse it in place.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (`forwarding-pipe` doesn't exist as a registered capability id yet — that's fine because validation runs later, not in this file.)

- [ ] **Step 4: Run full suite**

Run: `pnpm test`
Expected: 564 passing — `CLIENT_ENTRY` is exported but not yet registered, so nothing reads it.

- [ ] **Step 5: Commit**

```bash
git add src/modes/td/td-component-entries.ts
git commit -m "feat(td): add CLIENT_ENTRY for entry-point seeding"
```

---

## Task 4: Tune `registerTDDefaults` factories + register `forwarding-pipe` + register `CLIENT_ENTRY`

**Why:** The registry-default capability factories produce different runtime behavior than the harness-tuned variants in `tests/integration/td/helpers.ts`. To make the dashboard play match the headless wave tests byte-for-byte, the factories must register with the same options. Also adds the new `forwarding-pipe` factory id used by Cache, LB, and Client.

**Files:**
- Modify: `src/modes/td/register-td-defaults.ts`
- Modify: `src/modes/td/td-component-entries.ts` (Cache and LB capability refs)

- [ ] **Step 1: Read the current `register-td-defaults.ts`**

Open `src/modes/td/register-td-defaults.ts`. Note the current factories — most use unconfigured constructors.

- [ ] **Step 2: Read `tests/integration/td/helpers.ts:buildServer/buildDatabase/buildCache/buildLoadBalancer`**

Note the exact `handledTypes`, `throughputPerTier`, and event flag values each builder passes. These are the source of truth for the tuned defaults.

Reference values from the helpers (verified during spec audit):
- Server `processing`: `{handledTypes: ["api_read"], throughputPerTier: 20, emitProcessedEvent: true}`
- Server `forwarding`: `{handledTypes: ["api_write"], throughputPerTier: 12, emitForwardedEvent: true}`
- Database `storage`: `{throughputPerTier: 25, emitProcessedEvent: true}`
- Cache `forwarding`: `{handledTypes: ["api_read", "api_write"], throughputPerTier: 55, emitForwardedEvent: true}`
- LB `forwarding`: `{handledTypes: ["api_read", "api_write"], throughputPerTier: 55, emitForwardedEvent: true}`

- [ ] **Step 3: Rewrite the factory registrations**

Replace `register-td-defaults.ts` with:

```ts
import type { CapabilityRegistry } from "@core/registry/capability-registry.js";
import type { ComponentRegistry } from "@core/registry/component-registry.js";
import type { CapabilityId } from "@core/types/ids.js";
import { ProcessingCapability } from "@capabilities/processing/processing-capability.js";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability.js";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability.js";
import { StorageCapability } from "@capabilities/storage/storage-capability.js";
import { CachingCapability } from "@capabilities/caching/caching-capability.js";
import { RoutingCapability } from "@capabilities/routing/routing-capability.js";
import {
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
  CLIENT_ENTRY,
} from "./td-component-entries.js";

/**
 * Populate the capability and component registries with the TD-mode defaults.
 *
 * Stage 3b: factory options match tests/integration/td/helpers.ts:buildX
 * exactly, so dashboard-placed components have the same runtime behavior
 * as harness-built components in the wave tests.
 */
export function registerTDDefaults(
  capRegistry: CapabilityRegistry,
  compRegistry: ComponentRegistry,
): void {
  capRegistry.register({
    id: "processing" as CapabilityId,
    factory: () =>
      new ProcessingCapability("processing" as CapabilityId, {
        handledTypes: ["api_read"],
        throughputPerTier: 20,
        emitProcessedEvent: true,
      }),
  });
  capRegistry.register({
    id: "forwarding" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding" as CapabilityId, {
        handledTypes: ["api_write"],
        throughputPerTier: 12,
        emitForwardedEvent: true,
      }),
  });
  // forwarding-pipe is the Cache/LB/Client variant: handles all traffic at
  // ~55/tick. Distinct id so it can be registered as a separate factory.
  capRegistry.register({
    id: "forwarding-pipe" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding-pipe" as CapabilityId, {
        handledTypes: ["api_read", "api_write"],
        throughputPerTier: 55,
        emitForwardedEvent: true,
      }),
  });
  capRegistry.register({
    id: "storage" as CapabilityId,
    factory: () =>
      new StorageCapability("storage" as CapabilityId, {
        throughputPerTier: 25,
        emitProcessedEvent: true,
      }),
  });
  capRegistry.register({
    id: "caching" as CapabilityId,
    factory: () => new CachingCapability("caching" as CapabilityId),
  });
  capRegistry.register({
    id: "routing" as CapabilityId,
    factory: () => new RoutingCapability("routing" as CapabilityId),
  });
  capRegistry.register({
    id: "monitoring" as CapabilityId,
    factory: () => new MonitoringCapability("monitoring" as CapabilityId),
  });

  compRegistry.register(CLIENT_ENTRY);
  compRegistry.register(SERVER_ENTRY);
  compRegistry.register(DATABASE_ENTRY);
  compRegistry.register(CACHE_ENTRY);
  compRegistry.register(LOAD_BALANCER_ENTRY);

  compRegistry.validate();
}
```

- [ ] **Step 4: Update `CACHE_ENTRY` and `LOAD_BALANCER_ENTRY` capability refs**

In `src/modes/td/td-component-entries.ts`, change the `forwarding` capability id reference to `forwarding-pipe` for Cache and LoadBalancer:

```ts
// CACHE_ENTRY:
capabilities: [
  { id: "caching" as CapabilityId, defaultTier: 1, maxTier: 3 },
  { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 3 },  // was "forwarding"
  { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
],
```

```ts
// LOAD_BALANCER_ENTRY:
capabilities: [
  { id: "routing" as CapabilityId, defaultTier: 1, maxTier: 3 },
  { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 3 },  // was "forwarding"
  { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
],
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean

- [ ] **Step 6: Run full test suite — verify Stage 3a tests still pass**

Run: `pnpm test`
Expected: 564 passing. The Stage 3a wave tests construct components via `helpers.ts:buildServer` (direct `new Component(...)`), so they bypass the registry entirely. The factory tuning change only affects code paths that go through `registry.create`, which is none of the existing tests.

If any existing test fails: STOP and investigate. The most likely cause is `compRegistry.validate()` rejecting one of the entries because a capability id moved (`forwarding` → `forwarding-pipe`). Fix the entry ref or the factory id.

- [ ] **Step 7: Commit**

```bash
git add src/modes/td/register-td-defaults.ts src/modes/td/td-component-entries.ts
git commit -m "feat(td): tune registerTDDefaults factories to match harness; add forwarding-pipe and Client"
```

---

## Task 5: Refactor `TDTrafficSource` to self-counting

**Why:** Currently uses global `state.currentTick` to gate exhaustion. Wave 2 in a multi-wave campaign would short-circuit immediately because `state.currentTick` is already ≥ 30 by then.

**Files:**
- Modify: `src/modes/td/td-traffic-source.ts`
- Test: `tests/unit/td-traffic-source-self-counting.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/td-traffic-source-self-counting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
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

describe("TDTrafficSource self-counting", () => {
  it("isExhausted is false on a fresh source", () => {
    const source = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    expect(source.isExhausted()).toBe(false);
  });

  it("isExhausted becomes true after wave.duration generate() calls", () => {
    const source = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    for (let i = 0; i < WAVE_1.duration; i++) {
      source.generate(i);
    }
    expect(source.isExhausted()).toBe(true);
  });

  it("generate returns empty after exhaustion regardless of tick arg", () => {
    const source = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    for (let i = 0; i < WAVE_1.duration; i++) source.generate(i);
    expect(source.generate(0)).toEqual([]);
    expect(source.generate(99999)).toEqual([]);
  });

  it("a fresh source for the same wave starts at ticksGenerated=0 regardless of tick arg", () => {
    // First source exhausts
    const s1 = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    for (let i = 0; i < WAVE_1.duration; i++) s1.generate(i);
    expect(s1.isExhausted()).toBe(true);

    // Second source for the same wave, called with a high tick value (simulating
    // multi-wave campaign where state.currentTick is already past wave.duration)
    const s2 = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    expect(s2.isExhausted()).toBe(false);
    const batch = s2.generate(99999);
    expect(batch.length).toBe(WAVE_1.intensity);
    expect(s2.isExhausted()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm test tests/unit/td-traffic-source-self-counting.test.ts`
Expected: failure on `isExhausted is not a function`

- [ ] **Step 3: Apply the refactor to `td-traffic-source.ts`**

In `src/modes/td/td-traffic-source.ts`, add a `ticksGenerated` field, change the `generate` exhaustion check, and add `isExhausted`:

```ts
export class TDTrafficSource implements TrafficSource {
  readonly targetEntryPointId: ComponentId;
  private readonly wave: TDWaveDefinition;
  private readonly rng: () => number;
  private readonly readKeyPoolSize: number;
  private requestCounter = 0;
  private ticksGenerated = 0;

  constructor(options: TDTrafficSourceOptions) {
    this.wave = options.wave;
    this.targetEntryPointId = options.targetEntryPointId;
    this.rng = options.rng;
    this.readKeyPoolSize = options.wave.readKeyPoolSize ?? 20;
  }

  generate(tick: number): Request[] {
    if (this.ticksGenerated >= this.wave.duration) return [];
    this.ticksGenerated += 1;

    const out: Request[] = [];
    for (let i = 0; i < this.wave.intensity; i++) {
      const type = this.sampleType();
      out.push({
        id: this.nextId(),
        parentId: null,
        type,
        payload: this.makePayload(type),
        origin: this.targetEntryPointId,
        createdAt: tick,    // still uses engine's currentTick for createdAt
        ttl: this.wave.ttl,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      });
    }
    return out;
  }

  isExhausted(): boolean {
    return this.ticksGenerated >= this.wave.duration;
  }

  // sampleType, makePayload, nextId stay unchanged
  // ... existing private methods ...
}
```

- [ ] **Step 4: Run the new test, expect pass**

Run: `pnpm test tests/unit/td-traffic-source-self-counting.test.ts`
Expected: 4 tests passing

- [ ] **Step 5: Run full suite — Stage 3a wave tests must still pass**

Run: `pnpm test`
Expected: 568 passing (564 existing + 4 new).

The Stage 3a wave tests run `engine.tick(mode)` for `wave.duration` iterations starting at `state.currentTick = 0`. The new self-counting source produces the same 30 batches of intensity (then `[]`) — byte-identical request volumes. If a wave test fails, investigate carefully — there should be no difference.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-traffic-source.ts tests/unit/td-traffic-source-self-counting.test.ts
git commit -m "feat(td): TDTrafficSource self-counting via ticksGenerated"
```

---

## Task 6: Refactor `TDModeController` constructor for multi-wave + back-compat shim

**Why:** The dashboard needs to drive a multi-wave campaign through one controller instance. Stage 3a tests use single-wave construction and must keep working unchanged.

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts`
- Test: `tests/unit/td-mode-controller-phase.test.ts` (NEW — Task 9 fills it; this task creates a minimal version for the constructor)

- [ ] **Step 1: Write the failing test for constructor narrowing**

Create `tests/unit/td-mode-controller-phase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function bootRegistry(): ComponentRegistry {
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);
  return compRegistry;
}

describe("TDModeController constructor", () => {
  it("accepts multi-wave options", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    expect(tdc.getCurrentWaveIndex()).toBe(0);
    expect(tdc.getCurrentWave()).toBe(WAVE_1);
    expect(tdc.isCampaignComplete()).toBe(false);
  });

  it("throws on empty waves array", () => {
    const economy = new TDEconomy({
      startingBudget: 100,
      revenuePerRequestType: new Map(),
    });
    expect(
      () =>
        new TDModeController({
          waves: [],
          economy,
          entryPointId: "entry" as ComponentId,
          rng: makeRng(1),
          componentRegistry: bootRegistry(),
        }),
    ).toThrow(/non-empty/);
  });

  it("accepts single-wave back-compat options (no componentRegistry)", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      wave: WAVE_1,
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    expect(tdc.getCurrentWaveIndex()).toBe(0);
    expect(tdc.getCurrentWave()).toBe(WAVE_1);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm test tests/unit/td-mode-controller-phase.test.ts`
Expected: failure on `getCurrentWaveIndex is not a function` or constructor type error

- [ ] **Step 3: Apply the controller refactor**

This is the largest single edit in the plan. Edit `src/modes/td/td-mode-controller.ts`:

```ts
import type { ModeController } from "@core/mode/mode-controller.js";
import type { ComponentReader } from "@core/component/component-reader.js";
import type { CapabilityId, ComponentId, ConnectionId, PortId } from "@core/types/ids.js";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "@core/types/build-constraints.js";
import type { TickMetrics } from "@core/types/metrics.js";
import type { OutcomeReport } from "@core/types/outcome.js";
import type { ZoneTopology } from "@core/types/zone.js";
import type { ChaosEvent } from "@core/types/chaos.js";
import type { Position } from "@core/types/position.js";
import type { SimulationState } from "@core/state/simulation-state.js";
import type { TrafficSource } from "@core/mode/traffic-source.js";
import type { Connection } from "@core/types/connection.js";
import type { ComponentRegistry } from "@core/registry/component-registry.js";
import { isEngineBufferable } from "@core/capability/engine-bufferable.js";  // verify exact import path
import type { TDEconomy } from "./td-economy.js";
import type { TDWaveDefinition } from "./td-waves.js";
import { TDTrafficSource } from "./td-traffic-source.js";

// Stub registry used by the single-wave back-compat shim. tryPlace throws
// if the back-compat-constructed controller is asked to place — Stage 3a
// tests never call tryPlace, so this is unreachable in practice.
const STUB_REGISTRY: ComponentRegistry = {
  tryCreate: () => {
    throw new Error("TDModeController: tryPlace not supported on single-wave back-compat controller");
  },
} as unknown as ComponentRegistry;

export interface TDMultiWaveOptions {
  readonly waves: readonly TDWaveDefinition[];
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
  readonly componentRegistry: ComponentRegistry;
}

export interface TDSingleWaveOptions {
  readonly wave: TDWaveDefinition;
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
}

export type TDModeControllerOptions = TDMultiWaveOptions | TDSingleWaveOptions;

export type ConnectResult =
  | { ok: true; connectionId: ConnectionId }
  | {
      ok: false;
      reason:
        | "wrong_phase"
        | "unknown_source"
        | "unknown_target"
        | "no_egress_port"
        | "no_ingress_port"
        | "duplicate_connection"
        | "port_capacity_exceeded";
      detail?: string;
    };

export class TDModeController implements ModeController {
  // economy is mutable (v3) so the dashboard can swap in a fresh per-wave economy
  economy: TDEconomy;

  private readonly waves: readonly TDWaveDefinition[];
  private currentWaveIndex = 0;
  private trafficSource: TDTrafficSource;
  private phase: "build" | "simulate" | "assess" = "build";
  private waveStartMetricsIndex = 0;
  private placementSerial = 0;
  private readonly componentRegistry: ComponentRegistry;
  private readonly entryPointId: ComponentId;
  private readonly rng: () => number;

  constructor(options: TDModeControllerOptions) {
    if ("waves" in options) {
      if (options.waves.length === 0) {
        throw new Error("TDModeController: waves array must be non-empty");
      }
      this.waves = options.waves;
      this.componentRegistry = options.componentRegistry;
    } else {
      this.waves = [options.wave];
      this.componentRegistry = STUB_REGISTRY;
    }
    this.economy = options.economy;
    this.entryPointId = options.entryPointId;
    this.rng = options.rng;
    this.trafficSource = new TDTrafficSource({
      wave: this.waves[0]!,
      targetEntryPointId: options.entryPointId,
      rng: options.rng,
    });
  }

  /** Dashboard calls this on assess→build to swap in the next wave's economy. */
  setEconomy(economy: TDEconomy): void {
    this.economy = economy;
  }

  // === New multi-wave getters ===

  getCurrentWaveIndex(): number {
    return this.currentWaveIndex;
  }

  getCurrentWave(): TDWaveDefinition {
    if (this.isCampaignComplete()) {
      throw new Error("TDModeController: campaign complete; no current wave");
    }
    return this.waves[this.currentWaveIndex]!;
  }

  isCampaignComplete(): boolean {
    return this.currentWaveIndex >= this.waves.length;
  }

  getWaveCount(): number {
    return this.waves.length;
  }

  // === Existing methods, updated to read this.getCurrentWave() ===

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId> {
    return new Set(component.getCapabilityIds() as CapabilityId[]);
  }

  getTierCap(_component: ComponentReader, _capabilityId: CapabilityId): number {
    return 1;
  }

  getBuildConstraints(): BuildConstraints {
    const wave = this.getCurrentWave();
    return wave.maxPlacements !== undefined
      ? {
          availableComponentTypes: wave.availableComponents,
          maxPlacements: wave.maxPlacements,
        }
      : {
          availableComponentTypes: wave.availableComponents,
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
    const wave = this.getCurrentWave();
    const verdict: "win" | "lose" | "neutral" =
      dropRate < wave.dropThreshold ? "win" : "lose";

    const performance = 1 - dropRate;
    const reliability = 1 - (dropped + timedOut) / Math.max(total, 1);
    const cost = budget;
    const composite =
      0.4 * performance + 0.4 * reliability + 0.2 * (cost / wave.startingBudget);

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

  getCurrentWaveMetrics(state: SimulationState): readonly TickMetrics[] {
    return state.metricsHistory.slice(this.waveStartMetricsIndex);
  }

  getPhase(): "build" | "simulate" | "assess" {
    return this.phase;
  }

  /**
   * Advance the phase machine. Optional `state` parameter is used by the
   * dashboard to snapshot the metrics index at build→simulate and to
   * reconstruct trafficSource at assess→build.
   *
   * Stage 3a's runWave calls advancePhase() with no args (single-wave path).
   */
  advancePhase(state?: SimulationState): void {
    switch (this.phase) {
      case "build":
        if (state !== undefined) {
          this.waveStartMetricsIndex = state.metricsHistory.length;
        }
        this.phase = "simulate";
        break;
      case "simulate":
        this.phase = "assess";
        break;
      case "assess":
        this.currentWaveIndex += 1;
        if (this.currentWaveIndex < this.waves.length) {
          this.trafficSource = new TDTrafficSource({
            wave: this.waves[this.currentWaveIndex]!,
            targetEntryPointId: this.entryPointId,
            rng: this.rng,
          });
        }
        this.phase = "build";
        break;
    }
  }

  /**
   * Walks every place a request can live between ticks: pending queues,
   * blocked-parent pool, active streams, and EngineBufferable partitions.
   */
  isWaveDrained(state: SimulationState): boolean {
    if (!this.trafficSource.isExhausted()) return false;
    for (const arr of state.pending.values()) {
      if (arr.length > 0) return false;
    }
    if (state.blockedParents.size > 0) return false;
    if (state.activeStreams.size > 0) return false;
    for (const componentId of state.visitOrder) {
      const component = state.components.get(componentId);
      if (!component) continue;
      for (const cap of component.capabilities.values()) {
        if (isEngineBufferable(cap) && cap.peekBuffered().length > 0) return false;
      }
    }
    return true;
  }

  getInitialZoneTopology(): ZoneTopology {
    return { zones: ["default"], pairLatency: new Map() };
  }

  // === Stage 3b: real tryPlace + new tryConnect ===
  // (Filled in by Tasks 7 and 8 — leave as stubs for now)

  tryPlace(
    state: SimulationState,
    type: string,
    position: Position,
    zone: string | null,
  ): PlacementResult {
    // Stage 3b: real implementation lands in Task 7
    void state; void type; void position; void zone;
    throw new Error("tryPlace not yet implemented (Task 7)");
  }

  tryConnect(
    state: SimulationState,
    sourceComponentId: ComponentId,
    targetComponentId: ComponentId,
  ): ConnectResult {
    // Stage 3b: real implementation lands in Task 8
    void state; void sourceComponentId; void targetComponentId;
    throw new Error("tryConnect not yet implemented (Task 8)");
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

**Notes:**
- `placementSerial` is reused for both component and connection id minting. Tasks 7 and 8 use it.
- `STUB_REGISTRY` is a minimal `ComponentRegistry`-shaped object that throws on `tryCreate`. The cast through `unknown` is required because `STUB_REGISTRY` doesn't implement every `ComponentRegistry` method — but the back-compat shim only ever reads `tryCreate`.
- The `isEngineBufferable` import path may need adjusting — verify by grepping for `export function isEngineBufferable` or `export const isEngineBufferable`.

- [ ] **Step 4: Verify `isEngineBufferable` import path**

Run:
```bash
grep -rn "export.*isEngineBufferable" src/core
```
Expected: one hit — fix the import in `td-mode-controller.ts` to match.

- [ ] **Step 5: Run the constructor test, expect pass**

Run: `pnpm test tests/unit/td-mode-controller-phase.test.ts`
Expected: 3 tests passing (the three constructor-shape tests from Step 1)

- [ ] **Step 6: Run full suite**

Run: `pnpm test && pnpm typecheck`
Expected:
- All previously-passing tests still pass (including the four Stage 3a wave tests via the back-compat shim)
- 3 new constructor tests pass
- typecheck clean

If the wave tests fail: the most likely cause is a missing field on the back-compat shim. Re-read `runWave` in `tests/integration/td/helpers.ts` and check what controller methods it calls.

- [ ] **Step 7: Commit**

```bash
git add src/modes/td/td-mode-controller.ts tests/unit/td-mode-controller-phase.test.ts
git commit -m "feat(td): multi-wave TDModeController with back-compat shim"
```

---

## Task 7: Implement real `tryPlace`

**Why:** Replaces the stub that returns fake ids. Real `tryPlace` mints a component via the registry, validates against budget + phase + allowlist, and mutates `state`.

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts:tryPlace`
- Test: `tests/unit/td-mode-controller-place.test.ts` (NEW)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/td-mode-controller-place.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function setup(opts?: { startingBudget?: number }) {
  const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);
  const economy = new TDEconomy({
    startingBudget: opts?.startingBudget ?? WAVE_1.startingBudget,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  const tdc = new TDModeController({
    waves: [WAVE_1, WAVE_2, WAVE_3],
    economy,
    entryPointId: "entry-stub" as ComponentId,
    rng: makeRng(1),
    componentRegistry: compRegistry,
  });
  return { state, tdc, economy };
}

describe("TDModeController.tryPlace", () => {
  it("places a server, debits the economy, mutates state", () => {
    const { state, tdc, economy } = setup();
    const before = economy.getBudget();
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(state.components.has(result.componentId)).toBe(true);
    expect(economy.getBudget()).toBeLessThan(before);
  });

  it("rejects with disallowed_by_mode in simulate phase", () => {
    const { state, tdc } = setup();
    tdc.advancePhase(state);  // build → simulate
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("disallowed_by_mode");
  });

  it("rejects with disallowed_by_mode for type not in availableComponents", () => {
    const { state, tdc } = setup();
    // Wave 1 only allows server + database
    const result = tdc.tryPlace(state, "cache", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("disallowed_by_mode");
  });

  it("rejects with registry_unknown_type for unknown component types", () => {
    // Set up with a custom wave whose availableComponents includes a ghost type
    const customWave = {
      ...WAVE_1,
      availableComponents: ["ghost"],
    };
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const economy = new TDEconomy({
      startingBudget: 1000,
      revenuePerRequestType: customWave.revenuePerRequestType,
    });
    const capRegistry = new CapabilityRegistry();
    const compRegistry = new ComponentRegistry(capRegistry);
    registerTDDefaults(capRegistry, compRegistry);
    const tdc = new TDModeController({
      waves: [customWave],
      economy,
      entryPointId: "entry-stub" as ComponentId,
      rng: makeRng(1),
      componentRegistry: compRegistry,
    });
    const result = tdc.tryPlace(state, "ghost", { x: 0, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("registry_unknown_type");
  });

  it("rejects with insufficient_budget when balance is too low", () => {
    const { state, tdc, economy } = setup({ startingBudget: 50 });  // SERVER_ENTRY costs 100
    const result = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("insufficient_budget");
    expect(economy.getBudget()).toBe(50);  // unchanged
    expect(state.components.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `pnpm test tests/unit/td-mode-controller-place.test.ts`
Expected: failures — `tryPlace` currently throws "not yet implemented"

- [ ] **Step 3: Implement `tryPlace`**

In `src/modes/td/td-mode-controller.ts`, replace the stub:

```ts
tryPlace(
  state: SimulationState,
  type: string,
  position: Position,
  zone: string | null,
): PlacementResult {
  // 1. Phase check
  if (this.phase !== "build") {
    return { ok: false, reason: "disallowed_by_mode", detail: "wrong phase" };
  }
  // 2. Allowlist check
  const wave = this.getCurrentWave();
  if (!wave.availableComponents.includes(type)) {
    return { ok: false, reason: "disallowed_by_mode", detail: "type not in current wave's allowlist" };
  }
  // 3. Registry mint
  const component = this.componentRegistry.tryCreate(type, position, zone);
  if (!component) {
    return { ok: false, reason: "registry_unknown_type", detail: type };
  }
  // 4. Budget check
  if (!this.economy.canAfford(component.placementCost)) {
    return { ok: false, reason: "insufficient_budget" };
  }
  // 5. Debit + place
  this.economy.debitPlacement(component);
  state.placeComponent(component);
  // 6. Return
  return { ok: true, componentId: component.id };
},
```

- [ ] **Step 4: Run the new tests, expect pass**

Run: `pnpm test tests/unit/td-mode-controller-place.test.ts`
Expected: 5 tests passing

- [ ] **Step 5: Run full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-mode-controller.ts tests/unit/td-mode-controller-place.test.ts
git commit -m "feat(td): real tryPlace with budget + allowlist + phase validation"
```

---

## Task 8: Implement `tryConnect`

**Why:** The dashboard's click-to-connect flow needs an explicit method that validates ports and creates a `Connection`. New TD-only public method (not on the `ModeController` interface).

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts:tryConnect`
- Test: `tests/unit/td-mode-controller-connect.test.ts` (NEW)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/td-mode-controller-connect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function setup() {
  const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);

  // Seed a Client (entry-point)
  const client = compRegistry.create("client", { x: 0, y: 0 }, null);
  state.placeComponent(client);

  const economy = new TDEconomy({
    startingBudget: 10_000,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  const tdc = new TDModeController({
    waves: [WAVE_1, WAVE_2, WAVE_3],
    economy,
    entryPointId: client.id,
    rng: makeRng(1),
    componentRegistry: compRegistry,
  });
  return { state, tdc, client };
}

describe("TDModeController.tryConnect", () => {
  it("creates a connection between Client and a placed Server", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(place.ok).toBe(true);
    if (!place.ok) throw new Error();
    const result = tdc.tryConnect(state, client.id, place.componentId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(state.connections.has(result.connectionId)).toBe(true);

    // Verify port.connections updated on both endpoints
    const conn = state.connections.get(result.connectionId)!;
    const sourceComp = state.components.get(conn.source.componentId)!;
    const targetComp = state.components.get(conn.target.componentId)!;
    const sourcePort = sourceComp.ports.find((p) => p.id === conn.source.portId)!;
    const targetPort = targetComp.ports.find((p) => p.id === conn.target.portId)!;
    expect(sourcePort.connections).toContain(result.connectionId);
    expect(targetPort.connections).toContain(result.connectionId);
  });

  it("rejects with wrong_phase in simulate phase", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    tdc.advancePhase(state);  // build → simulate
    const result = tdc.tryConnect(state, client.id, place.componentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("wrong_phase");
  });

  it("rejects with unknown_source for bogus source id", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    const result = tdc.tryConnect(state, "ghost" as ComponentId, place.componentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("unknown_source");
  });

  it("rejects with unknown_target for bogus target id", () => {
    const { state, tdc, client } = setup();
    const result = tdc.tryConnect(state, client.id, "ghost" as ComponentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("unknown_target");
  });

  it("rejects with no_ingress_port when target is the Client", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    // Connecting Server → Client: Client has no ingress port (CLIENT_ENTRY only declares egress)
    const result = tdc.tryConnect(state, place.componentId, client.id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("no_ingress_port");
  });

  it("rejects duplicate_connection on second connect of same pair", () => {
    const { state, tdc, client } = setup();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    const first = tdc.tryConnect(state, client.id, place.componentId);
    expect(first.ok).toBe(true);
    const second = tdc.tryConnect(state, client.id, place.componentId);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error();
    expect(second.reason).toBe("duplicate_connection");
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `pnpm test tests/unit/td-mode-controller-connect.test.ts`
Expected: failures — `tryConnect` currently throws

- [ ] **Step 3: Verify Connection field shape**

Run:
```bash
cat src/core/types/connection.ts
```
Verify the `Connection` type has fields `id`, `source`, `target`, `bandwidth`, `latency`, `currentLoad`. Note any additional required fields. Adjust the literal in Step 4 accordingly.

- [ ] **Step 4: Implement `tryConnect`**

In `src/modes/td/td-mode-controller.ts`, replace the stub:

```ts
tryConnect(
  state: SimulationState,
  sourceComponentId: ComponentId,
  targetComponentId: ComponentId,
): ConnectResult {
  // 1. Phase check
  if (this.phase !== "build") {
    return { ok: false, reason: "wrong_phase" };
  }
  // 2. Endpoint existence
  const source = state.components.get(sourceComponentId);
  if (!source) return { ok: false, reason: "unknown_source" };
  const target = state.components.get(targetComponentId);
  if (!target) return { ok: false, reason: "unknown_target" };
  // 3. Port discovery — first matching egress on source, first ingress on target
  const sourcePort = source.ports.find((p) => p.direction === "egress");
  if (!sourcePort) return { ok: false, reason: "no_egress_port" };
  const targetPort = target.ports.find((p) => p.direction === "ingress");
  if (!targetPort) return { ok: false, reason: "no_ingress_port" };
  // 4. Duplicate check
  for (const conn of state.connections.values()) {
    if (
      conn.source.componentId === sourceComponentId &&
      conn.target.componentId === targetComponentId
    ) {
      return { ok: false, reason: "duplicate_connection" };
    }
  }
  // 5. Port capacity check
  if (sourcePort.connections.length >= sourcePort.capacity) {
    return { ok: false, reason: "port_capacity_exceeded", detail: "source" };
  }
  if (targetPort.connections.length >= targetPort.capacity) {
    return { ok: false, reason: "port_capacity_exceeded", detail: "target" };
  }
  // 6. Mint connection
  this.placementSerial += 1;
  const connectionId = `td-conn-${this.placementSerial}` as ConnectionId;
  const conn: Connection = {
    id: connectionId,
    source: { componentId: sourceComponentId, portId: sourcePort.id },
    target: { componentId: targetComponentId, portId: targetPort.id },
    bandwidth: 100,
    latency: 1,
    currentLoad: 0,
  };
  // 7. Add to state
  state.addConnection(conn);
  // 8. Update port state
  sourcePort.connections.push(connectionId);
  targetPort.connections.push(connectionId);
  // 9. Return
  return { ok: true, connectionId };
},
```

- [ ] **Step 5: Run the new tests, expect pass**

Run: `pnpm test tests/unit/td-mode-controller-connect.test.ts`
Expected: 6 tests passing

- [ ] **Step 6: Run full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/modes/td/td-mode-controller.ts tests/unit/td-mode-controller-connect.test.ts
git commit -m "feat(td): tryConnect with port validation and Connection minting"
```

---

## Task 9: `isWaveDrained` and multi-wave phase tests

**Why:** The phase-machine and drain detection paths from Task 6 deserve dedicated cases.

**Files:**
- Modify: `tests/unit/td-mode-controller-phase.test.ts` (extend the file from Task 6)

- [ ] **Step 1: Add the phase-progression and drain tests**

Append to `tests/unit/td-mode-controller-phase.test.ts`:

```ts
import { SimulationState } from "@core/state/simulation-state";

describe("TDModeController phase machine multi-wave progression", () => {
  it("advancePhase cycles build → simulate → assess → build with wave-index advancement", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    expect(tdc.getPhase()).toBe("build");
    expect(tdc.getCurrentWaveIndex()).toBe(0);

    tdc.advancePhase(state);
    expect(tdc.getPhase()).toBe("simulate");
    expect(tdc.getCurrentWaveIndex()).toBe(0);  // index doesn't advance until assess→build

    tdc.advancePhase(state);
    expect(tdc.getPhase()).toBe("assess");
    expect(tdc.getCurrentWaveIndex()).toBe(0);

    tdc.advancePhase(state);
    expect(tdc.getPhase()).toBe("build");
    expect(tdc.getCurrentWaveIndex()).toBe(1);
    expect(tdc.getCurrentWave()).toBe(WAVE_2);
  });

  it("isCampaignComplete becomes true after the final assess→build", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(tdc.isCampaignComplete()).toBe(false);
    tdc.advancePhase(state);  // build → simulate
    tdc.advancePhase(state);  // simulate → assess
    tdc.advancePhase(state);  // assess → build (advances index past array length)
    expect(tdc.isCampaignComplete()).toBe(true);
  });

  it("waveStartMetricsIndex snapshots state.metricsHistory.length on build→simulate", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    // Pre-seed some "previous wave" metrics
    state.metricsHistory.push({} as any, {} as any, {} as any);
    tdc.advancePhase(state);  // build → simulate, snapshot at length=3
    state.metricsHistory.push({} as any);  // wave 1 tick
    state.metricsHistory.push({} as any);  // wave 1 tick
    const sliced = tdc.getCurrentWaveMetrics(state);
    expect(sliced.length).toBe(2);  // only the 2 we added after the snapshot
  });
});

describe("TDModeController.isWaveDrained", () => {
  function exhaustTraffic(tdc: TDModeController) {
    const ts = tdc.getTrafficSource() as { isExhausted: () => boolean; generate: (n: number) => unknown };
    while (!ts.isExhausted()) ts.generate(0);
  }

  it("returns false when traffic source not exhausted", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(tdc.isWaveDrained(state)).toBe(false);
  });

  it("returns false when pending has any requests", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    exhaustTraffic(tdc);
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    state.pending.set("a" as ComponentId, [{} as any]);
    expect(tdc.isWaveDrained(state)).toBe(false);
  });

  it("returns false when blockedParents has entries", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    exhaustTraffic(tdc);
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    state.blockedParents.set("r1" as any, {} as any);
    expect(tdc.isWaveDrained(state)).toBe(false);
  });

  it("returns true when traffic exhausted and all stores empty", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    exhaustTraffic(tdc);
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(tdc.isWaveDrained(state)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new tests, expect pass**

Run: `pnpm test tests/unit/td-mode-controller-phase.test.ts`
Expected: 7 tests passing (3 from Task 6 + 4 new phase progression cases — adjust count to actual)

If a test fails, the most likely cause is a path import error. Adjust the imports.

- [ ] **Step 3: Run full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all green

- [ ] **Step 4: Commit**

```bash
git add tests/unit/td-mode-controller-phase.test.ts
git commit -m "test(td): phase progression and isWaveDrained cases"
```

---

## Task 10: Headless 3-wave campaign integration test

**Why:** End-to-end proof that `tryPlace`/`tryConnect`/`advancePhase`/`isWaveDrained` work together for a real multi-wave campaign through the registry path.

**Files:**
- Test: `tests/integration/td/campaign-headless.test.ts` (NEW)

- [ ] **Step 1: Write the integration test**

Create `tests/integration/td/campaign-headless.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import { makeRng } from "./helpers";

function runUntilDrained(state: SimulationState, tdc: TDModeController, engine: Engine) {
  let safety = 200;
  while (!tdc.isWaveDrained(state) && safety-- > 0) {
    engine.tick(tdc);
  }
  if (safety <= 0) {
    throw new Error("wave did not drain within 200 ticks");
  }
}

function resetAllConditions(state: SimulationState) {
  for (const id of state.components.keys()) {
    state.setCondition(id, 1.0);
  }
}

describe("TD campaign headless — full 3-wave registry path", () => {
  it("plays through Waves 1–3 with placements, all waves pass", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const capRegistry = new CapabilityRegistry();
    const compRegistry = new ComponentRegistry(capRegistry);
    registerTDDefaults(capRegistry, compRegistry);

    // Seed the entry-point Client via the registry
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    // Boot the controller for the full campaign
    let economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy,
      entryPointId: client.id,
      rng: makeRng(1),
      componentRegistry: compRegistry,
    });

    const engine = new Engine(state);

    // === Wave 1: place Server, connect to Client ===
    const w1Server = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(w1Server.ok).toBe(true);
    if (!w1Server.ok) throw new Error();
    expect(tdc.tryConnect(state, client.id, w1Server.componentId).ok).toBe(true);

    tdc.advancePhase(state);  // build → simulate
    runUntilDrained(state, tdc, engine);
    tdc.advancePhase(state);  // simulate → assess
    const w1Outcome = tdc.evaluateOutcome(tdc.getCurrentWaveMetrics(state));
    expect(w1Outcome.verdict).toBe("win");

    // === Per-wave reset (mirrors dashboard behavior) ===
    economy = new TDEconomy({
      startingBudget: WAVE_2.startingBudget,
      revenuePerRequestType: WAVE_2.revenuePerRequestType,
    });
    tdc.setEconomy(economy);
    resetAllConditions(state);
    tdc.advancePhase(state);  // assess → build, advances waveIndex to 1

    // === Wave 2: place Database, connect to Server ===
    expect(tdc.getCurrentWave()).toBe(WAVE_2);
    const w2Db = tdc.tryPlace(state, "database", { x: 2, y: 0 }, null);
    expect(w2Db.ok).toBe(true);
    if (!w2Db.ok) throw new Error();
    expect(tdc.tryConnect(state, w1Server.componentId, w2Db.componentId).ok).toBe(true);

    tdc.advancePhase(state);  // build → simulate
    runUntilDrained(state, tdc, engine);
    tdc.advancePhase(state);  // simulate → assess
    const w2Outcome = tdc.evaluateOutcome(tdc.getCurrentWaveMetrics(state));
    expect(w2Outcome.verdict).toBe("win");

    // === Per-wave reset ===
    economy = new TDEconomy({
      startingBudget: WAVE_3.startingBudget,
      revenuePerRequestType: WAVE_3.revenuePerRequestType,
    });
    tdc.setEconomy(economy);
    resetAllConditions(state);
    tdc.advancePhase(state);  // assess → build, waveIndex = 2

    // === Wave 3: rescue with Cache (matches wave-3-learning-arc cache topology) ===
    expect(tdc.getCurrentWave()).toBe(WAVE_3);
    const w3Cache = tdc.tryPlace(state, "cache", { x: 1, y: 1 }, null);
    expect(w3Cache.ok).toBe(true);
    if (!w3Cache.ok) throw new Error();
    // Re-route: Client → Cache → Server (Server already connects to Database)
    expect(tdc.tryConnect(state, client.id, w3Cache.componentId).ok).toBe(true);
    expect(tdc.tryConnect(state, w3Cache.componentId, w1Server.componentId).ok).toBe(true);

    tdc.advancePhase(state);  // build → simulate
    runUntilDrained(state, tdc, engine);
    tdc.advancePhase(state);  // simulate → assess
    const w3Outcome = tdc.evaluateOutcome(tdc.getCurrentWaveMetrics(state));
    expect(w3Outcome.verdict).toBe("win");

    // === Final: campaign complete ===
    tdc.advancePhase(state);  // assess → build, waveIndex past length
    expect(tdc.isCampaignComplete()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/td/campaign-headless.test.ts`
Expected: passes on first try if all prior tasks were correct.

**Common failure modes:**
- **Wave 3 fails:** the cache topology may not perfectly match what `wave-3-learning-arc.test.ts` proves. If it fails, try a different rescue topology — e.g., add a second Server via LB. The test exists to prove the *plumbing* works; tune the topology to match Stage 3a's known-winning configurations.
- **`runUntilDrained` exceeds 200 ticks:** something is holding requests. Check that `isWaveDrained` actually returns true when expected — add console.log temporarily.
- **`evaluateOutcome` reports `lose`:** the dashboard-played topology must match harness-tuned outcomes (Task 4 should have made this true). Re-verify Task 4's factory tuning.

- [ ] **Step 3: Run full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all green

- [ ] **Step 4: Commit**

```bash
git add tests/integration/td/campaign-headless.test.ts
git commit -m "test(td): headless 3-wave campaign through registry path"
```

---

## Task 11: Parameterize `SimLoop` over `ModeController`

**Why:** Existing `SimLoop` is hard-coded to `SandboxModeController` and calls `getMetricsSnapshot(state)`, which `TDModeController` doesn't have. Make the loop work with both modes.

**Files:**
- Modify: `src/dashboard/sim-loop.ts`
- Modify: `src/dashboard/main.ts` (sandbox call site, to keep it working)

- [ ] **Step 1: Read the existing `sim-loop.ts`**

Read `src/dashboard/sim-loop.ts` in full. Note the constructor signature, how it imports `SandboxModeController`, and where `getMetricsSnapshot` is called.

- [ ] **Step 2: Refactor to accept a callback**

Edit `src/dashboard/sim-loop.ts`:

```ts
import type { Engine } from "@core/engine/engine";
import type { SimulationState } from "@core/state/simulation-state";
import type { ModeController } from "@core/mode/mode-controller";

export interface SimLoopOptions<T extends ModeController> {
  engine: Engine;
  state: SimulationState;
  controller: T;
  /**
   * Called after each tick. Receives the controller (concrete type)
   * so the dashboard can extract mode-specific snapshot data.
   */
  onTick: (controller: T, state: SimulationState) => void;
  /** Optional: called when the loop should stop ticking (e.g., wave drained). */
  shouldStop?: (controller: T, state: SimulationState) => boolean;
}

export class SimLoop<T extends ModeController> {
  private readonly engine: Engine;
  private readonly state: SimulationState;
  private readonly controller: T;
  private readonly onTick: (c: T, s: SimulationState) => void;
  private readonly shouldStop?: (c: T, s: SimulationState) => boolean;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SimLoopOptions<T>) {
    this.engine = options.engine;
    this.state = options.state;
    this.controller = options.controller;
    this.onTick = options.onTick;
    this.shouldStop = options.shouldStop;
  }

  step(): void {
    if (this.shouldStop?.(this.controller, this.state)) return;
    this.engine.tick(this.controller);
    this.onTick(this.controller, this.state);
  }

  play(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => this.step(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 3: Update `main.ts` sandbox call site**

In `src/dashboard/main.ts`, find where `SimLoop` is constructed for sandbox mode. Update the call to pass `onTick`:

```ts
import { SimLoop } from "./sim-loop";
import type { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";

const sandboxLoop = new SimLoop<SandboxModeController>({
  engine,
  state,
  controller: sandboxController,
  onTick: (controller, state) => {
    // Move the existing per-tick HUD update logic here.
    // Previously this logic lived inside SimLoop.step() — now it's a callback.
    const snapshot = controller.getMetricsSnapshot(state);
    updateSandboxHud(snapshot);
  },
});
```

If the existing `main.ts` has more sandbox-specific logic that ran inside `SimLoop`, hoist all of it into the `onTick` callback.

- [ ] **Step 4: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test`
Expected: clean. (Sandbox mode has no automated tests at the dashboard layer, but the controller-level sandbox tests should still pass.)

- [ ] **Step 5: Smoke-test the sandbox dashboard**

Run: `pnpm dev` and visit `http://localhost:5173`. Verify the sandbox dashboard still loads, you can pick a topology preset, run the sim, and metrics update. Then `Ctrl+C` to stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/sim-loop.ts src/dashboard/main.ts
git commit -m "refactor(dashboard): parameterize SimLoop over ModeController"
```

---

## Task 12: TD HUD — HTML scaffold + CSS

**Why:** The TD HUD needs a DOM structure and styling before main.ts can wire data into it.

**Files:**
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/styles.css`

- [ ] **Step 1: Add HTML structure**

In `src/dashboard/index.html`, find the existing right-side panel container. Add a TD HUD section, hidden by default:

```html
<!-- TD HUD (hidden by default; mode toggle reveals) -->
<aside id="td-hud" class="td-hud" hidden>
  <div class="td-hud__row">
    <span class="td-hud__label">Wave</span>
    <span id="td-hud-wave" class="td-hud__value">1 of 3</span>
  </div>
  <div class="td-hud__row">
    <span class="td-hud__label">Phase</span>
    <span id="td-hud-phase" class="td-hud__value">BUILD</span>
  </div>
  <div class="td-hud__row">
    <span class="td-hud__label">Budget</span>
    <span id="td-hud-budget" class="td-hud__value">$500</span>
  </div>

  <div class="td-hud__palette">
    <h4>Palette</h4>
    <button class="td-palette-btn" data-type="server">+ Server $100</button>
    <button class="td-palette-btn" data-type="database">+ Database $200</button>
    <button class="td-palette-btn" data-type="cache">+ Cache $150</button>
    <button class="td-palette-btn" data-type="load_balancer">+ Load Balancer $175</button>
  </div>

  <button id="td-ready-btn" class="td-ready-btn">READY</button>
</aside>

<!-- Mode toggle (always visible) -->
<div id="mode-toggle" class="mode-toggle">
  <button id="mode-sandbox" class="mode-btn">Sandbox</button>
  <button id="mode-td" class="mode-btn">TD</button>
</div>
```

Place the `mode-toggle` in the top bar near the existing topology-select control. Place the `td-hud` adjacent to the existing sandbox panels.

- [ ] **Step 2: Add CSS**

Append to `src/dashboard/styles.css`:

```css
/* === Mode toggle === */
.mode-toggle { display: inline-flex; gap: 4px; margin-left: 12px; }
.mode-btn {
  background: #2e3344; color: #e1e4ed; border: 1px solid #3a4155;
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.mode-btn.active { background: #4A90D9; color: #fff; }

/* === TD HUD === */
.td-hud {
  background: #1c2030; border: 1px solid #2e3344; border-radius: 6px;
  padding: 12px; min-width: 220px; color: #e1e4ed; font-size: 13px;
}
.td-hud[hidden] { display: none; }
.td-hud__row { display: flex; justify-content: space-between; margin-bottom: 6px; }
.td-hud__label { color: #8b8fa3; }
.td-hud__value { font-weight: 600; }
.td-hud__palette { margin: 12px 0; }
.td-hud__palette h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #8b8fa3; }
.td-palette-btn {
  display: block; width: 100%; margin-bottom: 4px;
  background: #2e3344; color: #e1e4ed; border: 1px solid #3a4155;
  padding: 6px 10px; border-radius: 4px; cursor: pointer; text-align: left;
}
.td-palette-btn:hover { background: #3a4155; }
.td-palette-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.td-palette-btn.placing { background: #4A90D9; color: #fff; }
.td-ready-btn {
  display: block; width: 100%; margin-top: 8px;
  background: #50C878; color: #0a0d18; border: none;
  padding: 10px; border-radius: 4px; font-weight: 700; cursor: pointer;
}
.td-ready-btn:disabled { opacity: 0.4; cursor: not-allowed; background: #3a4155; color: #8b8fa3; }

/* === TD topology component (minimal renderer) === */
.td-comp {
  background: #2e3344; color: #e1e4ed; border: 1px solid #4A90D9;
  border-radius: 4px; padding: 4px 8px; font-size: 11px;
  cursor: pointer; user-select: none;
}

/* === TD wave-result toast === */
.td-toast {
  position: fixed; bottom: 20px; right: 20px;
  background: #50C878; color: #0a0d18;
  padding: 12px 20px; border-radius: 6px;
  font-weight: 700; z-index: 1000;
}
```

- [ ] **Step 3: Smoke-test**

Run: `pnpm dev` and visit `http://localhost:5173`. The page should load without errors. The TD HUD should be hidden (since the toggle isn't wired yet). Open DevTools and run `document.getElementById('td-hud').hidden = false` to verify it renders correctly. `Ctrl+C` when done.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/index.html src/dashboard/styles.css
git commit -m "feat(dashboard): TD HUD HTML scaffold and styles"
```

---

## Task 13: TD-mode dashboard module — palette, click-to-place, click-to-connect

**Why:** All TD-specific dashboard logic lives in one new file to keep `main.ts` clean.

**Files:**
- Create: `src/dashboard/td-mode.ts`

- [ ] **Step 1: Write the module**

Create `src/dashboard/td-mode.ts`:

```ts
import type { TDModeController } from "@modes/td/td-mode-controller";
import type { SimulationState } from "@core/state/simulation-state";
import type { ComponentId } from "@core/types/ids";

interface TDDashboardState {
  cursor: "idle" | "placing" | "connecting";
  placingType: string | null;
  connectingFromId: ComponentId | null;
}

export interface TDDashboard {
  refreshHud(): void;
  rerenderTopology(): void;
  destroy(): void;
}

/**
 * Wire the TD HUD DOM elements to the controller. Returns a handle for
 * cleanup (used when toggling back to sandbox mode).
 */
export function createTDDashboard(args: {
  state: SimulationState;
  controller: TDModeController;
  topologyContainer: HTMLElement;
  onPlace?: (id: ComponentId) => void;
  onConnect?: () => void;
  onPhaseChange?: () => void;
}): TDDashboard {
  const { state, controller, topologyContainer } = args;

  const hudEl = requireElement("td-hud");
  const waveEl = requireElement("td-hud-wave");
  const phaseEl = requireElement("td-hud-phase");
  const budgetEl = requireElement("td-hud-budget");
  const readyBtn = requireElement("td-ready-btn") as HTMLButtonElement;
  const paletteButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".td-palette-btn"),
  );

  hudEl.hidden = false;

  const dash: TDDashboardState = {
    cursor: "idle",
    placingType: null,
    connectingFromId: null,
  };

  function refreshHud(): void {
    if (controller.isCampaignComplete()) {
      waveEl.textContent = "Complete";
      phaseEl.textContent = "—";
    } else {
      waveEl.textContent = `${controller.getCurrentWaveIndex() + 1} of ${controller.getWaveCount()}`;
      phaseEl.textContent = controller.getPhase().toUpperCase();
    }
    budgetEl.textContent = `$${controller.economy.getBudget()}`;
    const buildPhase = controller.getPhase() === "build";
    paletteButtons.forEach((b) => (b.disabled = !buildPhase));
    readyBtn.disabled = !buildPhase;
  }

  // === Palette click handlers ===
  paletteButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (controller.getPhase() !== "build") return;
      const type = btn.dataset["type"];
      if (!type) return;
      dash.cursor = "placing";
      dash.placingType = type;
      paletteButtons.forEach((b) => b.classList.remove("placing"));
      btn.classList.add("placing");
    });
  });

  // === Topology click handler (delegated) ===
  function onTopologyClick(ev: MouseEvent): void {
    if (controller.getPhase() !== "build") return;
    const targetEl = ev.target as HTMLElement;

    // CASE 1: clicked an existing component → connect or start connecting
    const componentEl = targetEl.closest<HTMLElement>("[data-component-id]");
    if (componentEl) {
      const id = componentEl.dataset["componentId"] as ComponentId;
      if (dash.cursor === "connecting" && dash.connectingFromId !== null) {
        // Complete a connection: clicked component is the source, stored id is target
        const result = controller.tryConnect(state, id, dash.connectingFromId);
        if (result.ok) {
          args.onConnect?.();
          rerenderTopology();
        } else {
          console.warn(`tryConnect failed: ${result.reason}`, result);
        }
        dash.cursor = "idle";
        dash.connectingFromId = null;
      } else {
        // Begin connecting from this component
        dash.cursor = "connecting";
        dash.connectingFromId = id;
      }
      return;
    }

    // CASE 2: clicked empty grid cell while placing → call tryPlace
    if (dash.cursor === "placing" && dash.placingType !== null) {
      const rect = topologyContainer.getBoundingClientRect();
      const position = {
        x: Math.round((ev.clientX - rect.left) / 40),  // 40px grid cell
        y: Math.round((ev.clientY - rect.top) / 40),
      };
      const result = controller.tryPlace(state, dash.placingType, position, null);
      if (result.ok) {
        args.onPlace?.(result.componentId);
        rerenderTopology();
        // Auto-enter connecting mode with the new component as the to-be-connected target
        dash.cursor = "connecting";
        dash.connectingFromId = result.componentId;
      } else {
        console.warn(`tryPlace failed: ${result.reason}`, result);
      }
      paletteButtons.forEach((b) => b.classList.remove("placing"));
      dash.placingType = null;
      return;
    }

    // CASE 3: clicked empty space in idle mode → cancel any in-progress action
    dash.cursor = "idle";
    dash.placingType = null;
    dash.connectingFromId = null;
    paletteButtons.forEach((b) => b.classList.remove("placing"));
  }

  topologyContainer.addEventListener("click", onTopologyClick);

  /**
   * Minimal DOM-based topology renderer. Removes existing children and
   * appends one element per component. Connections are not visualized in
   * Stage 3b — the data is in state.connections if a future stage wants
   * to draw SVG <line> elements.
   */
  function rerenderTopology(): void {
    while (topologyContainer.firstChild) {
      topologyContainer.removeChild(topologyContainer.firstChild);
    }
    for (const [id, comp] of state.components) {
      const el = document.createElement("div");
      el.className = "td-comp";
      el.dataset["componentId"] = id;
      el.style.position = "absolute";
      el.style.left = `${comp.position.x * 40}px`;
      el.style.top = `${comp.position.y * 40}px`;
      el.textContent = comp.type;
      topologyContainer.appendChild(el);
    }
  }

  function onReady(): void {
    if (controller.getPhase() !== "build") return;
    controller.advancePhase(state);  // build → simulate
    args.onPhaseChange?.();
    refreshHud();
  }

  readyBtn.addEventListener("click", onReady);

  // Initial render
  rerenderTopology();
  refreshHud();

  return {
    refreshHud,
    rerenderTopology,
    destroy: () => {
      hudEl.hidden = true;
      topologyContainer.removeEventListener("click", onTopologyClick);
      readyBtn.removeEventListener("click", onReady);
    },
  };
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`TD dashboard: missing required element #${id}`);
  return el;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/td-mode.ts
git commit -m "feat(dashboard): TD-mode module with palette and click handlers"
```

---

## Task 14: Wire TD mode into `main.ts`

**Why:** The mode toggle needs to actually create/destroy the TD dashboard and wire its sim loop.

**Files:**
- Modify: `src/dashboard/main.ts`

- [ ] **Step 1: Add TD-mode boot path**

In `src/dashboard/main.ts`, add the TD-mode imports and boot logic. Sketch:

```ts
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { createTDDashboard, type TDDashboard } from "./td-mode";
import { SimLoop } from "./sim-loop";

let tdDashboard: TDDashboard | null = null;
let tdLoop: SimLoop<TDModeController> | null = null;

function bootTDMode(): void {
  // Tear down sandbox first
  teardownSandboxMode();   // implement based on existing main.ts structure

  const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);

  // Seed the entry-point Client
  const client = compRegistry.create("client", { x: 0, y: 0 }, null);
  state.placeComponent(client);

  const economy = new TDEconomy({
    startingBudget: WAVE_1.startingBudget,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  const controller = new TDModeController({
    waves: [WAVE_1, WAVE_2, WAVE_3],
    economy,
    entryPointId: client.id,
    rng: Math.random,
    componentRegistry: compRegistry,
  });

  const engine = new Engine(state);

  const topologyContainer = document.getElementById("topology-visual")!;

  tdDashboard = createTDDashboard({
    state,
    controller,
    topologyContainer,
    onPlace: () => tdDashboard?.refreshHud(),
    onConnect: () => tdDashboard?.refreshHud(),
    onPhaseChange: () => {
      tdDashboard?.refreshHud();
      // Begin auto-ticking when phase is simulate
      if (controller.getPhase() === "simulate") {
        tdLoop?.play(getCurrentSpeedMs());   // implement helper that reads the speed slider
      }
    },
  });

  tdLoop = new SimLoop<TDModeController>({
    engine,
    state,
    controller,
    onTick: (c, s) => {
      if (c.isWaveDrained(s)) {
        tdLoop?.stop();
        c.advancePhase(s);  // simulate → assess
        const outcome = c.evaluateOutcome(c.getCurrentWaveMetrics(s));
        showWaveResultToast(outcome);

        // Per-wave reset and advance assess→build (or end campaign)
        const nextIdx = c.getCurrentWaveIndex() + 1;
        if (nextIdx < c.getWaveCount()) {
          const nextWave = nextIdx === 1 ? WAVE_2 : WAVE_3;
          c.setEconomy(new TDEconomy({
            startingBudget: nextWave.startingBudget,
            revenuePerRequestType: nextWave.revenuePerRequestType,
          }));
          for (const id of s.components.keys()) s.setCondition(id, 1.0);
          c.advancePhase(s);  // assess → build, advances waveIndex
        } else {
          c.advancePhase(s);  // assess → build (campaign complete)
        }
        tdDashboard?.refreshHud();
        tdDashboard?.rerenderTopology();
      }
    },
    shouldStop: (c) => c.getPhase() !== "simulate",
  });
}

function showWaveResultToast(outcome: { verdict: string; notes: readonly string[] }): void {
  const toast = document.createElement("div");
  toast.className = "td-toast";
  toast.textContent = `Wave ${outcome.verdict.toUpperCase()} — ${outcome.notes.join(", ")}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function teardownTDMode(): void {
  tdLoop?.stop();
  tdLoop = null;
  tdDashboard?.destroy();
  tdDashboard = null;
}

// Wire mode toggle
document.getElementById("mode-td")?.addEventListener("click", () => {
  if (location.hash !== "#mode=td") location.hash = "#mode=td";
  bootTDMode();
});
document.getElementById("mode-sandbox")?.addEventListener("click", () => {
  if (location.hash !== "#mode=sandbox") location.hash = "#mode=sandbox";
  teardownTDMode();
  // ... boot sandbox ...
});

// On page load, dispatch on hash
if (location.hash === "#mode=td") {
  bootTDMode();
} else {
  // ... existing sandbox boot ...
}
```

This is a sketch — adapt the integration points to whatever the existing `main.ts` actually exports and how its sandbox boot is currently structured. Some helpers you may need to implement or hoist out of the existing sandbox boot:
- `getCurrentSpeedMs()` — reads the speed slider's current value and returns ms-per-tick
- `teardownSandboxMode()` — stops sandbox sim loop, hides sandbox panels, clears state

The key behaviors:
1. Mode toggle persists in URL hash
2. TD boot creates state, controller, dashboard, sim loop
3. TD teardown cleans up DOM listeners and stops the loop
4. Wave drain detection inside `onTick` triggers the assess→build flow including economy reset and condition reset
5. Campaign-end shows a final toast

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean

- [ ] **Step 3: Smoke-test the dashboard**

Run: `pnpm dev`. In the browser:
1. Verify the page loads without console errors
2. Click the **TD** mode button — TD HUD appears, shows "Wave 1 of 3 / BUILD / $500"
3. Click **+ Server $100** in the palette — button highlights
4. Click an empty grid cell — Server appears, budget drops to $400, cursor is in connecting mode
5. Click the Client circle — connection is created
6. Click **READY** — phase changes to RUNNING, ticks happen, you see metric updates
7. After Wave 1 drains: toast appears, HUD advances to Wave 2 / BUILD / $500
8. Repeat for Waves 2 and 3
9. Final toast says "WIN" (or whatever the verdict is)
10. Click **Sandbox** — TD HUD hides, sandbox HUD reappears, sandbox features still work

Note any issues encountered. If the click handlers don't fire correctly or the rendering is off, fix in this task before committing.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/main.ts
git commit -m "feat(dashboard): wire TD mode boot/teardown into main.ts"
```

---

## Task 15: Manual verification checklist

**Why:** `pnpm test` doesn't cover dashboard interactions. This is the manual checkpoint per CLAUDE.md's UI-changes rule.

**Files:** none

- [ ] **Step 1: Run the dashboard**

Run: `pnpm dev`

- [ ] **Step 2: Sandbox regression check**

1. Page loads, sandbox mode is the default (or matches `#mode=sandbox`)
2. Topology preset selector is visible and usable
3. Chaos panel is visible and triggers work
4. Charts populate with metrics on play
5. Save/load scenario works

If any of these break, fix immediately — it's a regression of merged functionality.

- [ ] **Step 3: TD mode happy path**

1. Click TD toggle, HUD appears, Wave 1 / BUILD / $500
2. Place a Server, draw connection from Client → Server
3. Click READY, watch Wave 1 run, see PASS toast
4. HUD advances to Wave 2 / BUILD / $500
5. Place a Database, connect Server → Database
6. Click READY, Wave 2 runs and passes
7. HUD advances to Wave 3 / BUILD / $600
8. Place a Cache, connect Client → Cache → Server (or LB rescue if you prefer)
9. Click READY, Wave 3 runs and passes
10. Campaign-complete toast appears

- [ ] **Step 4: TD mode error paths**

1. Click READY without placing anything — Wave 1 should fail (lone Client topology can't process anything). Verify the LOSS toast appears and the campaign ends gracefully.
2. Reset (refresh page), try placing a Cache in Wave 1 — palette button should be disabled OR `tryPlace` should reject (Wave 1 only allows server + database). Check console for the rejection.
3. Try clicking Connect target = Client — should fail with `no_ingress_port` (logged to console).
4. Try connecting the same pair twice — second attempt should fail with `duplicate_connection`.

- [ ] **Step 5: Mode toggle**

1. From TD mode, click Sandbox — TD HUD hides, sandbox panels reappear, no leftover state
2. From Sandbox, click TD — TD HUD reappears with a fresh campaign

- [ ] **Step 6: Stop the dev server**

`Ctrl+C` in the terminal running `pnpm dev`.

- [ ] **Step 7: Document any quirks**

If you found any small issues that aren't blocking but should be tracked, add them to the spec's §10 (Open questions) before moving to the final task.

- [ ] **Step 8: No commit**

This task has no code changes — no commit needed. Just confirm verification passed.

---

## Task 16: Update `CLAUDE.md`

**Why:** The implementation status section in `CLAUDE.md` needs to reflect Stage 3b completion and point at Stage 3c.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read the existing implementation status section**

Open `CLAUDE.md`. Find the `## Implementation status` section. Note the "Current stage" line and the "Next" section.

- [ ] **Step 2: Update "Current stage"**

Change:
```
**Current stage:** Phase 1, Stage 3a complete + full capability library merged from parallel track. 564 tests, typecheck clean.
```

To:
```
**Current stage:** Phase 1, Stage 3b complete. TD mode is interactively playable end-to-end through the dashboard for the existing Wave 1–3 learning arc. ~580 tests (564 + new unit/integration), typecheck clean.
```

(Adjust the test count to match the actual `pnpm test` output.)

- [ ] **Step 3: Add a "Stage 3b" subsection under "What ships"**

Insert this paragraph into the "What ships (merged into main)" section, after the existing TD mode entry:

```
**Stage 3b: Interactive playable loop** — `TDModeController` accepts a multi-wave campaign, exposes `getCurrentWaveIndex` / `getCurrentWave` / `isCampaignComplete` / `isWaveDrained` / `getCurrentWaveMetrics`, and has real `tryPlace` / `tryConnect` methods that mutate state via the registry path (`ComponentRegistry.tryCreate`, `state.placeComponent`, `state.addConnection`). `TDTrafficSource` is self-counting via `ticksGenerated`. `registerTDDefaults` now produces TD-tuned capability factories that match `helpers.ts:buildServer/...` byte-for-byte — a dashboard-placed Server has the same runtime behavior as a harness-built one. `CLIENT_ENTRY` added to the TD bundle. Dashboard has a TD-mode toggle, palette, click-to-place + click-to-connect, READY button, wave HUD, and per-wave economy + condition reset. New tests: `tests/unit/td-mode-controller-{place,connect,phase}.test.ts`, `tests/unit/td-traffic-source-self-counting.test.ts`, `tests/unit/component-registry-try-create.test.ts`, `tests/integration/td/campaign-headless.test.ts`. Stage 3a's four wave tests remain pinned via the back-compat single-wave `TDModeControllerOptions` shape.
```

- [ ] **Step 4: Replace the "Next" section**

Replace the existing "Next" block with:

```
**Next:** Stage 3c — TBD. Candidates (no spec yet):

- **New waves with new mechanics.** Wave 4 (Auth-required edge handler), Wave 5 (RateLimit burst protection), Wave 6 (CircuitBreaker / chaos integration). Auth wave needs a new capability primitive that *rejects* unauthenticated requests — `AuthCapability` is currently a no-op pass-through. RateLimit is the most buildable since `RateLimitCapability` already DROPs on token exhaustion.
- **Cross-wave budget carry-over and condition persistence.** Stage 3b resets economy and condition between waves. Stage 3c can add carry-over once a "repair" / "maintenance" mechanic exists.
- **Tier upgrades.** Spend budget to upgrade an existing component in place. Needs new UI surface and a `tryUpgrade` real impl beyond the Stage 3a stub.
- **Multi-port disambiguation in `tryConnect`.** Components with multiple in-ports of different roles need explicit port selection in the click flow.
- **Helper-vs-registry construction unification.** Stage 3b's tuning made the two paths produce the same runtime, but `tests/integration/td/helpers.ts:buildServer` etc. still construct components directly. Stage 3c could move the helpers to consume the registry.
- **Intra-wave satisfaction pressure.** Mid-wave loss condition / lives. Now designable because the dashboard shows live wave feedback.
```

- [ ] **Step 5: Add a "Stage 3b engine contract gotchas" subsection**

Insert this after the existing "Stage 3a engine contract gotchas" section:

```
### Stage 3b engine contract gotchas

- **`TDModeController` is multi-wave by default.** The constructor accepts either `TDMultiWaveOptions` (with `waves: TDWaveDefinition[]` + `componentRegistry`) or `TDSingleWaveOptions` (the legacy `wave: TDWaveDefinition` shape used by `tests/integration/td/helpers.ts:runWave`). Discriminated via `"waves" in options`. The single-wave shim uses a `STUB_REGISTRY` that throws on `tryPlace`.
- **`advancePhase(state?)` snapshots `waveStartMetricsIndex` only when `state` is passed.** Stage 3a tests call `advancePhase()` no-arg and never read `getCurrentWaveMetrics`. Dashboard call sites pass `state`.
- **`registerTDDefaults` factories are TD-tuned.** `processing` registers with `{handledTypes: ["api_read"], throughputPerTier: 20, emitProcessedEvent: true}`. `forwarding` is Server-style writes-only at 12/tick. `forwarding-pipe` is the Cache/LB/Client variant at 55/tick. `storage` is at 25/tick with PROCESSED events. These match `tests/integration/td/helpers.ts:buildX` exactly. Sandbox bootstrap (`bootstrapRegistries`) is unaffected.
- **`CLIENT_ENTRY` has no ingress port.** It's egress-only (entry point). `tryConnect(state, server, client)` rejects with `no_ingress_port`.
- **`isWaveDrained` walks four request locations:** `state.pending`, `state.blockedParents`, `state.activeStreams`, **and** `EngineBufferable.peekBuffered()` partitions on every component. None of TD's current capabilities are bufferable, but the primitive is reusable for future waves.
- **`TDEconomy.economy` is mutable on the controller.** The dashboard calls `tdController.setEconomy(...)` between waves to reset the budget. The Stage 3a `runWave` path constructs a fresh controller per wave so it never exercises this mutation.
- **Per-wave reset is dashboard-driven, not controller-driven.** The dashboard runs (1) `setEconomy(newEconomy)`, (2) `state.setCondition(id, 1.0)` for every component, (3) `advancePhase(state)` (assess→build) on the wave boundary. The controller does not own this reset — `runWave` mirrors it for the headless campaign test.
- **`tryPlace` advances the registry's id counter even on rollback.** `ComponentRegistry.tryCreate` mints a `Component` (incrementing the internal counter) before `tryPlace` checks the budget. On `insufficient_budget` rejection, the component is discarded but the counter has advanced — `ComponentId` values may have gaps. No test depends on contiguous ids.
- **`tryConnect` uses first-matching-port.** First port with `direction === "egress"` on the source, first with `"ingress"` on the target. Components with multiple in-ports of different roles can't be disambiguated until Stage 3c.
- **`SimLoop` is now generic over `ModeController`.** Constructor takes an `onTick` callback that receives the concrete controller type. The sandbox call site passes a `SandboxModeController`-typed callback that calls `getMetricsSnapshot`; the TD call site passes its own.
```

- [ ] **Step 6: Verify the file is well-formed**

Re-read the modified `CLAUDE.md` sections to make sure the markdown is consistent (no broken bullet lists, no orphan headings).

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update for Stage 3b completion"
```

---

## Final verification

- [ ] **Run the full test suite one last time**

Run: `pnpm test`
Expected: all tests passing, ~580 total (564 existing + ~16 new).

- [ ] **Run typecheck one last time**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **One final dashboard smoke test**

Run: `pnpm dev`. Toggle TD mode. Play through one wave end-to-end. Stop the server.

- [ ] **Report status to user**

Summary of what shipped, test count, and any quirks observed during manual verification. Suggest next steps (PR, merge, Stage 3c brainstorm).

---

## Self-review checklist

(Plan author's note — completed during plan writing.)

- ✅ Every spec section §5.1–§5.9 has a corresponding task
- ✅ Every test from spec §7.1 / §7.2 has a corresponding test code block
- ✅ No "TODO" / "fill in details" / "similar to Task N"
- ✅ Test code is shown in full, not described
- ✅ File paths are absolute or repo-relative
- ✅ Type names used in later tasks (`ConnectResult`, `STUB_REGISTRY`, `forwarding-pipe`) are defined in earlier tasks
- ✅ Stage 3a back-compat is preserved via single-wave shim (Task 6) and verified via running the existing wave tests in Task 6 step 6
- ✅ Manual verification gate (Task 15) precedes the CLAUDE.md update (Task 16)
- ⚠️ Two implementation gaps the agent will need to resolve in-task:
  - Task 6: exact import path for `isEngineBufferable` (verified via grep step)
  - Task 7/8: exact `Position` and `Connection` field shapes (verified via reading source step)
- These are documented as "verify first" steps in the task body, not left as silent TODOs.

# Cache → Data Cache Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition TD-mode Cache from a client-facing reverse proxy to a data-layer cache (Data Cache) sitting between Server and Database, by renaming the component (`cache` → `data_cache`), swapping which Server capability owns `api_read`, and rewiring all affected wave tests.

**Architecture:** Topology-only change. `CachingCapability` and the engine are unchanged. Server's `ProcessingCapability` drops `api_read` and Server's `ForwardingCapability` adds it, so reads now FORWARD downstream instead of RESPOND-ing locally. Data Cache (renamed `CACHE_ENTRY`) sits between Server and Database in the canonical topology. CDN (client-facing edge cache for `static_asset`) is unaffected. Sandbox/core registry's separate `cache` entry is also unaffected (out of scope).

**Tech Stack:** TypeScript, Vitest, Vite, Pixi.js. Pure-TypeScript simulation in `src/core/` and `src/capabilities/`.

**Spec:** `docs/superpowers/specs/2026-04-16-cache-data-cache-redesign-design.md`

**Worktree:** `.worktrees/feature-data-cache-redesign` (branch `feature/data-cache-redesign`).

---

## File Structure

**Production code (modify):**
- `src/modes/td/td-component-entries.ts` — rename `CACHE_ENTRY` → `DATA_CACHE_ENTRY`, update copy.
- `src/modes/td/register-td-defaults.ts` — Server `handledTypes` swap; register renamed entry.
- `src/modes/td/td-waves.ts` — `availableComponents` sweep `cache` → `data_cache` in Waves 3–10.
- `src/modes/td/index.ts` — re-export rename if it exports `CACHE_ENTRY`.
- `src/dashboard/td/component-dossier.ts` — add `data_cache` dossier entry.
- `src/dashboard/td/briefing-card.ts` — `ENTRY_BY_TYPE` map key.
- `src/dashboard/td/diagnose-wave.ts` — loss diagnostic copy.
- `src/dashboard/cyberpunk-hud.ts` — PALETTE entry.
- `src/dashboard/cyberpunk-hud.css` — selector + asset path.
- `src/dashboard/index.html` — classic TD palette button (deprecated path; updated for consistency).
- `src/dashboard/assets/cache.png` → `data-cache.png` — file rename.

**Tests (modify):**
- `tests/integration/td/helpers.ts` — `buildCache` → `buildDataCache`.
- `tests/integration/td/wave-3-traffic-spike.test.ts` — topology + bottleneck cause update.
- `tests/integration/td/wave-3-learning-arc.test.ts` — cache-rescue + LB-rescue rewiring.
- `tests/integration/td/wave-4-cdn-rescue-wins.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-5-server-only-loses.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-5-gateway-rescue-wins.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-6-server-only-loses.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-6-queue-worker-wins.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-7-no-breaker-loses.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-7-breaker-rescue-wins.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-8-no-streaming-server-loses.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-8-streaming-rescue-wins.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-9-single-zone-loses.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-9-multi-zone-dns-wins.test.ts` — per-zone Caches move between Servers and DB.
- `tests/integration/td/wave-10-no-autoscale-loses.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-10-server-autoscale-loses.test.ts` — Cache moves between Server and DB.
- `tests/integration/td/wave-10-full-autoscale-wins.test.ts` — per-zone Caches move between Servers and DB.
- `tests/integration/td/campaign-headless.test.ts` — sweep `"cache"` references.
- `tests/unit/validate-topology.test.ts` — cache topology cases updated to data-cache topology.
- `tests/unit/component-descriptions.test.ts` — rename import.
- `tests/unit/td-mode-controller-place.test.ts` — sweep if it references `"cache"`.

**Tests (create):**
- New test in `tests/integration/td/wave-3-traffic-spike.test.ts` (or sibling) — confirms `Server → Database` (no Data Cache) loses Wave 3 due to DB saturation.
- Optional unit test pinning Server's capability config (Processing without `api_read`, Forwarding with `api_read`).

**Out of scope (do NOT change):**
- `src/capabilities/caching/caching-capability.ts` — works topology-agnostically as-is.
- `src/core/engine/*` and `src/core/component/component.ts` — no engine changes needed.
- `src/core/registry/component-entries.ts` — sandbox/non-TD registry; separate `cache` entry stays for sandbox demos.
- `src/core/registry/register-all.ts` and `tests/unit/bootstrap-registries.test.ts` — sandbox registry's `cache` entry unchanged.
- `src/dashboard/topologies.ts` — sandbox topology demos use the core registry's `cache` entry; unchanged.
- `tests/unit/caching-capability.test.ts` — capability behavior unchanged.
- `marketing/index.html` — marketing page; unrelated to TD teaching arc.
- CDN code (`CDN_ENTRY`, `buildCDN`, etc.) — unaffected.

---

## Slice A — Foundation (breaks tests by design)

This slice renames the component, swaps Server's capability config, and updates the helper. After this slice, the test suite will fail to compile due to missing `buildCache`/`CACHE_ENTRY` references — this is expected. Slice B and Slice C fix the tests.

### Task A1: Rename `CACHE_ENTRY` → `DATA_CACHE_ENTRY` in `td-component-entries.ts`

**Files:**
- Modify: `src/modes/td/td-component-entries.ts:93-122`

- [ ] **Step 1: Replace the `CACHE_ENTRY` block with the new `DATA_CACHE_ENTRY` block**

```ts
export const DATA_CACHE_ENTRY: ComponentRegistryEntry = {
  type: "data_cache",
  name: "Data Cache",
  description:
    "Caches repeated reads between your Server and Database. Like Redis or Memcached — absorbs duplicate queries so the Database isn't hammered for the same data twice.",
  longDescription:
    "A Data Cache sits between your Server and Database, intercepting forwarded reads. " +
    "On a hit it responds directly, sparing the Database. On a miss it forwards to the " +
    "Database and remembers the result for next time. Acts like Redis or Memcached in a " +
    "real backend — best when reads have hot keys, useless for write traffic.",
  capabilitiesHuman: [
    "Responds directly on cache hit (skips Database)",
    "Forwards misses to downstream Database",
    "Best when reads have hot keys",
    "Doesn't accelerate writes",
  ],
  capabilities: [
    { id: "caching" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 1, connections: [] },
  ],
  placementCost: 0,
  rentPerWave: 120,
  upgradeCostCurve: [150, 300, 600],
  visual: { icon: "data_cache", color: "#F5A623", shape: "diamond" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};
```

- [ ] **Step 2: Verify file still typechecks at this point (the test suite will not — that's expected)**

Run: `pnpm typecheck`
Expected: PASS for `src/`, FAIL for `tests/` (missing `CACHE_ENTRY` import in `tests/unit/component-descriptions.test.ts` and others). Do not commit yet — Slice A is one logical commit.

### Task A2: Update Server capability config in `register-td-defaults.ts`

**Files:**
- Modify: `src/modes/td/register-td-defaults.ts:45-77`

- [ ] **Step 1: Move `api_read` from Processing's `handledTypes` to Forwarding's `handledTypes`**

Old block to replace (lines roughly 45–77):

```ts
  capRegistry.register({
    id: "processing" as CapabilityId,
    factory: () =>
      new ProcessingCapability("processing" as CapabilityId, {
        handledTypes: ["api_read", "static_asset", "auth_required"],
        // Stage 3c one-type-per-tick re-tune (Processing + Forwarding
        // contributions sum into a pooled component budget — see
        // `src/core/engine/throughput.ts:componentThroughputPerTick`,
        // they are NOT type-segmented per-cap limits). Server total
        // budget = 15 + 15 = 30. Wave 2 (25/tick either all-reads or
        // all-writes) fits under 30 comfortably. Wave 3 (50/tick) blows
        // through 30 → lone Server loses on either tick type, which is
        // the intended "needs horizontal scale" teaching moment.
        throughputPerTier: 15,
        emitProcessedEvent: true,
        // auth_required on Server is expensive: +4 on top of base 1 = 5
        // ticks latency. Player feels "Server can serve auth, but it's so
        // slow my SLA fails" → teaches API Gateway rescue for Wave 5.
        typeLatencyPenalty: { auth_required: 4 },
      }),
  });
  capRegistry.register({
    id: "forwarding" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding" as CapabilityId, {
        handledTypes: ["api_write"],
        // See note above — this is a budget contribution, not a write
        // cap. Combined with Processing's 15 it gives Server a 30/tick
        // total pooled budget.
        throughputPerTier: 15,
        emitForwardedEvent: true,
      }),
  });
```

New block:

```ts
  capRegistry.register({
    id: "processing" as CapabilityId,
    factory: () =>
      new ProcessingCapability("processing" as CapabilityId, {
        // Data Cache redesign: Server no longer self-responds to api_read.
        // Reads now FORWARD downstream (via the "forwarding" capability
        // below) so Data Cache can intercept them between Server and DB.
        // Processing keeps static_asset (CDN fallback) and auth_required
        // (Gateway fallback) as RESPOND types.
        handledTypes: ["static_asset", "auth_required"],
        // Stage 3c one-type-per-tick re-tune (Processing + Forwarding
        // contributions sum into a pooled component budget — see
        // `src/core/engine/throughput.ts:componentThroughputPerTick`,
        // they are NOT type-segmented per-cap limits). Server total
        // budget = 15 + 15 = 30. Wave 3 (50/tick of mixed reads/writes)
        // saturates Server's forwarding to DB → Database becomes the
        // bottleneck → Data Cache rescue absorbs repeated reads.
        throughputPerTier: 15,
        emitProcessedEvent: true,
        // auth_required on Server is expensive: +4 on top of base 1 = 5
        // ticks latency. Player feels "Server can serve auth, but it's so
        // slow my SLA fails" → teaches API Gateway rescue for Wave 5.
        typeLatencyPenalty: { auth_required: 4 },
      }),
  });
  capRegistry.register({
    id: "forwarding" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding" as CapabilityId, {
        // Data Cache redesign: api_read joins api_write here. Server
        // forwards both to its downstream target (Database, or Data Cache
        // → Database).
        handledTypes: ["api_read", "api_write"],
        // See note above — this is a budget contribution, not a per-type
        // cap. Combined with Processing's 15 it gives Server a 30/tick
        // total pooled budget shared across reads and writes.
        throughputPerTier: 15,
        emitForwardedEvent: true,
      }),
  });
```

- [ ] **Step 2: Update `compRegistry.register(CACHE_ENTRY)` to `compRegistry.register(DATA_CACHE_ENTRY)`**

Find the line (around line 165) that registers the cache entry:

```ts
compRegistry.register(CACHE_ENTRY);
```

Replace with:

```ts
compRegistry.register(DATA_CACHE_ENTRY);
```

Also update the import at the top of the file:

```ts
// Old:
import { ..., CACHE_ENTRY, ... } from "./td-component-entries";
// New:
import { ..., DATA_CACHE_ENTRY, ... } from "./td-component-entries";
```

- [ ] **Step 3: Verify src typechecks**

Run: `pnpm typecheck`
Expected: PASS for `src/`. Test files will still error on `CACHE_ENTRY`/`buildCache` imports — that's expected.

### Task A3: Sweep `availableComponents` in `td-waves.ts`

**Files:**
- Modify: `src/modes/td/td-waves.ts:103-434`

- [ ] **Step 1: Replace `"cache"` with `"data_cache"` in every `availableComponents` array**

Affected waves: WAVE_3 (line ~111), WAVE_4 (line ~132), WAVE_5 (line ~166), WAVE_6 (line ~204), WAVE_7 (line ~242), WAVE_8 (line ~287), WAVE_9 (line ~331), WAVE_10 (line ~389).

Use a single Edit with `replace_all: true` on the file, matching the exact substring `"cache"` (case-sensitive, with the quotes). Verify no false positives by reading the file diff before committing.

Example (WAVE_3):

```ts
// Old:
availableComponents: ["server", "database", "cache", "load_balancer"],
// New:
availableComponents: ["server", "database", "data_cache", "load_balancer"],
```

- [ ] **Step 2: Verify no accidental matches**

Run: `pnpm exec grep -n '"cache"' src/modes/td/td-waves.ts`
Expected: zero matches.

### Task A4: Update `src/modes/td/index.ts` re-exports

**Files:**
- Modify: `src/modes/td/index.ts`

- [ ] **Step 1: Read the file**

```bash
cat src/modes/td/index.ts
```

- [ ] **Step 2: If it re-exports `CACHE_ENTRY`, rename the export**

If the file contains `export { ..., CACHE_ENTRY, ... }` or `export * from "./td-component-entries"`, update the named export from `CACHE_ENTRY` to `DATA_CACHE_ENTRY`. If it uses `export *` no change is needed. If neither, skip this task.

### Task A5: Rename `buildCache` → `buildDataCache` in `tests/integration/td/helpers.ts`

**Files:**
- Modify: `tests/integration/td/helpers.ts:193-203`

- [ ] **Step 1: Rename the function and update the registry create call**

Old:

```ts
/**
 * Build a Cache component from the TD registry (Caching + forwarding-pipe 200/tick).
 */
export function buildCache(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("cache", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}
```

New:

```ts
/**
 * Build a Data Cache component from the TD registry (Caching + forwarding-pipe 200/tick).
 * Wires between Server and Database in the canonical TD topology.
 */
export function buildDataCache(compRegistry: ComponentRegistry, zone?: string): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("data_cache", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}
```

### Task A6: Update `tests/unit/component-descriptions.test.ts` import

**Files:**
- Modify: `tests/unit/component-descriptions.test.ts:1-16`

- [ ] **Step 1: Rename the import and the `TD_ENTRIES` array entry**

Old:

```ts
import {
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
} from "@modes/td/td-component-entries.js";

const TD_ENTRIES = [
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
];
```

New:

```ts
import {
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  DATA_CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
} from "@modes/td/td-component-entries.js";

const TD_ENTRIES = [
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  DATA_CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
];
```

### Task A7: Verify typecheck passes for `src/` after Slice A

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS for `src/`. Test files will still error — Slice B + Slice C resolve those.

- [ ] **Step 2: Do NOT commit yet**

Slice A leaves the test suite in a broken state by design. Continue to Slice B before committing.

---

## Slice B — Wave 1, 2, 3 Test Updates

This slice fixes the Wave 1, 2, 3 tests that the redesign affects. Wave 3 tests are the primary teaching moment: lone-DB-saturation loses, Data Cache rescue wins, LB+Data Cache rescue wins. Wave 1/2 tests get a sweep for missing `buildDatabase` + `wire(server, database)`.

### Task B1: Update `wave-3-traffic-spike.test.ts` — lone-server topology now `Server → Database`

**Files:**
- Modify: `tests/integration/td/wave-3-traffic-spike.test.ts`

- [ ] **Step 1: Update the test's topology and intent**

Old (full file):

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";

describe("Wave 3 — Traffic Spikes (lone-server)", () => {
  it("Server+Database alone loses under Wave 3 load", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const server = buildServer(compRegistry);
    const db = buildDatabase(compRegistry);
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-server-db",
    );

    const result = runWave(state, WAVE_3, server.component.id);

    expect(result.outcome.verdict).toBe("lose");
    // TODO(T16): tune viability to actually fire on this lose path
    // viability stays at 100 even though SLA verdict is "lose" — migrate once tuned:
    // expect(result.finalViability).toBeLessThan(100);
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeGreaterThanOrEqual(0.05);
  });
});
```

New:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import { buildServer, buildDatabase, wire, runWave } from "./helpers.js";

describe("Wave 3 — Traffic Spikes (lone Server → Database)", () => {
  it("Server → Database alone loses under Wave 3 load (DB saturates on reads)", () => {
    // Post-Data-Cache-redesign topology: Server forwards api_read to DB.
    // At Wave 3's 50/tick (35 reads/tick + 15 writes/tick), DB tier-1
    // capacity (25/tick) saturates → drops climb past the 5% threshold.
    // Teaching moment: "your Database is the bottleneck, add a Data Cache".
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const server = buildServer(compRegistry);
    const db = buildDatabase(compRegistry);
    state.placeComponent(server.component);
    state.placeComponent(db.component);
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-server-db",
    );

    const result = runWave(state, WAVE_3, server.component.id);

    expect(result.outcome.verdict).toBe("lose");
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeGreaterThanOrEqual(0.05);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/td/wave-3-traffic-spike.test.ts`
Expected: PASS. If it fails because the drop rate is too low (i.e. Server now self-saturates instead of DB), increase verbosity and inspect — but at 50/tick reads + writes the DB cap of 25/tick should be the dominant bottleneck.

### Task B2: Update `wave-3-learning-arc.test.ts` — Data Cache rescue + LB+Data Cache rescue

**Files:**
- Modify: `tests/integration/td/wave-3-learning-arc.test.ts`

- [ ] **Step 1: Replace the entire file**

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { WAVE_3 } from "@modes/td/td-waves";
import { bootTDRegistry } from "@harness/td-fixtures";
import {
  buildServer,
  buildDatabase,
  buildDataCache,
  buildLoadBalancer,
  wire,
  runWave,
} from "./helpers.js";

describe("Wave 3 — Learning arc (post Data Cache redesign)", () => {
  it("Data Cache rescue: Entry → Server → Data Cache → Database wins", () => {
    // Server forwards api_read downstream. Data Cache (between Server and DB)
    // intercepts reads via INTERCEPT phase: hits RESPOND, misses PASS through
    // forwarding-pipe → DB. With keyPoolSize 10 ≤ tier-1 cache capacity 10,
    // hit rate approaches 100% after warmup → DB pressure relieved → wave passes.
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const server = buildServer(compRegistry);
    const dataCache = buildDataCache(compRegistry);
    const db = buildDatabase(compRegistry);
    state.placeComponent(server.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(db.component);

    // Server → Data Cache → Database
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "cx-server-dc",
    );
    wire(
      state,
      { component: dataCache.component, egressPortId: dataCache.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-dc-db",
    );

    const result = runWave(state, WAVE_3, server.component.id);

    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);

    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeLessThan(0.05);

    // Data Cache must actually be doing work: hit count in meaningful range.
    const cachedHits = result.eventCountsByType.get("CACHED_HIT") ?? 0;
    expect(cachedHits).toBeGreaterThan(0);
    // Loose sanity: at least 10% of generated reads should hit the Data Cache.
    const expectedReads = WAVE_3.intensity * WAVE_3.duration * 0.7;
    expect(cachedHits).toBeGreaterThan(expectedReads * 0.1);
  });

  it("LB + Data Cache rescue: Entry → LB → [Server1, Server2] → Data Cache → Database wins", () => {
    // Two Servers fan out via LB, then fan in to a single shared Data Cache,
    // which absorbs repeated reads before they hit DB. LB still demonstrates
    // load distribution (both Servers > 20% of total processed). Data Cache
    // demonstrates DB protection. Pure LB-without-Data-Cache is no longer a
    // win path because Servers forward all reads to DB which saturates at
    // tier-1 cap 25/tick while Wave 3 generates 35 reads/tick — captured as
    // "Future considerations" in the spec for a separate LB tuning task.
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const compRegistry = bootTDRegistry();

    const lb = buildLoadBalancer("c-lb", 2);
    const server1 = buildServer(compRegistry);
    const server2 = buildServer(compRegistry);
    const dataCache = buildDataCache(compRegistry);
    const db = buildDatabase(compRegistry);
    state.placeComponent(lb.component);
    state.placeComponent(server1.component);
    state.placeComponent(server2.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(db.component);

    // LB → Server1, LB → Server2
    wire(
      state,
      { component: lb.component, egressPortId: lb.egressPortIds[0]! },
      { component: server1.component, ingressPortId: server1.ingressPortId },
      "cx-lb-s1",
    );
    wire(
      state,
      { component: lb.component, egressPortId: lb.egressPortIds[1]! },
      { component: server2.component, ingressPortId: server2.ingressPortId },
      "cx-lb-s2",
    );

    // Server1 → Data Cache, Server2 → Data Cache (fan-in)
    wire(
      state,
      { component: server1.component, egressPortId: server1.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "cx-s1-dc",
    );
    wire(
      state,
      { component: server2.component, egressPortId: server2.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "cx-s2-dc",
    );

    // Data Cache → DB
    wire(
      state,
      { component: dataCache.component, egressPortId: dataCache.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "cx-dc-db",
    );

    const result = runWave(state, WAVE_3, lb.component.id);

    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);
    const dropRate =
      (result.droppedCount + result.timedOutCount) / Math.max(result.totalRequests, 1);
    expect(dropRate).toBeLessThan(0.05);

    // Both servers must have received traffic — via FORWARDED events per component
    // (they forward instead of process now that api_read moved to forwarding cap).
    const s1Forwarded = result.forwardedCountByComponent.get(server1.component.id) ?? 0;
    const s2Forwarded = result.forwardedCountByComponent.get(server2.component.id) ?? 0;
    expect(s1Forwarded).toBeGreaterThan(0);
    expect(s2Forwarded).toBeGreaterThan(0);

    // Load distribution is meaningful — neither server is starved below 20%.
    const totalServerForwarded = s1Forwarded + s2Forwarded;
    expect(s1Forwarded / totalServerForwarded).toBeGreaterThan(0.2);
    expect(s2Forwarded / totalServerForwarded).toBeGreaterThan(0.2);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test tests/integration/td/wave-3-learning-arc.test.ts`
Expected: both tests PASS. If LB-rescue's load-distribution assertion fails, the issue is Server-side throughput pooling, not LB — verify by inspecting `forwardedCountByComponent` for server1/server2.

If `forwardedCountByComponent` doesn't exist on the result type, fall back to `processedCountByComponent` from monitoring (Server emits both PROCESSED and FORWARDED via Monitoring). Confirm by reading `tests/integration/td/helpers.ts:runWave` (the `RunWaveResult` shape).

### Task B3: Sweep Wave 1 and Wave 2 tests for `Server`-only topologies

**Files:**
- Inspect: `tests/**/*wave-1*.test.ts`, `tests/**/*wave-2*.test.ts`, `tests/integration/td/campaign-headless.test.ts`

- [ ] **Step 1: Find Wave 1/2 tests**

Run: `pnpm exec grep -rn "WAVE_1\|WAVE_2" tests/`

Inspect each match. If a test places only a Server (no Database) and runs Wave 1 or Wave 2, the test will now fail because `api_read` forwarded by Server has no egress target.

- [ ] **Step 2: For each affected test, add a Database and wire it**

For each test that needs it, add (after `buildServer`):

```ts
const db = buildDatabase(compRegistry);
state.placeComponent(db.component);
wire(
  state,
  { component: server.component, egressPortId: server.egressPortId },
  { component: db.component, ingressPortId: db.ingressPortId },
  "cx-server-db",
);
```

- [ ] **Step 3: Run Wave 1/2 tests**

Run: `pnpm test tests/integration/td/ -t "Wave 1\|Wave 2"`
Expected: PASS. If a test was specifically asserting "lone Server wins Wave 1" as a teaching demo, it needs reframing — but no such test should exist post-redesign.

### Task B4: (Optional) Add Server capability config pin test

**Files:**
- Create: `tests/unit/td-server-capability-config.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { bootTDRegistry } from "@harness/td-fixtures";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import type { CapabilityId } from "@core/types/ids";

describe("TD Server capability config (Data Cache redesign pin)", () => {
  it("Processing handles static_asset and auth_required but NOT api_read", () => {
    const compRegistry = bootTDRegistry();
    const server = compRegistry.create("server", { x: 0, y: 0 }, null);
    const processing = server.capabilities.get("processing" as CapabilityId) as ProcessingCapability;
    expect(processing.canHandle("static_asset")).toBe(true);
    expect(processing.canHandle("auth_required")).toBe(true);
    expect(processing.canHandle("api_read")).toBe(false);
  });

  it("Forwarding handles api_read and api_write", () => {
    const compRegistry = bootTDRegistry();
    const server = compRegistry.create("server", { x: 0, y: 0 }, null);
    const forwarding = server.capabilities.get("forwarding" as CapabilityId) as ForwardingCapability;
    expect(forwarding.canHandle("api_read")).toBe(true);
    expect(forwarding.canHandle("api_write")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/unit/td-server-capability-config.test.ts`
Expected: PASS. Pins the redesign against accidental regression.

### Task B5: Slice B checkpoint — run Wave 1/2/3 tests + typecheck

- [ ] **Step 1: Run targeted tests**

Run: `pnpm test tests/integration/td/wave-3-traffic-spike.test.ts tests/integration/td/wave-3-learning-arc.test.ts tests/unit/td-server-capability-config.test.ts`
Expected: ALL PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS for `src/` and the touched test files. Other test files (Wave 4–10, validate-topology) still error on `buildCache` — Slice C resolves those.

---

## Slice C — Wave 4–10 Test Rewiring

Each test in this slice has the same mechanical change: rename `buildCache` → `buildDataCache` in imports, and move the Data Cache from upstream of Server to between Server and Database. The general pattern:

**Old wiring:**
```
Client → CDN → Cache → Server → Database
```

**New wiring:**
```
Client → CDN → Server → Data Cache → Database
```

When LB is in the topology, fan multiple Servers into a single shared Data Cache (same as Wave 3 LB-rescue):
```
Client → ... → LB → [Server1, Server2, ...] → Data Cache → Database
```

When Worker/Queue/CB are in the topology, those components stay where they are. Only the Cache moves.

For per-zone topologies (Wave 9, 10), each zone has its own Data Cache between its Servers and DB.

The variable name pattern: rename `cache` → `dataCache` in the test bodies for consistency.

### Task C1: Wave 4 — `wave-4-cdn-rescue-wins.test.ts`

**Files:**
- Modify: `tests/integration/td/wave-4-cdn-rescue-wins.test.ts`

- [ ] **Step 1: Update import and reposition Data Cache**

Change the import:

```ts
// Old:
import { runWave, buildServer, buildDatabase, buildCDN, buildCache, wire } from "./helpers";
// New:
import { runWave, buildServer, buildDatabase, buildCDN, buildDataCache, wire } from "./helpers";
```

Change the variable construction:

```ts
// Old:
const cache = buildCache(compRegistry);
// New:
const dataCache = buildDataCache(compRegistry);
```

Update `state.placeComponent(...)` line accordingly.

Replace the wiring block. Old:

```ts
// Client → CDN
wire(state, { component: client, egressPortId: "client-out" }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn");
// CDN → Cache
wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-cdn-cache");
// Cache → Server
wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: server.component, ingressPortId: server.ingressPortId }, "c-cache-server");
// Server → Database
wire(state, { component: server.component, egressPortId: server.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, "c-server-database");
```

New:

```ts
// Client → CDN
wire(state, { component: client, egressPortId: "client-out" }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn");
// CDN → Server
wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: server.component, ingressPortId: server.ingressPortId }, "c-cdn-server");
// Server → Data Cache
wire(state, { component: server.component, egressPortId: server.egressPortId }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, "c-server-dc");
// Data Cache → Database
wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, "c-dc-database");
```

The CDN's caching assertion (the test's primary purpose — "CDN absorbs static_asset") is unchanged. Data Cache absorbs `api_read` separately.

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/td/wave-4-cdn-rescue-wins.test.ts`
Expected: PASS. CDN still hits ≥30% on `static_asset`; Data Cache absorbs `api_read` to keep DB under cap.

### Task C2: Wave 5 — `wave-5-server-only-loses.test.ts` and `wave-5-gateway-rescue-wins.test.ts`

**Files:**
- Modify: `tests/integration/td/wave-5-server-only-loses.test.ts`
- Modify: `tests/integration/td/wave-5-gateway-rescue-wins.test.ts`

- [ ] **Step 1: Apply the C1 pattern to both files**

In each file:
- Import: `buildCache` → `buildDataCache`.
- Variable: `cache` → `dataCache`. Update `compRegistry.create("data_cache", ...)` via `buildDataCache`.
- Wiring: move the Data Cache from upstream of Server to between Server and Database.

For `wave-5-server-only-loses.test.ts`: this is a "loses" test, so the topology already loses. Keeping the same loss outcome — just relocate the Data Cache so the topology shape is conceptually consistent post-redesign.

For `wave-5-gateway-rescue-wins.test.ts`: the topology likely is `Client → CDN → Gateway → Cache → Server → DB`. After redesign: `Client → CDN → Gateway → Server → Data Cache → DB`.

- [ ] **Step 2: Run the tests**

Run: `pnpm test tests/integration/td/wave-5-server-only-loses.test.ts tests/integration/td/wave-5-gateway-rescue-wins.test.ts`
Expected: both PASS. The win/loss verdicts should remain — Data Cache is in the read path, Gateway absorbs auth, CDN absorbs static.

### Task C3: Wave 6 — `wave-6-server-only-loses.test.ts` and `wave-6-queue-worker-wins.test.ts`

**Files:**
- Modify: `tests/integration/td/wave-6-server-only-loses.test.ts`
- Modify: `tests/integration/td/wave-6-queue-worker-wins.test.ts`

- [ ] **Step 1: Apply the C1 pattern to both files**

For each file: rename import, rename variable, move Data Cache between Server (or final Servers behind LB) and Database.

The Worker/Queue components are not part of the read path (they handle `batch`), so the Data Cache wiring is independent of them. Wire pattern:

- `Client → ... → Server → Data Cache → DB` (single-Server case)
- `Client → ... → LB → [Servers] → Data Cache → DB` (multi-Server case)

- [ ] **Step 2: Run the tests**

Run: `pnpm test tests/integration/td/wave-6-server-only-loses.test.ts tests/integration/td/wave-6-queue-worker-wins.test.ts`
Expected: both PASS.

### Task C4: Wave 7 — `wave-7-no-breaker-loses.test.ts` and `wave-7-breaker-rescue-wins.test.ts`

**Files:**
- Modify: `tests/integration/td/wave-7-no-breaker-loses.test.ts`
- Modify: `tests/integration/td/wave-7-breaker-rescue-wins.test.ts`

- [ ] **Step 1: Apply the C1 pattern**

For `wave-7-breaker-rescue-wins.test.ts`, the existing topology comment is:
```
Client → CDN → Gateway → Cache → Worker → Queue → LB → CB → Server1 → DB
                                                       → Server2..5 → DB
```

New topology:
```
Client → CDN → Gateway → Worker → Queue → LB → CB → Server1 → Data Cache → DB
                                                  → Server2..5 → Data Cache → DB
```

All five Servers fan in to a single shared Data Cache, then to DB. CB still wraps Server1 (the chaos target).

Update the test's topology comment block to reflect the new wiring.

- [ ] **Step 2: Run the tests**

Run: `pnpm test tests/integration/td/wave-7-no-breaker-loses.test.ts tests/integration/td/wave-7-breaker-rescue-wins.test.ts`
Expected: both PASS. CB still demonstrates rescue under chaos.

### Task C5: Wave 8 — `wave-8-no-streaming-server-loses.test.ts` and `wave-8-streaming-rescue-wins.test.ts`

**Files:**
- Modify: `tests/integration/td/wave-8-no-streaming-server-loses.test.ts`
- Modify: `tests/integration/td/wave-8-streaming-rescue-wins.test.ts`

- [ ] **Step 1: Apply the C1 pattern**

For each file: rename import, rename variable, move Data Cache between Server (or final Servers behind LB) and Database. Streaming Server and Blob Storage are independent — they handle the `stream` path, not the data path.

- [ ] **Step 2: Run the tests**

Run: `pnpm test tests/integration/td/wave-8-no-streaming-server-loses.test.ts tests/integration/td/wave-8-streaming-rescue-wins.test.ts`
Expected: both PASS.

### Task C6: Wave 9 — `wave-9-single-zone-loses.test.ts` and `wave-9-multi-zone-dns-wins.test.ts`

**Files:**
- Modify: `tests/integration/td/wave-9-single-zone-loses.test.ts`
- Modify: `tests/integration/td/wave-9-multi-zone-dns-wins.test.ts`

- [ ] **Step 1: Apply the C1 pattern, with per-zone treatment for the multi-zone test**

For `wave-9-single-zone-loses.test.ts`: same pattern as C1 but with a single-zone topology. Rename `cache` → `dataCache`, position between Server and DB.

For `wave-9-multi-zone-dns-wins.test.ts`: each zone has its own Data Cache. Pattern per zone:

```ts
const naServer = buildServer(compRegistry, "na-east");
const naDataCache = buildDataCache(compRegistry, "na-east");
const naDb = buildDatabase(compRegistry, "na-east");
// ...
wire(state, { component: naServer.component, egressPortId: naServer.egressPortId },
     { component: naDataCache.component, ingressPortId: naDataCache.ingressPortId }, "cx-na-s-dc");
wire(state, { component: naDataCache.component, egressPortId: naDataCache.egressPortId },
     { component: naDb.component, ingressPortId: naDb.ingressPortId }, "cx-na-dc-db");
```

Repeat for `eu-west` and `ap-south` zones. The DNS/GTM routing layer is unaffected by the Data Cache repositioning.

- [ ] **Step 2: Run the tests**

Run: `pnpm test tests/integration/td/wave-9-single-zone-loses.test.ts tests/integration/td/wave-9-multi-zone-dns-wins.test.ts`
Expected: both PASS. Multi-zone test still validates DNS routing distributes correctly across zones.

### Task C7: Wave 10 — `wave-10-no-autoscale-loses.test.ts`, `wave-10-server-autoscale-loses.test.ts`, `wave-10-full-autoscale-wins.test.ts`

**Files:**
- Modify: `tests/integration/td/wave-10-no-autoscale-loses.test.ts`
- Modify: `tests/integration/td/wave-10-server-autoscale-loses.test.ts`
- Modify: `tests/integration/td/wave-10-full-autoscale-wins.test.ts`

- [ ] **Step 1: Apply the C1 pattern, per zone for each test**

Same pattern as C6: each zone has its own Data Cache between its Servers and Database. AutoScale on Server and Database is unaffected by Data Cache repositioning — Data Cache itself does not have AutoScale (and shouldn't, per the spec).

- [ ] **Step 2: Run the tests**

Run: `pnpm test tests/integration/td/wave-10-no-autoscale-loses.test.ts tests/integration/td/wave-10-server-autoscale-loses.test.ts tests/integration/td/wave-10-full-autoscale-wins.test.ts`
Expected: all PASS.

### Task C8: `validate-topology.test.ts` — cache topology cases

**Files:**
- Modify: `tests/unit/validate-topology.test.ts`

- [ ] **Step 1: Update the import**

```ts
// Old:
import { ..., buildCache, ... } from "../integration/td/helpers";
// New:
import { ..., buildDataCache, ... } from "../integration/td/helpers";
```

- [ ] **Step 2: Update the "cache path" test (around line 125)**

Old:

```ts
it("cache path: Client -> Cache -> Server is valid", () => {
  // ... wires Client -> Cache -> Server ...
});
```

New:

```ts
it("data cache path: Client -> Server -> Data Cache -> Database is valid", () => {
  const reg = bootTDRegistry();
  const state = makeState();

  const client = reg.create("client", { x: 0, y: 0 }, null);
  state.placeComponent(client);

  const server = buildServer(reg);
  state.placeComponent(server.component);

  const dataCache = buildDataCache(reg);
  state.placeComponent(dataCache.component);

  const db = buildDatabase(reg);
  state.placeComponent(db.component);

  wire(state, { component: client, egressPortId: "p-out" },
        { component: server.component, ingressPortId: server.ingressPortId }, "c-client-server");
  wire(state, { component: server.component, egressPortId: server.egressPortId },
        { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, "c-server-dc");
  wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId },
        { component: db.component, ingressPortId: db.ingressPortId }, "c-dc-db");

  const wave = makeWave(new Map([["api_read", 1.0]]));
  const errors = validateTopology(state, wave, client.id);

  expect(errors).toEqual([]);
});
```

- [ ] **Step 3: Update the "cycle: A -> B -> A" test (around line 224)**

The cycle test uses `buildCache(reg)` and wires `Client -> Cache -> Client` to test cycle detection. The validation should still detect the cycle regardless of which component fills the cycle. Update the variable name and `buildCache` call:

```ts
// Old:
const cache = buildCache(reg);
state.placeComponent(cache.component);
wire(state, { component: client, egressPortId: "p-out" }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-client-cache");
wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: client, ingressPortId: "p-out" }, "c-cache-client");
```

New:

```ts
const dataCache = buildDataCache(reg);
state.placeComponent(dataCache.component);
wire(state, { component: client, egressPortId: "p-out" }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, "c-client-dc");
wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId }, { component: client, ingressPortId: "p-out" }, "c-dc-client");
```

The test's intent (cycle detection) is preserved. The semantic is now `Client -> Data Cache -> Client` which is still a cycle.

- [ ] **Step 4: Update the "multi-type: Wave 4 composition" test (around line 263)**

Old wires `Client -> CDN -> Cache -> Server -> DB`. New wires `Client -> CDN -> Server -> Data Cache -> DB`.

Apply the same rename + repositioning pattern as C1.

- [ ] **Step 5: Run the file**

Run: `pnpm test tests/unit/validate-topology.test.ts`
Expected: all tests PASS.

### Task C9: `td-mode-controller-place.test.ts` and other unit-test sweep

**Files:**
- Inspect: `tests/unit/td-mode-controller-place.test.ts`
- Inspect: any remaining tests with `"cache"` string literals

- [ ] **Step 1: Find remaining references**

Run: `pnpm exec grep -rn '\\"cache\\"' tests/ src/modes/td/ src/dashboard/td/`

For each match in TD/test code (NOT `src/core/registry/component-entries.ts` or `src/dashboard/topologies.ts` — those are out of scope), update to `"data_cache"`.

For each `buildCache(` reference, update to `buildDataCache(`.

For each `CACHE_ENTRY` import, update to `DATA_CACHE_ENTRY`.

- [ ] **Step 2: Run the touched files individually**

Run: `pnpm test <each-touched-file>`
Expected: PASS.

### Task C10: `campaign-headless.test.ts` sweep

**Files:**
- Modify: `tests/integration/td/campaign-headless.test.ts`

- [ ] **Step 1: Inspect for cache references**

Read the file. If it builds Cache via `buildCache`, apply the C1 pattern. If it only references the type string `"cache"` in a wave's `availableComponents` check, update to `"data_cache"`.

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/td/campaign-headless.test.ts`
Expected: PASS.

### Task C11: Slice C checkpoint — full test suite + typecheck

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS. Test count should be ~764–770 (was 762, +2–3 new tests).

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS clean.

- [ ] **Step 3: Commit Slices A + B + C as a single logical unit**

```bash
git add src/modes/td/ src/dashboard/td/briefing-card.ts \
        tests/integration/td/ tests/unit/component-descriptions.test.ts \
        tests/unit/validate-topology.test.ts tests/unit/td-server-capability-config.test.ts
git commit -m "$(cat <<'EOF'
feat(td): cache → data cache redesign (capability + tests)

Repositions Cache from a client-facing reverse proxy to a data-layer
cache (Redis/Memcached pattern) sitting between Server and Database.

- CACHE_ENTRY → DATA_CACHE_ENTRY (type "data_cache").
- Server's ProcessingCapability drops api_read; Server's
  ForwardingCapability adds api_read. Reads now FORWARD to downstream
  (Data Cache → Database) instead of RESPOND-ing locally.
- Wave 3 lone-server test asserts DB saturation (was Server saturation).
- Wave 3 cache-rescue test rewired: Server → Data Cache → DB.
- Wave 3 LB-rescue test rewired: LB → Servers → Data Cache → DB.
- Waves 4–10 tests rewired: Data Cache moves from upstream of Server
  to between Server and DB.
- New unit test pins Server's capability config.

CachingCapability and engine unchanged — topology-only change.
CDN unchanged. Sandbox/core registry "cache" entry unchanged
(separate teaching context).

Spec: docs/superpowers/specs/2026-04-16-cache-data-cache-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Slice D — Dashboard Polish

This slice updates the dashboard UI: palette, dossier, briefing card, diagnostic copy, CSS, asset rename. After this slice, the player-facing UI shows "Data Cache" everywhere.

### Task D1: Update PALETTE in `cyberpunk-hud.ts`

**Files:**
- Modify: `src/dashboard/cyberpunk-hud.ts:28-35`

- [ ] **Step 1: Update the PALETTE entry**

Old:

```ts
const PALETTE: readonly PaletteEntry[] = [
  { type: "server", label: "Server" },
  { type: "database", label: "Database" },
  { type: "cache", label: "Cache" },
  { type: "load_balancer", label: "Balancer" },
  { type: "cdn", label: "CDN" },
  { type: "api_gateway", label: "Gateway" },
];
```

New:

```ts
const PALETTE: readonly PaletteEntry[] = [
  { type: "server", label: "Server" },
  { type: "database", label: "Database" },
  { type: "data_cache", label: "Data Cache" },
  { type: "load_balancer", label: "Balancer" },
  { type: "cdn", label: "CDN" },
  { type: "api_gateway", label: "Gateway" },
];
```

### Task D2: Update CSS selector and rename asset

**Files:**
- Modify: `src/dashboard/cyberpunk-hud.css:560-561`
- Rename: `src/dashboard/assets/cache.png` → `src/dashboard/assets/data-cache.png`

- [ ] **Step 1: Rename the asset file**

```bash
git mv src/dashboard/assets/cache.png src/dashboard/assets/data-cache.png
```

- [ ] **Step 2: Update the CSS selector and url() reference**

Old:

```css
body.renderer-iso .cp-palette-icon[data-type="cache"] {
  background-image: url("./assets/cache.png");
}
```

New:

```css
body.renderer-iso .cp-palette-icon[data-type="data_cache"] {
  background-image: url("./assets/data-cache.png");
}
```

### Task D3: Add `data_cache` dossier in `component-dossier.ts`

**Files:**
- Modify: `src/dashboard/td/component-dossier.ts`

- [ ] **Step 1: Read the existing structure**

```bash
cat src/dashboard/td/component-dossier.ts
```

Note the shape of existing entries (e.g. `server`, `database`).

- [ ] **Step 2: Add the `data_cache` entry to the `DOSSIERS` map**

Add the new entry alongside `server` and `database`:

```ts
data_cache: {
  title: "Data Cache",
  role: "Sits between your Server and Database to absorb repeated read queries — like Redis or Memcached in a real backend.",
  wire: "Server → Data Cache → Database",
  tip: "When your Database is the bottleneck and reads repeat, drop a Data Cache in front of it to absorb the duplicates.",
  capabilities: [
    "Responds directly on cache hit (skips Database)",
    "Forwards misses through to Database",
    "Best when reads have hot keys",
    "Doesn't accelerate writes",
  ],
},
```

Match the exact shape of `server` and `database` entries (field names may differ from the above — adapt to the existing `ComponentDossier` interface).

### Task D4: Update `briefing-card.ts` `ENTRY_BY_TYPE`

**Files:**
- Modify: `src/dashboard/td/briefing-card.ts:34-42`

- [ ] **Step 1: Update the import and the map**

Old import:

```ts
import { ..., CACHE_ENTRY, ... } from "@modes/td/td-component-entries";
```

New:

```ts
import { ..., DATA_CACHE_ENTRY, ... } from "@modes/td/td-component-entries";
```

Old map:

```ts
const ENTRY_BY_TYPE: Record<string, ComponentRegistryEntry> = {
  ...
  cache: CACHE_ENTRY,
  ...
};
```

New:

```ts
const ENTRY_BY_TYPE: Record<string, ComponentRegistryEntry> = {
  ...
  data_cache: DATA_CACHE_ENTRY,
  ...
};
```

If the briefing card has a label-registry mapping types to display names, ensure `data_cache` → "Data Cache" is present (or add it if not).

### Task D5: Update loss diagnostic in `diagnose-wave.ts`

**Files:**
- Modify: `src/dashboard/td/diagnose-wave.ts`

- [ ] **Step 1: Read the existing diagnostics**

```bash
cat src/dashboard/td/diagnose-wave.ts
```

Look for any diagnostic copy referring to "cache" or "Cache" in the read path.

- [ ] **Step 2: Update copy where applicable**

Replace any "no cache in the read path" / "put a Cache in front of your Server" copy with the post-redesign version:

> "Your Database is saturated on read traffic. Add a Data Cache between your Server and Database to absorb repeated reads, or scale horizontally."

If the diagnostic logic dispatches by component type, add a branch for `data_cache` (or rename `cache` → `data_cache` in dispatch keys).

### Task D6: Update classic TD palette in `src/dashboard/index.html`

**Files:**
- Modify: `src/dashboard/index.html:59`

- [ ] **Step 1: Update the palette button**

Old:

```html
<button class="td-palette-btn" data-type="cache">+ Cache $150</button>
```

New:

```html
<button class="td-palette-btn" data-type="data_cache">+ Data Cache $150</button>
```

The classic TD palette is marked deprecated in favor of the iso/cyberpunk renderer, but updating it for consistency keeps the codebase honest.

### Task D7: Slice D checkpoint — typecheck + dashboard smoke test

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: ALL PASS.

- [ ] **Step 3: Manual dashboard smoke test**

Run: `pnpm dev`

Open in a browser:
- `/?renderer=iso#mode=td` — verify the palette shows "Data Cache" with the renamed asset visible.
- Place a Data Cache, hover it — confirm the dossier shows the new copy.
- Wire `Client → Server → Data Cache → Database` for Wave 3 and click READY. Verify the wave plays and Data Cache absorbs reads (cache-hit visual feedback, if any).
- Trigger a Wave 3 loss with `Client → Server → Database` (no Data Cache). Verify the loss diagnostic mentions Data Cache.

Stop the dev server when done: `lsof -ti:5173 | xargs kill` (only if no other worktree is using it).

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/
git commit -m "$(cat <<'EOF'
feat(dashboard): data cache UI labels, dossier, diagnostic copy

- Cyberpunk palette: "Cache" → "Data Cache".
- CSS selector + asset rename: cache.png → data-cache.png.
- New dossier entry for data_cache (was on Slice C roadmap).
- Briefing card ENTRY_BY_TYPE updated.
- Loss diagnostic copy: "Database is saturated, add a Data Cache".
- Classic TD palette button updated for consistency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Slice E — Wrap-up

### Task E1: Update `docs/claude/implementation-status.md`

**Files:**
- Modify: `docs/claude/implementation-status.md`

- [ ] **Step 1: Move "Cache → Data Cache redesign" out of "Next task" and into "What ships"**

Add a new entry under "What ships (merged into `main`)":

```markdown
**Data Cache redesign (post Stage 5b)** — Cache renamed to Data Cache and repositioned from a client-facing reverse proxy to a data-layer cache (Redis/Memcached pattern) sitting between Server and Database. Topology-only change: Server's ProcessingCapability drops `api_read`, Server's ForwardingCapability adds `api_read`, so reads now FORWARD downstream instead of RESPOND-ing locally. CachingCapability and engine unchanged. Wave 3 teaching arc rewired: lone Server → Database loses on DB saturation; Server → Data Cache → DB rescue wins; LB + Data Cache rescue wins. Waves 4–10 tests rewired with Data Cache between Server (or Servers behind LB) and Database. CDN unchanged (still client-facing for static_asset). Sandbox/core registry's separate `cache` entry unchanged. ~770 tests total.
```

Remove the "Next task: Cache → Data Cache redesign" section. Promote "Phase 2 candidates" up to that position.

Update the header line from "TD mode is playable through Wave 10 — all 10 waves shipped." to keep the same flavor but add a brief note about the redesign.

- [ ] **Step 2: Optionally update the bullet under "Phase 2 candidates"**

Replace "Cache → Data Cache redesign (NEXT)" with the next priority item from the candidate list.

### Task E2: Final commit and PR-ready state

- [ ] **Step 1: Verify clean state**

Run: `git status`
Expected: only the implementation-status.md change is uncommitted.

- [ ] **Step 2: Commit**

```bash
git add docs/claude/implementation-status.md
git commit -m "$(cat <<'EOF'
docs(status): mark Cache → Data Cache redesign shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Final verification**

Run in parallel:
- `pnpm test` — expect ALL PASS, count ~770.
- `pnpm typecheck` — expect PASS clean.

- [ ] **Step 4: Report ready**

Branch is ready for merge. Switch to the finishing-a-development-branch skill to decide between merge, PR, or further review.

---

## Plan Self-Review

**Spec coverage:**
- ✅ Server capability reconfiguration → Task A2 + Task B4 (pin)
- ✅ Component type rename `cache` → `data_cache` → Tasks A1, A2 (registration), A3 (waves), A4 (re-exports), D1, D2, D4, D6
- ✅ CachingCapability no behavioral changes → confirmed in design notes; no task needed
- ✅ Wave 3 redesign → Tasks B1 (lone-server), B2 (rescue tests)
- ✅ Wave 1/2 sweep → Task B3
- ✅ Waves 4–10 rewiring → Tasks C1–C7
- ✅ Validate-topology + other unit tests → Tasks C8, C9
- ✅ Campaign-headless → Task C10
- ✅ Dossier + dashboard copy → Tasks D1, D2, D3, D4, D5, D6
- ✅ Future considerations captured in spec; not in plan scope

**Placeholder scan:** All steps contain concrete code blocks or exact commands. No "TBD" / "implement appropriately" / "similar to Task N" without code repetition.

**Type consistency:**
- Component type string: `"data_cache"` (snake_case) used everywhere.
- Component name: `"Data Cache"` (Title Case with space) used in display strings.
- Variable name in tests: `dataCache` (camelCase) used everywhere.
- Helper function: `buildDataCache` used everywhere.
- Component entry constant: `DATA_CACHE_ENTRY` used everywhere.
- Dossier key: `data_cache` used everywhere.
- CSS selector: `data-type="data_cache"` used everywhere.
- Asset filename: `data-cache.png` (kebab-case) — consistent with web asset naming (other assets in `src/dashboard/assets/` use kebab-case).

**Out-of-scope items called out:** Sandbox/core registry's `cache` entry unchanged. Marketing HTML unchanged. LB tuning deferred. Cache invalidation deferred.

---

## Execution Notes

- Each Slice (A–E) ends with a checkpoint task (typecheck + tests + commit).
- Slice A intentionally leaves the test suite broken — do NOT attempt to fix tests inside Slice A.
- Slice B brings Wave 1/2/3 tests green.
- Slice C brings Wave 4–10 + unit tests green.
- Slice D adds dashboard polish (no test impact).
- Slice E updates docs.
- Total commit count: ~3 (Slices A+B+C combined into one feat commit, Slice D is a feat commit, Slice E is a docs commit). Adjust granularity if review feedback prefers smaller commits.

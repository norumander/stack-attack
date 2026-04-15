# Stage 4b: Wave 9 — Going Global Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Wave 9 ("Going Global") — multi-zone latency penalties in the engine, TDTrafficSource zone assignment, DNS/GTM component for geo-routing, zone-aware test helpers, and win/lose integration tests.

**Architecture:** One engine change (add zone-pair latency to `getEffectiveLatency`), plus TD content wiring (traffic source zones, DNS/GTM entry, wave definition). Test helpers extended with optional zone parameter. The zone type infrastructure (`ZoneTopology`, `getZonePairLatency`, `GeoRoutingCapability`) is already production-ready — this stage wires it into the TD mode pipeline.

**Tech Stack:** TypeScript, Vitest, existing `@core/`, `@modes/td/`, `@capabilities/`, `@harness/` modules.

---

## File Structure

| File                                                    | Action | Responsibility                                      |
|---------------------------------------------------------|--------|-----------------------------------------------------|
| `src/core/engine/effective-bandwidth.ts`                | Modify | Add zone-pair latency to `getEffectiveLatency()`    |
| `src/modes/td/td-mode-controller.ts`                   | Modify | Read `wave.zoneTopology` in `getInitialZoneTopology()` |
| `src/modes/td/td-traffic-source.ts`                    | Modify | Populate `originZone` from `wave.zoneDistribution`  |
| `src/modes/td/td-component-entries.ts`                  | Modify | Add `DNS_GTM_ENTRY`                                 |
| `src/modes/td/register-td-defaults.ts`                  | Modify | Wire `geo-routing` factory + `DNS_GTM_ENTRY`        |
| `src/modes/td/td-waves.ts`                              | Modify | Add `WAVE_9` definition                             |
| `tests/integration/td/helpers.ts`                       | Modify | Zone params on builders + `buildDNSGTM` + `runWave` zone topology |
| `tests/unit/effective-latency-zone.test.ts`             | Create | Zone latency unit tests                             |
| `tests/unit/td-traffic-source-zone.test.ts`             | Create | Zone assignment unit tests                          |
| `tests/unit/wave-9-definition.test.ts`                  | Create | Wave 9 definition assertions                        |
| `tests/integration/td/wave-9-single-zone-loses.test.ts` | Create | Loss test: single-zone fails latency SLA            |
| `tests/integration/td/wave-9-multi-zone-dns-wins.test.ts` | Create | Win test: multi-zone + DNS/GTM passes SLA         |

---

### Task 1: Engine — add zone-pair latency to getEffectiveLatency

**Files:**
- Modify: `src/core/engine/effective-bandwidth.ts` (lines 28-56)
- Create: `tests/unit/effective-latency-zone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/effective-latency-zone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { getEffectiveLatency } from "@core/engine/effective-bandwidth";
import { Component } from "@core/component/component";
import type { ConnectionId, ComponentId, PortId, CapabilityId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import { zonePairKey } from "@core/types/zone";

const healthy: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [{ kind: "latency_multiplier", factor: 2 }],
  criticalEffects: [{ kind: "latency_multiplier", factor: 3 }],
};

function makeComp(id: string, zone: string | null, condition = 1.0): Component {
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
    conditionProfile: healthy,
    initialCondition: condition,
  });
}

function setupCrossZone(
  sourceZone: string | null,
  targetZone: string | null,
  pairLatency: Map<string, number> = new Map(),
  baseLatency = 1,
): { state: SimulationState; connId: ConnectionId } {
  const state = new SimulationState({
    zones: ["na-east", "eu-west", "ap-south"],
    pairLatency,
  });
  const src = makeComp("src", sourceZone);
  const tgt = makeComp("tgt", targetZone);
  state.placeComponent(src);
  state.placeComponent(tgt);
  const connId = "c1" as ConnectionId;
  state.addConnection({
    id: connId,
    source: { componentId: "src" as ComponentId, portId: "p" as PortId },
    target: { componentId: "tgt" as ComponentId, portId: "p" as PortId },
    bandwidth: 100,
    latency: baseLatency,
    currentLoad: 0,
  });
  return { state, connId };
}

describe("getEffectiveLatency — zone-pair penalty", () => {
  it("adds zone-pair latency for cross-zone connection", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const { state, connId } = setupCrossZone("na-east", "eu-west", pairLatency);
    // base(1) * condition(1) + zone(3) = 4
    expect(getEffectiveLatency(state, connId)).toBe(4);
  });

  it("adds 0 for same-zone connection", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const { state, connId } = setupCrossZone("na-east", "na-east", pairLatency);
    // base(1) * condition(1) + zone(0) = 1
    expect(getEffectiveLatency(state, connId)).toBe(1);
  });

  it("adds 0 when source zone is null (backward compat)", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const { state, connId } = setupCrossZone(null, "eu-west", pairLatency);
    expect(getEffectiveLatency(state, connId)).toBe(1);
  });

  it("adds 0 when target zone is null (backward compat)", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const { state, connId } = setupCrossZone("na-east", null, pairLatency);
    expect(getEffectiveLatency(state, connId)).toBe(1);
  });

  it("zone penalty is NOT multiplied by condition degradation", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const state = new SimulationState({
      zones: ["na-east", "eu-west"],
      pairLatency,
    });
    const src = makeComp("src", "na-east", 0.5); // degraded → 2x multiplier
    const tgt = makeComp("tgt", "eu-west");
    state.placeComponent(src);
    state.placeComponent(tgt);
    const connId = "c1" as ConnectionId;
    state.addConnection({
      id: connId,
      source: { componentId: "src" as ComponentId, portId: "p" as PortId },
      target: { componentId: "tgt" as ComponentId, portId: "p" as PortId },
      bandwidth: 100,
      latency: 1,
      currentLoad: 0,
    });
    // base(1) * condition(2) + zone(3) = 5, NOT (1 + 3) * 2 = 8
    expect(getEffectiveLatency(state, connId)).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/effective-latency-zone.test.ts`
Expected: FAIL — first test expects 4 but gets 1 (no zone latency applied yet).

- [ ] **Step 3: Implement zone-pair latency in getEffectiveLatency**

In `src/core/engine/effective-bandwidth.ts`, add import at top:

```ts
import { getZonePairLatency } from "../types/zone.js";
```

Replace the `getEffectiveLatency` function (lines 28-56) with:

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
  // its active latency_multiplier effects. Applies to base + chaos only.
  const fromComp = state.components.get(conn.source.componentId);
  if (fromComp) {
    latency *= getLatencyMultiplier(fromComp);
  }

  // Zone-pair latency: cross-zone connections pay a fixed geographic
  // penalty. Additive, not affected by condition degradation.
  const toComp = state.components.get(conn.target.componentId);
  if (fromComp && toComp) {
    latency += getZonePairLatency(state.zoneTopology, fromComp.zone, toComp.zone);
  }

  return latency;
}
```

- [ ] **Step 4: Run zone test to verify it passes**

Run: `pnpm test tests/unit/effective-latency-zone.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run existing effective-latency tests for regressions**

Run: `pnpm test tests/unit/effective-latency.test.ts`
Expected: PASS — existing tests use `zone: null` components, so `getZonePairLatency` returns 0.

- [ ] **Step 6: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/engine/effective-bandwidth.ts tests/unit/effective-latency-zone.test.ts
git commit -m "feat(engine): getEffectiveLatency adds zone-pair latency for cross-zone connections"
```

---

### Task 2: TDModeController — read wave.zoneTopology

**Files:**
- Modify: `src/modes/td/td-mode-controller.ts` (lines 363-365)

- [ ] **Step 1: Update getInitialZoneTopology**

In `src/modes/td/td-mode-controller.ts`, find `getInitialZoneTopology()` at line 363-365. The current wave is accessed via `this.waves[this.currentWaveIndex]`. Find how the controller accesses the current wave — look for a `get currentWave()` getter or use `this.waves[this.currentWaveIndex]`.

Replace:

```ts
  getInitialZoneTopology(): ZoneTopology {
    return { zones: ["default"], pairLatency: new Map() };
  }
```

With:

```ts
  getInitialZoneTopology(): ZoneTopology {
    const wave = this.waves[this.currentWaveIndex]!;
    if (wave.zoneTopology) {
      return {
        zones: [...wave.zoneTopology.zones],
        pairLatency: wave.zoneTopology.pairLatency,
      };
    }
    return { zones: ["default"], pairLatency: new Map() };
  }
```

- [ ] **Step 2: Run full suite for regressions**

Run: `pnpm test`
Expected: All pass. Waves 1–8 have no `zoneTopology`, so the fallback returns the same default.

- [ ] **Step 3: Commit**

```bash
git add src/modes/td/td-mode-controller.ts
git commit -m "feat(td): TDModeController reads wave.zoneTopology in getInitialZoneTopology"
```

---

### Task 3: TDTrafficSource — populate originZone from zoneDistribution

**Files:**
- Modify: `src/modes/td/td-traffic-source.ts` (line 75 + new pickZone helper)
- Create: `tests/unit/td-traffic-source-zone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/td-traffic-source-zone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TDTrafficSource } from "@modes/td/td-traffic-source";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const ZONE_WAVE: TDWaveDefinition = {
  id: 99,
  name: "Zone Test",
  startingBudget: 1000,
  intensity: 100,
  composition: new Map([["api_read", 1.0]]),
  duration: 5,
  ttl: 10,
  availableComponents: ["server"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1]]),
  keyPoolSize: 10,
  connectionBandwidth: 100,
  zoneDistribution: new Map([
    ["na-east", 0.40],
    ["eu-west", 0.35],
    ["ap-south", 0.25],
  ]),
  sla: { availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 5 },
};

const NO_ZONE_WAVE: TDWaveDefinition = {
  id: 98,
  name: "No Zone Test",
  startingBudget: 1000,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 5,
  ttl: 10,
  availableComponents: ["server"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1]]),
  keyPoolSize: 10,
  connectionBandwidth: 100,
  sla: { availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 5 },
};

describe("TDTrafficSource zone assignment", () => {
  it("assigns originZone from zoneDistribution when present", () => {
    const source = new TDTrafficSource({
      wave: ZONE_WAVE,
      targetEntryPointId: "client" as ComponentId,
      rng: makeRng(1),
    });
    const requests = source.generate(0);
    expect(requests.length).toBe(100);

    const zoneCounts = new Map<string, number>();
    for (const req of requests) {
      expect(req.originZone).not.toBeNull();
      const zone = req.originZone!;
      expect(["na-east", "eu-west", "ap-south"]).toContain(zone);
      zoneCounts.set(zone, (zoneCounts.get(zone) ?? 0) + 1);
    }
    // With 100 requests and weighted distribution, each zone should have > 0 requests
    expect(zoneCounts.get("na-east")).toBeGreaterThan(0);
    expect(zoneCounts.get("eu-west")).toBeGreaterThan(0);
    expect(zoneCounts.get("ap-south")).toBeGreaterThan(0);
  });

  it("leaves originZone null when no zoneDistribution", () => {
    const source = new TDTrafficSource({
      wave: NO_ZONE_WAVE,
      targetEntryPointId: "client" as ComponentId,
      rng: makeRng(1),
    });
    const requests = source.generate(0);
    for (const req of requests) {
      expect(req.originZone).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/td-traffic-source-zone.test.ts`
Expected: FAIL — `originZone` is null for all requests.

- [ ] **Step 3: Implement zone assignment**

In `src/modes/td/td-traffic-source.ts`, add a `pickZone` helper function before the class:

```ts
/**
 * Weighted random zone selection. Picks a zone from the distribution
 * using the provided RNG. Each call returns one zone name.
 */
function pickZone(
  distribution: ReadonlyMap<string, number>,
  rng: () => number,
): string {
  const r = rng();
  let cumulative = 0;
  for (const [zone, weight] of distribution) {
    cumulative += weight;
    if (r < cumulative) return zone;
  }
  // Fallback: return last zone (handles floating-point edge case)
  return [...distribution.keys()].pop()!;
}
```

Then in `generate()`, replace line 75:

```ts
        originZone: null,
```

With:

```ts
        originZone: this.wave.zoneDistribution
          ? pickZone(this.wave.zoneDistribution, this.rng)
          : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/td-traffic-source-zone.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run existing traffic source tests for regressions**

Run: `pnpm test tests/unit/td-traffic-source`
Expected: All pass. Waves 1–8 have no `zoneDistribution`, so the null fallback keeps existing behavior.

- [ ] **Step 6: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/modes/td/td-traffic-source.ts tests/unit/td-traffic-source-zone.test.ts
git commit -m "feat(td): TDTrafficSource assigns originZone from wave.zoneDistribution"
```

---

### Task 4: TD DNS/GTM entry + registerTDDefaults wiring

**Files:**
- Modify: `src/modes/td/td-component-entries.ts`
- Modify: `src/modes/td/register-td-defaults.ts`

- [ ] **Step 1: Add DNS_GTM_ENTRY**

In `src/modes/td/td-component-entries.ts`, after `BLOB_STORAGE_ENTRY`, add:

```ts
export const DNS_GTM_ENTRY: ComponentRegistryEntry = {
  type: "dns_gtm",
  name: "DNS / GTM",
  description: "Routes requests to the nearest healthy zone.",
  longDescription:
    "A global traffic manager that inspects request origin zones and routes each " +
    "request to the nearest datacenter. Eliminates cross-zone latency penalties by " +
    "ensuring requests are served locally.",
  capabilitiesHuman: [
    "Routes requests to nearest zone",
    "Forwards all traffic types at high throughput",
    "Monitors throughput and health",
  ],
  capabilities: [
    { id: "geo-routing" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 4, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 4, connections: [] },
  ],
  placementCost: 300,
  upgradeCostCurve: [300, 600],
  visual: { icon: "dns", color: "#14b8a6", shape: "globe" },
  conditionProfile: RESILIENT_CONDITION_PROFILE,
};
```

- [ ] **Step 2: Wire in registerTDDefaults**

In `src/modes/td/register-td-defaults.ts`:

Add import at top (after BlobStorageCapability import):

```ts
import { GeoRoutingCapability } from "@capabilities/geo-routing/geo-routing-capability.js";
```

Add `DNS_GTM_ENTRY` to the destructured import from `td-component-entries.js`:

```ts
import {
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
  CLIENT_ENTRY,
  CDN_ENTRY,
  API_GATEWAY_ENTRY,
  QUEUE_ENTRY,
  WORKER_ENTRY,
  CIRCUIT_BREAKER_ENTRY,
  STREAMING_SERVER_ENTRY,
  BLOB_STORAGE_ENTRY,
  DNS_GTM_ENTRY,
} from "./td-component-entries.js";
```

Add capability registration (after `blob-storage` registration):

```ts
  capRegistry.register({
    id: "geo-routing" as CapabilityId,
    factory: () => new GeoRoutingCapability("geo-routing" as CapabilityId),
    documentsSubInterfaces: ["EngineConsultable"],
  });
```

Add component registration (after `BLOB_STORAGE_ENTRY` registration):

```ts
  compRegistry.register(DNS_GTM_ENTRY);
```

- [ ] **Step 3: Run typecheck + full suite**

Run: `pnpm typecheck && pnpm test`
Expected: Clean typecheck, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modes/td/td-component-entries.ts src/modes/td/register-td-defaults.ts
git commit -m "feat(td): DNS_GTM_ENTRY + geo-routing capability wired in registerTDDefaults"
```

---

### Task 5: Extend test helpers — zone params + buildDNSGTM

**Files:**
- Modify: `tests/integration/td/helpers.ts`

- [ ] **Step 1: Add optional zone parameter to all registry-backed builders**

In `tests/integration/td/helpers.ts`, update every builder that calls `compRegistry.create(type, pos, null)` to accept an optional `zone` parameter. The third argument to `compRegistry.create()` is `zone: string | null`.

Update each function signature and body. Example for `buildServer`:

```ts
export function buildServer(
  compRegistry: ComponentRegistry,
  zone?: string,
): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("server", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}
```

Apply the same change to: `buildDatabase`, `buildCache`, `buildCDN`, `buildAPIGateway`, `buildQueue`, `buildWorker`, `buildCircuitBreaker`, `buildStreamingServer`, `buildBlobStorage`.

Each one: add `zone?: string` as the second parameter (after `compRegistry`), and change the third arg of `compRegistry.create()` from `null` to `zone ?? null`.

**Do NOT change `buildLoadBalancer`** — it constructs components manually, not via the registry.

**Do NOT change `buildWorkerWithForwarding`** — it constructs components manually.

- [ ] **Step 2: Add buildDNSGTM helper**

After the last builder, add:

```ts
/**
 * Build a DNS/GTM component from the TD registry (GeoRoutingCapability +
 * forwarding-pipe + Monitoring). Routes requests to nearest zone via
 * EngineConsultable.selectConnection(). Zone-agnostic — sits at entry point.
 */
export function buildDNSGTM(compRegistry: ComponentRegistry): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("dns_gtm", { x: 0, y: 0 }, null);
  return { component, ...singlePortIds(component) };
}
```

- [ ] **Step 3: Update runWave to pass zone topology to SimulationState**

Currently `runWave` creates `SimulationState` with: `{ zones: ["default"], pairLatency: new Map() }`. For Wave 9, the state needs the wave's zone topology. Update `runWave`:

Find the line that creates SimulationState (currently around line 63-64 area — look for `new SimulationState`). It's not in runWave — SimulationState is passed in by the caller. Let me check...

Actually, looking at the existing tests, `SimulationState` is created **by the test** (not by `runWave`). The test does:
```ts
const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
```

So the Wave 9 tests will create their own state with the correct zone topology. No change to `runWave` needed.

**However**, `runWave` creates a `TDModeController` internally which calls `getInitialZoneTopology()`. The mode controller returns the wave's zone topology (from Task 2). But `runWave` also creates the SimulationState's zone topology... wait, no — `runWave` receives `state` as a parameter. The **caller** creates the state.

So the Wave 9 tests must create state with the correct zone topology:
```ts
const state = new SimulationState({
  zones: ["na-east", "eu-west", "ap-south"],
  pairLatency: new Map([
    [zonePairKey("na-east", "ap-south"), 5],
    [zonePairKey("na-east", "eu-west"), 3],
    [zonePairKey("eu-west", "ap-south"), 4],
  ]),
});
```

No `runWave` changes needed for zone topology.

- [ ] **Step 4: Run all existing wave integration tests**

Run: `pnpm test tests/integration/td/`
Expected: All pass. Zone param defaults to `null` — all existing callers are unaffected.

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/td/helpers.ts
git commit -m "feat(td): add zone param to builders, add buildDNSGTM helper"
```

---

### Task 6: WAVE_9 definition + unit test

**Files:**
- Modify: `src/modes/td/td-waves.ts`
- Create: `tests/unit/wave-9-definition.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/wave-9-definition.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WAVE_9 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";

describe("WAVE_9 — Going Global", () => {
  it("has correct id, name, and starting budget", () => {
    expect(WAVE_9.id).toBe(9);
    expect(WAVE_9.name).toBe("Going Global");
    expect(WAVE_9.startingBudget).toBe(2500);
  });

  it("composition includes stream at 0.30 and api_read at 0.25", () => {
    expect(WAVE_9.composition.get("stream")).toBeCloseTo(0.30);
    expect(WAVE_9.composition.get("api_read")).toBeCloseTo(0.25);
  });

  it("includes dns_gtm in availableComponents", () => {
    expect(WAVE_9.availableComponents).toContain("dns_gtm");
    expect(WAVE_9.availableComponents).toContain("streaming_media_server");
  });

  it("has zoneTopology with 3 zones", () => {
    expect(WAVE_9.zoneTopology).toBeDefined();
    expect(WAVE_9.zoneTopology!.zones).toEqual(["na-east", "eu-west", "ap-south"]);
  });

  it("has correct zone pair latencies", () => {
    const pl = WAVE_9.zoneTopology!.pairLatency;
    expect(pl.get(zonePairKey("na-east", "eu-west"))).toBe(3);
    expect(pl.get(zonePairKey("na-east", "ap-south"))).toBe(5);
    expect(pl.get(zonePairKey("eu-west", "ap-south"))).toBe(4);
  });

  it("has zoneDistribution with 3 zones summing to ~1.0", () => {
    expect(WAVE_9.zoneDistribution).toBeDefined();
    const dist = WAVE_9.zoneDistribution!;
    expect(dist.get("na-east")).toBeCloseTo(0.40);
    expect(dist.get("eu-west")).toBeCloseTo(0.35);
    expect(dist.get("ap-south")).toBeCloseTo(0.25);
  });

  it("intensity is 800 and SLA maxAvgLatency is 4", () => {
    expect(WAVE_9.intensity).toBe(800);
    expect(WAVE_9.sla).toBeDefined();
    expect(WAVE_9.sla!.maxAvgLatency).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/wave-9-definition.test.ts`
Expected: FAIL — `WAVE_9` is not exported.

- [ ] **Step 3: Add WAVE_9 definition**

In `src/modes/td/td-waves.ts`, after WAVE_8, add:

```ts
export const WAVE_9: TDWaveDefinition = {
  id: 9,
  name: "Going Global",
  startingBudget: 2500,
  intensity: 800,
  composition: new Map([
    ["api_read", 0.25],
    ["api_write", 0.10],
    ["static_asset", 0.15],
    ["auth_required", 0.10],
    ["batch", 0.10],
    ["stream", 0.30],
  ]),
  duration: 40,
  ttl: 15,
  availableComponents: [
    "server", "database", "cache", "load_balancer", "cdn", "api_gateway",
    "queue", "worker", "circuit_breaker", "streaming_media_server", "blob_storage",
    "dns_gtm",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
    ["batch", 5],
    ["stream", 8],
  ]),
  keyPoolSize: 15,
  connectionBandwidth: 800,
  streamConfig: {
    duration: 20,
    bandwidth: 3,
  },
  zoneTopology: {
    zones: ["na-east", "eu-west", "ap-south"],
    pairLatency: new Map([
      ["ap-south|na-east", 5],
      ["eu-west|na-east", 3],
      ["ap-south|eu-west", 4],
    ]),
  },
  zoneDistribution: new Map([
    ["na-east", 0.40],
    ["eu-west", 0.35],
    ["ap-south", 0.25],
  ]),
  sla: {
    availabilityTarget: 0.90,
    maxAvgLatency: 4,
    minBudget: 0,
    penaltyPerTick: 8,
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/wave-9-definition.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-waves.ts tests/unit/wave-9-definition.test.ts
git commit -m "feat(td): WAVE_9 definition — Going Global with zoneTopology and zoneDistribution"
```

---

### Task 7: Wave 9 loss-path integration test

**Files:**
- Create: `tests/integration/td/wave-9-single-zone-loses.test.ts`

- [ ] **Step 1: Write the loss test**

Create `tests/integration/td/wave-9-single-zone-loses.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_9 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";
import {
  runWave,
  buildServer,
  buildDatabase,
  buildCache,
  buildCDN,
  buildAPIGateway,
  buildLoadBalancer,
  buildQueue,
  buildStreamingServer,
  buildWorkerWithForwarding,
  wire,
} from "./helpers";

describe("Wave 9 — single zone loses", () => {
  it("all infrastructure in na-east fails latency SLA from cross-zone penalties", () => {
    const compRegistry = bootTDRegistry();
    // State with Wave 9's zone topology
    const state = new SimulationState({
      zones: ["na-east", "eu-west", "ap-south"],
      pairLatency: new Map([
        [zonePairKey("na-east", "ap-south"), 5],
        [zonePairKey("na-east", "eu-west"), 3],
        [zonePairKey("eu-west", "ap-south"), 4],
      ]),
    });

    // All components in na-east — no zone diversity
    const zone = "na-east";
    const client = compRegistry.create("client", { x: 0, y: 0 }, zone);
    const cdn = buildCDN(compRegistry, zone);
    const gateway = buildAPIGateway(compRegistry, zone);
    const cache = buildCache(compRegistry, zone);
    const streamServer = buildStreamingServer(compRegistry, zone);
    const queue = buildQueue(compRegistry, zone);
    const worker = buildWorkerWithForwarding();
    const serverCount = 5;
    const lb = buildLoadBalancer("lb", serverCount);
    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry, zone));
    const database = buildDatabase(compRegistry, zone);

    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(cache.component);
    state.placeComponent(streamServer.component);
    state.placeComponent(queue.component);
    state.placeComponent(worker.component);
    state.placeComponent(lb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 800 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 800 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", { bandwidth: 800 });
    wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: streamServer.component, ingressPortId: streamServer.ingressPortId }, "c-cache-ss", { bandwidth: 15000 });
    wire(state, { component: streamServer.component, egressPortId: streamServer.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-ss-queue", { bandwidth: 800 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-queue-worker", { bandwidth: 800 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-worker-lb", { bandwidth: 800 });
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 800 });
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, `c-s${i}-db`, { bandwidth: 800 });
    }

    const result = runWave(state, WAVE_9, client.id);

    // Single-zone topology: EU (35%) and AP (25%) requests accumulate
    // cross-zone latency on every hop. Latency SLA (max 4) should fail.
    expect(result.outcome.verdict).toBe("lose");
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm test tests/integration/td/wave-9-single-zone-loses.test.ts`
Expected: PASS (verdict "lose" — cross-zone latency accumulates past SLA max 4).

If unexpectedly "win": zone latency values (3/5/4) may be too mild. Increase them in WAVE_9 definition or tighten maxAvgLatency.

- [ ] **Step 3: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/td/wave-9-single-zone-loses.test.ts
git commit -m "test(td): Wave 9 single-zone topology loses on latency SLA"
```

---

### Task 8: Wave 9 win-path integration test

**Files:**
- Create: `tests/integration/td/wave-9-multi-zone-dns-wins.test.ts`

- [ ] **Step 1: Write the win test**

Create `tests/integration/td/wave-9-multi-zone-dns-wins.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_9 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";
import {
  runWave,
  buildServer,
  buildDatabase,
  buildCache,
  buildCDN,
  buildAPIGateway,
  buildLoadBalancer,
  buildQueue,
  buildStreamingServer,
  buildDNSGTM,
  buildWorkerWithForwarding,
  wire,
} from "./helpers";

describe("Wave 9 — multi-zone DNS rescue wins", () => {
  it("DNS/GTM routes to per-zone infrastructure, latency SLA passes", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({
      zones: ["na-east", "eu-west", "ap-south"],
      pairLatency: new Map([
        [zonePairKey("na-east", "ap-south"), 5],
        [zonePairKey("na-east", "eu-west"), 3],
        [zonePairKey("eu-west", "ap-south"), 4],
      ]),
    });

    // Entry point: Client (zone-agnostic) → DNS/GTM (zone-agnostic)
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const dns = buildDNSGTM(compRegistry);

    // NA zone stack: CDN → Cache → StreamServer → LB → Server×2 → DB
    const naCdn = buildCDN(compRegistry, "na-east");
    const naCache = buildCache(compRegistry, "na-east");
    const naSs = buildStreamingServer(compRegistry, "na-east");
    const naLb = buildLoadBalancer("na-lb", 2);
    const naS1 = buildServer(compRegistry, "na-east");
    const naS2 = buildServer(compRegistry, "na-east");
    const naDb = buildDatabase(compRegistry, "na-east");

    // EU zone stack: CDN → Cache → StreamServer → LB → Server×2 → DB
    const euCdn = buildCDN(compRegistry, "eu-west");
    const euCache = buildCache(compRegistry, "eu-west");
    const euSs = buildStreamingServer(compRegistry, "eu-west");
    const euLb = buildLoadBalancer("eu-lb", 2);
    const euS1 = buildServer(compRegistry, "eu-west");
    const euS2 = buildServer(compRegistry, "eu-west");
    const euDb = buildDatabase(compRegistry, "eu-west");

    // AP zone stack (lighter): CDN → Cache → Server×2 → DB
    const apCdn = buildCDN(compRegistry, "ap-south");
    const apCache = buildCache(compRegistry, "ap-south");
    const apLb = buildLoadBalancer("ap-lb", 2);
    const apS1 = buildServer(compRegistry, "ap-south");
    const apS2 = buildServer(compRegistry, "ap-south");
    const apDb = buildDatabase(compRegistry, "ap-south");

    // Place all components
    state.placeComponent(client);
    state.placeComponent(dns.component);
    // NA
    state.placeComponent(naCdn.component);
    state.placeComponent(naCache.component);
    state.placeComponent(naSs.component);
    state.placeComponent(naLb.component);
    state.placeComponent(naS1.component);
    state.placeComponent(naS2.component);
    state.placeComponent(naDb.component);
    // EU
    state.placeComponent(euCdn.component);
    state.placeComponent(euCache.component);
    state.placeComponent(euSs.component);
    state.placeComponent(euLb.component);
    state.placeComponent(euS1.component);
    state.placeComponent(euS2.component);
    state.placeComponent(euDb.component);
    // AP
    state.placeComponent(apCdn.component);
    state.placeComponent(apCache.component);
    state.placeComponent(apLb.component);
    state.placeComponent(apS1.component);
    state.placeComponent(apS2.component);
    state.placeComponent(apDb.component);

    const bw = 800;
    const ssBw = 15000; // High bandwidth for streaming server ingress (stream reservation)
    const clientEgress = client.ports.find(p => p.direction === "egress")!;

    // Client → DNS
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: dns.component, ingressPortId: dns.ingressPortId }, "c-client-dns", { bandwidth: bw });
    // DNS → per-zone CDNs (GeoRoutingCapability routes by request.originZone)
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: naCdn.component, ingressPortId: naCdn.ingressPortId }, "c-dns-na", { bandwidth: bw });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: euCdn.component, ingressPortId: euCdn.ingressPortId }, "c-dns-eu", { bandwidth: bw });
    wire(state, { component: dns.component, egressPortId: dns.egressPortId }, { component: apCdn.component, ingressPortId: apCdn.ingressPortId }, "c-dns-ap", { bandwidth: bw });

    // NA zone wiring
    wire(state, { component: naCdn.component, egressPortId: naCdn.egressPortId }, { component: naCache.component, ingressPortId: naCache.ingressPortId }, "na-cdn-cache", { bandwidth: bw });
    wire(state, { component: naCache.component, egressPortId: naCache.egressPortId }, { component: naSs.component, ingressPortId: naSs.ingressPortId }, "na-cache-ss", { bandwidth: ssBw });
    wire(state, { component: naSs.component, egressPortId: naSs.egressPortId }, { component: naLb.component, ingressPortId: naLb.ingressPortId }, "na-ss-lb", { bandwidth: bw });
    wire(state, { component: naLb.component, egressPortId: naLb.egressPortIds[0]! }, { component: naS1.component, ingressPortId: naS1.ingressPortId }, "na-lb-s1", { bandwidth: bw });
    wire(state, { component: naLb.component, egressPortId: naLb.egressPortIds[1]! }, { component: naS2.component, ingressPortId: naS2.ingressPortId }, "na-lb-s2", { bandwidth: bw });
    wire(state, { component: naS1.component, egressPortId: naS1.egressPortId }, { component: naDb.component, ingressPortId: naDb.ingressPortId }, "na-s1-db", { bandwidth: bw });
    wire(state, { component: naS2.component, egressPortId: naS2.egressPortId }, { component: naDb.component, ingressPortId: naDb.ingressPortId }, "na-s2-db", { bandwidth: bw });

    // EU zone wiring
    wire(state, { component: euCdn.component, egressPortId: euCdn.egressPortId }, { component: euCache.component, ingressPortId: euCache.ingressPortId }, "eu-cdn-cache", { bandwidth: bw });
    wire(state, { component: euCache.component, egressPortId: euCache.egressPortId }, { component: euSs.component, ingressPortId: euSs.ingressPortId }, "eu-cache-ss", { bandwidth: ssBw });
    wire(state, { component: euSs.component, egressPortId: euSs.egressPortId }, { component: euLb.component, ingressPortId: euLb.ingressPortId }, "eu-ss-lb", { bandwidth: bw });
    wire(state, { component: euLb.component, egressPortId: euLb.egressPortIds[0]! }, { component: euS1.component, ingressPortId: euS1.ingressPortId }, "eu-lb-s1", { bandwidth: bw });
    wire(state, { component: euLb.component, egressPortId: euLb.egressPortIds[1]! }, { component: euS2.component, ingressPortId: euS2.ingressPortId }, "eu-lb-s2", { bandwidth: bw });
    wire(state, { component: euS1.component, egressPortId: euS1.egressPortId }, { component: euDb.component, ingressPortId: euDb.ingressPortId }, "eu-s1-db", { bandwidth: bw });
    wire(state, { component: euS2.component, egressPortId: euS2.egressPortId }, { component: euDb.component, ingressPortId: euDb.ingressPortId }, "eu-s2-db", { bandwidth: bw });

    // AP zone wiring (lighter — no streaming server, no queue/worker)
    wire(state, { component: apCdn.component, egressPortId: apCdn.egressPortId }, { component: apCache.component, ingressPortId: apCache.ingressPortId }, "ap-cdn-cache", { bandwidth: bw });
    wire(state, { component: apCache.component, egressPortId: apCache.egressPortId }, { component: apLb.component, ingressPortId: apLb.ingressPortId }, "ap-cache-lb", { bandwidth: bw });
    wire(state, { component: apLb.component, egressPortId: apLb.egressPortIds[0]! }, { component: apS1.component, ingressPortId: apS1.ingressPortId }, "ap-lb-s1", { bandwidth: bw });
    wire(state, { component: apLb.component, egressPortId: apLb.egressPortIds[1]! }, { component: apS2.component, ingressPortId: apS2.ingressPortId }, "ap-lb-s2", { bandwidth: bw });
    wire(state, { component: apS1.component, egressPortId: apS1.egressPortId }, { component: apDb.component, ingressPortId: apDb.ingressPortId }, "ap-s1-db", { bandwidth: bw });
    wire(state, { component: apS2.component, egressPortId: apS2.egressPortId }, { component: apDb.component, ingressPortId: apDb.ingressPortId }, "ap-s2-db", { bandwidth: bw });

    const result = runWave(state, WAVE_9, client.id);

    // 1. SLA passes
    expect(result.outcome.verdict).toBe("win");
    expect(result.outcome.slaResults?.availability.passed).toBe(true);
    expect(result.outcome.slaResults?.latency.passed).toBe(true);

    // 2. DNS/GTM routed traffic (proves it was in the pipeline)
    const dnsForwarded = result.forwardedCountByComponent.get(dns.component.id) ?? 0;
    expect(dnsForwarded).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm test tests/integration/td/wave-9-multi-zone-dns-wins.test.ts`

If it fails:
- **Verdict "lose" on latency:** DNS/GTM may not be routing correctly. Check that GeoRoutingCapability.selectConnection() receives the correct zone topology. Ensure DNS egress connections target components with zones set.
- **Verdict "lose" on availability:** 800/tick split 3 ways (320 NA, 280 EU, 200 AP). Each zone has 2 servers at 15 throughput each = 30/tick. This is far below demand. **You will likely need more servers per zone or higher server throughput.** Try 4-5 servers per zone, or accept that the test needs topology tuning.
- **DNS/GTM not routing by zone:** GeoRoutingCapability needs to see target component zones on egress connections. Verify that CDN components have zones set and that DNS's egress connections lead to zoned CDNs.

**Tuning guidance:**
- If per-zone throughput is insufficient: add more servers per zone (3-4 each)
- If streaming causes bandwidth starvation: keep ssBw at 15000 on cache→StreamServer links
- If budget is insufficient: the test doesn't check budget — $2500 isn't enforced in integration tests
- If buildLoadBalancer components have no zone: LB is constructed manually with `zone: null`. This is fine — LB is a routing component, zone latency on LB connections is negligible compared to server→DB hops.

- [ ] **Step 3: Tune and iterate until test passes**

Apply minimal fixes. Document any tuning decisions.

- [ ] **Step 4: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/td/wave-9-multi-zone-dns-wins.test.ts
git commit -m "test(td): Wave 9 multi-zone DNS/GTM rescue wins with latency SLA"
```

---

### Task 9: Verify full suite and typecheck

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All pass. Note the total count.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: Clean.

---

### Task 10: Update handoff documentation

**Files:**
- Modify: `docs/claude/implementation-status.md`
- Modify: `docs/claude/td-stage-gotchas.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update implementation-status.md stage line**

Replace the `**Current stage:**` line with:

```
**Current stage:** Phase 1, Stage 4b complete. TD mode is playable through Wave 9. Wave 9 teaches geographic latency via multi-zone topology with DNS/GTM routing. Engine's getEffectiveLatency now applies zone-pair penalties. [TEST_COUNT] tests, typecheck clean.
```

- [ ] **Step 2: Add Stage 4b paragraph**

After the Stage 4a paragraph in "What ships", add:

```markdown
**Stage 4b: Wave 9 — Going Global (multi-zone latency)** — First engine change since Stage 2c: `getEffectiveLatency()` now adds cross-zone latency via `getZonePairLatency()` (additive, after condition multiplier). `TDModeController.getInitialZoneTopology()` reads `wave.zoneTopology` instead of returning hardcoded single-zone. `TDTrafficSource` assigns `request.originZone` from `wave.zoneDistribution` via weighted random per request. `DNS_GTM_ENTRY` (geo-routing + forwarding-pipe + monitoring) added to TD bundle. All test helpers extended with optional `zone` parameter (backward compatible). Win/lose integration tests validate single-zone latency failure and multi-zone DNS routing rescue. [TEST_COUNT] tests total.
```

- [ ] **Step 3: Update next-candidates section**

```markdown
## Next: Stage 4c+ candidates (no spec yet)

- **Wave 10 — The Viral Moment.** Stress-test boss wave (3000+ req/tick). AutoScaleCapability needs source-dive.
- **Dashboard zone visualization.** Zone regions on renderer, connection latency display.
- **Cross-zone replication.** CAP theorem teaching — writes in one zone take time to reach others.
- **Zone-aware chaos.** `zone_outage` targets entire zones (typed but unused).
- **Adaptive zone routing.** Load-based routing beyond nearest-zone.
```

- [ ] **Step 4: Add Stage 4b gotchas**

Append to `docs/claude/td-stage-gotchas.md`:

```markdown
## Stage 4b gotchas

- **Zone latency is additive, after condition multiplier.** `getEffectiveLatency` applies `(base + chaos) * conditionMultiplier + zonePairLatency`. Zone penalty is fixed physics — not amplified by degraded component health.
- **Zone latency values are in tick-units, not milliseconds.** NA↔EU = 3 ticks, NA↔AP = 5 ticks, EU↔AP = 4 ticks. These accumulate per connection hop — a 6-hop cross-zone path adds 6×penalty to total latency.
- **`buildLoadBalancer` and `buildWorkerWithForwarding` still have no zone parameter.** They construct components manually (not via registry). Their components have `zone: null`. This is acceptable — routing/processing components don't need zone assignment for latency to work (latency comes from the connection between source and target zones).
- **DNS/GTM has egress capacity 4.** Supports up to 4 zone-specific egress connections. All connections share the single `p-out` port. GeoRoutingCapability's `selectConnection()` picks the best connection by comparing target component zones against `request.originZone`.
- **`pickZone` uses weighted random, not stratified scheduling.** Unlike type scheduling (one-type-per-tick), zone assignment is per-request within each tick. This gives natural zone mixing: a tick with 800 requests will have ~320 NA, ~280 EU, ~200 AP (with variance). The RNG is seeded, so results are reproducible.
- **SimulationState zone topology is set by the test caller, not by runWave.** The `runWave` helper receives `state` as a parameter. Wave 9 tests must construct `new SimulationState({ zones: [...], pairLatency: ... })` with the correct topology. The `TDModeController.getInitialZoneTopology()` hook is used by the dashboard, not by the test helper.
```

- [ ] **Step 5: Update CLAUDE.md**

Replace `**Current stage:**` line:

```
**Current stage:** Phase 1, Stage 4b complete. TD mode is playable through Wave 9. Wave 9 teaches geographic latency (multi-zone + DNS/GTM routing). [TEST_COUNT] tests, typecheck clean.
```

- [ ] **Step 6: Run full suite one final time**

Run: `pnpm test && pnpm typecheck`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add docs/claude/implementation-status.md docs/claude/td-stage-gotchas.md CLAUDE.md
git commit -m "docs(stage-4b): handoff docs — status, gotchas, CLAUDE.md updated"
```

---

### Task 11: Update roadmap and final push

**Files:**
- Modify: `docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md`

- [ ] **Step 1: Mark Wave 9 as shipped**

Update Wave 9's row:

```
| 9 | Going Global | 4b | ✅ Shipped | 2026-04-14 |
```

Also update the "NOT in place" section — mark cross-zone latency as verified:

Find the bullet about "Cross-zone latency applied to request completion time" and update it to: `✅ Verified in Stage 4b. getEffectiveLatency adds zone-pair penalty after condition multiplier.`

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md
git commit -m "docs(roadmap): mark Wave 9 as shipped, zone latency verified"
```

- [ ] **Step 3: Push to remote**

```bash
git push origin main
```

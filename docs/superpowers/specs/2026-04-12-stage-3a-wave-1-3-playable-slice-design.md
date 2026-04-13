# Stage 3a — Wave 1–3 Playable Slice (Design)

**Status:** Design
**Date:** 2026-04-12
**Depends on:** Stage 2c TTL/SCALE/routing (merged at `167e6d2` on `main`)
**Supersedes:** — (first spec for Stage 3)

## 1. Context and motivation

Stages 2a–2c delivered a complete, tested simulation engine. The tick loop,
capability pipeline, condition/chaos/upkeep, TTL, SCALE, and condition-aware
routing all work under 406 passing tests. But only one real production
capability exists (`RoutingCapability`), the `ProcessingCapability` is
still a Stage 1 test stub (fixed `outcomeKind`, `canHandle` returns `true`
unconditionally — explicitly marked "Removed when the real capability
lands in a later stage"), the component registry is empty, and no
`ModeController` implementation exists for TD mode. The engine is ready;
nothing yet uses it as a game.

The full Stage 3 scope implied by `component-architecture.md` is ~22
capabilities and 13 component types — too large for a single spec. This
spec defines Stage 3a: the smallest headless slice that proves the core
game loop works end-to-end before the project invests in a UI.

**Why a vertical slice now, not a horizontal one.** The project's core
thesis ("Build → Watch → Assess feels like an auto-battler") is
unfalsifiable in unit tests. Shipping 22 capabilities headless would
validate nothing about whether watching requests flow feels like a game.
The biggest remaining unknown is whether the simulation produces an
interesting enough signal under load that a rendered version would be
worth playing. Stage 3a exists to answer that question with an integration
test, not a UI.

**Why Waves 1–3 specifically.** Wave 1 alone is too thin — a single server
handling 10 req/tick doesn't exercise any architectural decision. Wave 3
is where the first real tradeoff appears (horizontal scale vs. caching),
and the "learning arc" — lone-server fails Wave 3, then either Cache or
LoadBalancer+Servers rescues it — is the minimum unit that proves the
game's core teaching moment works. Three waves is the shortest arc that
includes the first meaningful architectural lesson.

## 2. Goals

1. Replace the Stage 1 `ProcessingCapability` stub with a production
   implementation that differentiates by request type, and ship three new
   production capabilities — `StorageCapability`, `CachingCapability`,
   `MonitoringCapability` — all implementing the standard `Capability`
   interface with no engine sub-interfaces.
2. Register four component types — `Server`, `Database`, `Cache`,
   `LoadBalancer` — in the `ComponentRegistry` via a new
   `registerTDDefaults()` bootstrap function.
3. Ship a TD mode stack — `TDModeController`, `TDEconomy`,
   `TDTrafficSource` — parallel to the existing sandbox implementations,
   supporting wave-based gameplay.
4. Define Waves 1–3 as data (intensity, composition, duration, budget,
   pass thresholds, available components) in a `td-waves.ts` module.
5. Write integration tests that run Waves 1–3 end-to-end through the
   engine and assert the full learning arc: Wave 1 passes with trivial
   topology, Wave 2 passes with Server+Database, Wave 3 fails with
   lone-Server and passes with either Cache-rescue or LoadBalancer-rescue.

The engine is unchanged. All four capabilities (one rewrite, three new)
are pure pipeline capabilities. The registry interfaces are unchanged.
No new engine sub-interfaces, no new tick steps, no new event types.

## 3. Non-goals

Explicitly out of scope for Stage 3a (deferred to Stage 3b+ or the UI
stage):

- The other 19 capabilities (`AuthCapability`, `RateLimitCapability`,
  `CircuitBreakerCapability`, `ReplicationCapability`, `ShardingCapability`,
  `SearchCapability`, `StreamingCapability`, `BlobStorageCapability`,
  `BatchProcessingCapability`, `QueueCapability` production,
  `FilterCapability`, `GeoRoutingCapability`, `AutoScaleCapability`,
  `SSLTerminationCapability`, `CompressionCapability`, `RetryCapability`,
  `RegistrationCapability`, `HealthCheckCapability`, `LoggingCapability`).
- The other 9 component types (`CDN`, `APIGateway`, `ServiceRegistry`,
  `Worker`, `CircuitBreaker`, `DNSGlobalTrafficManager`, `BlobStorage`,
  `StreamingMediaServer`, `Queue`/Message Queue).
- **Tier upgrades.** Every capability runs at Tier 1 in Stage 3a.
  `upgradeCostCurve` is declared in registry entries for completeness but
  no test exercises `component.upgrade()`. Upgrades are a UI-stage concern.
- **Chaos events.** `TDModeController.getScheduledChaos()` returns `[]`.
  Wave 7+ feature.
- **Zones / multi-region.** `originZone` stays `null`,
  `getInitialZoneTopology()` returns a single default zone. Wave 9+
  feature.
- **Insolvency-driven component death.** `TDEconomy.resolveInsolvency()`
  returns `[]`. Wave-pass assertions check `budget > 0` at end-of-wave
  instead of mid-wave killing.
- **Upgrade economy.** `TDEconomy.debitUpgrade()` is a no-op.
- **Rich post-wave assessment.** `evaluateOutcome()` returns a minimal
  `{ passed, budget, dropRate, totalRequests }` shape. Detailed diagnostics
  (per-component latency breakdown, request traceback) come with the UI.
- **Per-component metric streams.** `MonitoringCapability` in Stage 3a is
  ceremonial — it exists so component registry entries can declare an
  OBSERVE-phase capability without crashing. Real per-component metric
  capture extends the OBSERVE phase in a later stage.
- **Wave-gated capability unlocks.** `TDModeController.getActiveCapabilities()`
  returns every capability the component has — no wave-based gating.
  Wave-based capability availability is a 3b+ concern.

## 4. New files and directory layout

```
src/capabilities/
├── processing/             (existing)
├── routing/                (existing)
├── storage/
│   └── storage-capability.ts           NEW
├── caching/
│   └── caching-capability.ts           NEW
└── monitoring/
    └── monitoring-capability.ts        NEW

src/modes/
├── sandbox/                (existing)
└── td/                                 NEW directory
    ├── index.ts
    ├── td-economy.ts
    ├── td-traffic-source.ts
    ├── td-mode-controller.ts
    ├── td-waves.ts
    ├── td-component-entries.ts         (all 4 component registry entries)
    └── register-td-defaults.ts

tests/integration/td/                   NEW directory
├── wave-1-launch-day.test.ts
├── wave-2-signups.test.ts
├── wave-3-traffic-spike.test.ts
└── wave-3-learning-arc.test.ts
```

No files under `src/core/` are modified. No files under `src/core/engine/`
are modified. The registry classes in `src/core/registry/` are unchanged —
only a new bootstrap function consumes them.

## 5. Capability contracts

All four capabilities implement `Capability` from
`src/core/capability/capability.ts`. None implement `EngineConsultable`,
`EngineBufferable`, `EnginePullable`, or `InstanceDirectory`.

### 5.0 `ProcessingCapability` (stub → production rewrite)

**Location:** `src/capabilities/processing/processing-capability.ts`
(existing file, replaced)
**Phase:** `PROCESS`
**Capability ID:** `"processing"`

**Why this isn't just a new capability.** The current implementation is a
Stage 1 test stub with a `ProcessingCapabilityOptions` config that forces
a single `outcomeKind`, a `canHandle` that returns `true` unconditionally,
and a source comment saying "Removed when the real capability lands in
a later stage." Stage 3a is that stage. The replacement uses the same
class name and same file location so the ~dozen unit/integration tests
that already reference `new ProcessingCapability(...)` keep working with
minimal mechanical updates.

**Behavior:**
- `canHandle(requestType)`: returns `true` for `"api_read"`, `false` for
  `"api_write"`. This is the read/write split that makes the Wave 2
  integration test meaningful — the Server processes reads directly and
  falls through on writes, which the engine converts to a FORWARD
  delivery to the Database.
- `process(request, context)`: returns `RESPOND` for reads with a
  tier-dependent latency (T1: +1 tick). Emits one `PROCESSED` event.
  (The capability never runs on writes because `canHandle` filtered
  them out in the component's PROCESS-phase capability-selection loop.)
- `getUpkeepCost(tier)`: `{ 1: 2, 2: 5, 3: 10 }[tier] ?? 2`.
- Operational state: `{ processedCount: number }`.
- Migration note: existing tests using `new ProcessingCapability(id, { outcomeKind: "FORWARD" })`
  need to be re-examined. Many of them exist specifically because the
  Stage 1 `PASS`-default was insufficient. The real production
  capability's behavior (RESPOND on reads, fall-through on writes) may
  replace several test fixtures entirely, but some may still need a
  forward-only test stub. A minimal `TestForwardingProcessor` harness
  capability can cover that gap if needed — resolved during Slice A
  implementation.

### 5.1 `StorageCapability`

**Location:** `src/capabilities/storage/storage-capability.ts`
**Phase:** `PROCESS`
**Capability ID:** `"storage"` (cast to `CapabilityId`)

**Behavior:**
- `canHandle(requestType)`: returns `true` for `"api_write"` only.
  Reads are handled at the Server by `ProcessingCapability`, so the
  Database never receives reads in Stage 3a topologies. Declaring
  `canHandle` tightly on writes makes the intent explicit and simplifies
  test assertions. (A later stage can relax this when read-from-DB
  topologies become meaningful — e.g., when Cache goes in front of DB
  instead of in front of Server.)
- `process(request, context)`: returns `RESPOND` with a tier-dependent
  latency (T1: +2 ticks). Emits one `PROCESSED` event. Increments
  internal write counter for `getStats()`.
- `getUpkeepCost(tier)`: `{ 1: 4, 2: 8, 3: 16 }[tier] ?? 4`. Upkeep table
  is declared for all three tiers even though only T1 runs in Stage 3a —
  keeps the interface honest for later tier work.
- Operational state: `{ writeCount: number }`. Read by `getStats()`,
  never by the engine.
- No cache, no replication, no sharding — those are separate capabilities
  in other stages. Stage 3a's `StorageCapability` is "does the write, adds
  latency, costs upkeep."

### 5.2 `CachingCapability`

**Location:** `src/capabilities/caching/caching-capability.ts`
**Phase:** `INTERCEPT`
**Capability ID:** `"caching"`

**Behavior:**
- Internal state: `Map<string, { tick: number }>` where the key is the
  stringified `request.payload`. Fixed-capacity (T1: 10 entries) with FIFO
  eviction when full.
- `canHandle()`: returns `true` (INTERCEPT capabilities always do).
- `process(request, context)`:
  - If `request.type !== "api_read"`: return `PASS`. Writes and other
    types flow through to the PROCESS phase.
  - If the key is present: return `RESPOND` with `CACHED_HIT` event and
    `latencyAdded: 0`. Short-circuits the pipeline.
  - If the key is absent: insert the key into the map (the cache-on-miss
    shortcut, see §9), return `PASS`. The PROCESS phase handles the miss
    (typically by forwarding to Database).
- `getUpkeepCost(tier)`: `{ 1: 3, 2: 6, 3: 12 }`.
- Capacity: T1=10, T2=25, T3=50.

### 5.3 `MonitoringCapability`

**Location:** `src/capabilities/monitoring/monitoring-capability.ts`
**Phase:** `OBSERVE`
**Capability ID:** `"monitoring"`

**Behavior:**
- `canHandle()`: returns `true`.
- `process(request, context)`: returns `PASS` with a single no-op event
  that the OBSERVE phase will discard (per pipeline spec, OBSERVE phase
  return values are not used for primary outcome). Increments an internal
  per-capability request counter.
- `getUpkeepCost(tier)`: `{ 1: 1, 2: 3, 3: 5 }`.
- Stage 3a purpose: exist so every component registry entry can declare
  an OBSERVE-phase capability. Real metric capture is deferred — the
  engine-level `metricsHistory` already collects what the tests need.

## 6. Component registry entries

All four entries register via `registerTDDefaults()` with Tier 1 defaults,
unused `upgradeCostCurve`, and default `conditionProfile`.

### 6.1 `Server`

```
type: "server"
capabilities (in order):
  - { id: "processing",  defaultTier: 1, maxTier: 3 }   // PROCESS
  - { id: "monitoring",  defaultTier: 1, maxTier: 2 }   // OBSERVE
ports:
  - { direction: "ingress", dataType: "http", capacity: 1 }
  - { direction: "egress",  dataType: "data", capacity: 2 }
placementCost: 100
upgradeCostCurve: [100, 200, 400]
```

Cut from the design-doc spec: `RetryCapability`, `AutoScaleCapability`.
Both deferred past Stage 3a.

### 6.2 `Database`

```
type: "database"
capabilities:
  - { id: "storage",     defaultTier: 1, maxTier: 3 }   // PROCESS
  - { id: "monitoring",  defaultTier: 1, maxTier: 2 }   // OBSERVE
ports:
  - { direction: "ingress", dataType: "data", capacity: 3 }
  - { direction: "egress",  dataType: "data", capacity: 2 }
placementCost: 200
upgradeCostCurve: [200, 400, 800]
```

Cut: `SearchCapability`, `ReplicationCapability`, `ShardingCapability`,
`QueryCapability`.

### 6.3 `Cache`

```
type: "cache"
capabilities:
  - { id: "caching",     defaultTier: 1, maxTier: 3 }   // INTERCEPT
  - { id: "monitoring",  defaultTier: 1, maxTier: 2 }   // OBSERVE
ports:
  - { direction: "ingress", dataType: "http", capacity: 2 }
  - { direction: "egress",  dataType: "http", capacity: 1 }
placementCost: 150
upgradeCostCurve: [150, 300, 600]
```

**Port dataType note.** Cache uses `"http"` on both sides in Stage 3a
because the rescue topology places it between the entry point and the
Server (both http-typed). The design-doc spec uses `"data"` on the
assumption that Cache sits between Server and Database — that's a
different architectural pattern (response cache vs. query cache) and
both have real-world precedent. Stage 3a uses the entry-point-side
pattern because it makes the Wave 3 rescue arithmetic work: the cache
INTERCEPTs before Server's `ProcessingCapability` consumes throughput.
A later stage can add a second Cache variant (or a dataType: "any"
configuration) if we want to model query caches too.

### 6.4 `LoadBalancer`

```
type: "load_balancer"
capabilities:
  - { id: "routing",     defaultTier: 1, maxTier: 3 }   // INTERCEPT, EngineConsultable
  - { id: "monitoring",  defaultTier: 1, maxTier: 2 }   // OBSERVE
ports:
  - { direction: "ingress", dataType: "http", capacity: 1 }
  - { direction: "egress",  dataType: "http", capacity: 4 }
placementCost: 175
upgradeCostCurve: [175, 350, 700]
```

Cut: `SSLTerminationCapability`, `CompressionCapability`, `FilterCapability`,
`RateLimitCapability`, `HealthCheckCapability`.

### 6.5 Registry bootstrap

`src/modes/td/register-td-defaults.ts` exports a single function:

```ts
export function registerTDDefaults(
  capRegistry: CapabilityRegistry,
  compRegistry: ComponentRegistry,
): void {
  capRegistry.register({ id: "processing" as CapabilityId, factory: () => new ProcessingCapability(...) });
  capRegistry.register({ id: "routing"    as CapabilityId, factory: () => new RoutingCapability(...) });
  capRegistry.register({ id: "storage"    as CapabilityId, factory: () => new StorageCapability() });
  capRegistry.register({ id: "caching"    as CapabilityId, factory: () => new CachingCapability() });
  capRegistry.register({ id: "monitoring" as CapabilityId, factory: () => new MonitoringCapability() });

  compRegistry.register(SERVER_ENTRY);
  compRegistry.register(DATABASE_ENTRY);
  compRegistry.register(CACHE_ENTRY);
  compRegistry.register(LOAD_BALANCER_ENTRY);
  compRegistry.validate();
}
```

The existing `ProcessingCapability` and `RoutingCapability` constructors
take configuration arguments; the exact factory closure arguments get
decided during implementation. The registry's `validate()` call will
catch any mismatch between component capability references and registered
capability IDs.

## 7. TD mode stack

### 7.1 `TDEconomy`

Implements `EconomyStrategy` from `src/core/mode/economy-strategy.ts`.

**Constructor:** `new TDEconomy({ startingBudget, revenuePerRequestType })`
where `revenuePerRequestType: ReadonlyMap<string, number>`.

**Methods:**
- `getBudget()`: returns current budget (number state, mutated on credit/debit).
- `canAfford(cost)`: returns `budget >= cost`.
- `creditRevenue(request)`: returns `revenuePerRequestType.get(request.type) ?? 0`
  and adds it to budget. Stage 3a revenue table:
  `{ "api_read": 1, "api_write": 2 }`.
- `debitUpkeep(totalUpkeep)`: subtracts from budget (can go negative —
  insolvency is reported by the wave-end assertion, not enforced mid-wave).
- `debitPlacement(component)`: subtracts `component.placementCost`.
- `debitUpgrade(component, capabilityId)`: no-op. Upgrades not exercised
  in Stage 3a.
- `resolveInsolvency(state)`: returns `[]`. Stage 3a does not kill
  components mid-wave.

### 7.2 `TDTrafficSource`

Implements `TrafficSource` from `src/core/mode/traffic-source.ts`.

**Constructor:** `new TDTrafficSource({ wave, targetEntryPointId, rng })`
where `wave: TDWaveDefinition` and `rng` is the simulation RNG.

**Generation:** at each tick during the wave's `duration`, generate
`wave.intensity` requests. Each request's `type` is sampled from
`wave.composition` (weighted by the composition map) using `rng`. TTL is
`wave.ttl`. `originZone: null`, `streamDuration: null`,
`streamBandwidth: null`, `parentId: null`.

Replaces the hardcoded `ttl: 10` from `FixedIntensityTrafficSource` with
`wave.ttl` — per-wave TTL is a required tuning dial for Wave 3.

### 7.3 `TDModeController`

Implements `ModeController`, modeled on `SandboxModeController`.

**Constructor:**
`new TDModeController({ wave, capRegistry, compRegistry, economy, rng })`.

**Methods:**
- `economy`: returns the injected `TDEconomy`.
- `getActiveCapabilities(component)`: returns the full set of capability
  IDs on the component — no gating in Stage 3a.
- `getTierCap(component, capabilityId)`: returns `1` for every capability.
- `getBuildConstraints()`: returns
  `{ availableComponentTypes: wave.availableComponents, maxComponents: wave.maxComponents ?? Infinity }`.
- `getTrafficSource()`: returns the `TDTrafficSource` constructed for the
  injected wave.
- `evaluateOutcome(metrics)`: walks the tick metrics array, sums dropped
  and timed-out request counts, computes drop rate as
  `(dropped + timedOut) / totalGenerated`, reads final budget from the
  last tick's snapshot, returns
  `{ passed: budget > 0 && dropRate < wave.dropThreshold, budget, dropRate, totalRequests }`.
- `tryPlace(state, type, position, zone)`: delegates to `compRegistry`,
  enforces `availableComponentTypes`, debits `economy.debitPlacement()`.
  Mirrors `SandboxModeController.tryPlace`.
- `tryUpgrade(state, componentId, capabilityId)`: delegates to component's
  `upgrade()` method. Stage 3a tests do not call this but the
  implementation is required for interface conformance.
- `getScheduledChaos(currentTick)`: returns `[]`.
- `getInitialZoneTopology()`: returns a single default zone (same shape
  `SandboxModeController` uses when no zones are configured).
- `getPhase()` / `advancePhase()`: build → simulate → assess state machine,
  mirrored from sandbox.

### 7.4 `TDWaveDefinition` and wave constants

`src/modes/td/td-waves.ts` exports:

```ts
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
  readonly maxComponents?: number;
}

export const WAVE_1: TDWaveDefinition = { /* see §8 */ };
export const WAVE_2: TDWaveDefinition = { /* see §8 */ };
export const WAVE_3: TDWaveDefinition = { /* see §8 */ };
```

Specific numeric values are tuned during implementation (§8 captures the
targets, not the final numbers — see the tuning loop in §10).

## 8. Wave definitions (targets)

These targets drive the integration tests. Implementation-time tuning
may shift the numbers — the constraint is the shape of the outcomes
(pass/fail on specific topologies), not the exact dials.

### Wave 1: "Launch Day"
- **Intensity:** ~10 req/tick
- **Composition:** `{ "api_read": 1.0 }`
- **Duration:** ~30 ticks
- **TTL:** ~10
- **Available components:** `["server", "database"]`
- **Drop threshold:** 0.05
- **Starting budget:** generous (≥ 500)
- **Expected outcome:** trivial topology (single Server) passes cleanly.

### Wave 2: "Users Start Signing Up"
- **Intensity:** ~25 req/tick
- **Composition:** `{ "api_read": 0.7, "api_write": 0.3 }`
- **Duration:** ~30 ticks
- **TTL:** ~10
- **Available components:** `["server", "database"]`
- **Drop threshold:** 0.05
- **Starting budget:** ~500
- **Expected outcome:** Server→Database topology passes. Lone Server
  (no Database) fails because writes drop.

### Wave 3: "Traffic Spikes"
- **Intensity:** ~50 req/tick (5× Wave 1, 2× Wave 2)
- **Composition:** `{ "api_read": 0.7, "api_write": 0.3 }`
- **Duration:** ~30 ticks
- **TTL:** ~8 (tighter than earlier waves)
- **Available components:** `["server", "database", "cache", "load_balancer"]`
- **Drop threshold:** 0.05
- **Starting budget:** ~600
- **Expected outcomes:**
  - Server+Database (lone-server topology): **fails**
  - Server+Cache+Database: **passes**
  - LoadBalancer+[Server,Server]+Database: **passes**

## 9. Integration tests

Four test files in `tests/integration/td/`. All construct their topology
via `TDModeController.tryPlace()`, run `engine.tick(modeController)` for
`wave.duration` ticks, and read `evaluateOutcome(state.metricsHistory)`.

### 9.1 `wave-1-launch-day.test.ts`

- **Topology:** Entry point → Server → Database. (Database is placed but
  receives no writes in Wave 1; keeping it simplifies the Wave 2 test.)
- **Assertion:** `outcome.passed === true`, `outcome.dropRate === 0`,
  `outcome.budget > 0`.
- **Purpose:** smoke test. Proves the full mode stack boots, the registry
  creates components, the engine ticks, and a trivial topology survives.

### 9.2 `wave-2-signups.test.ts`

- **Topology:** Entry point → Server → Database.
- **Assertion:** `outcome.passed === true`, `outcome.dropRate < 0.05`.
  Plus: walk `metricsHistory` to confirm the Database processed a non-zero
  number of `api_write` requests (proves PROCESS-phase `canHandle()`
  routing works — Server's `ProcessingCapability` doesn't claim writes,
  the request forwards to the Database).
- **Purpose:** proves `StorageCapability` and the read/write split.

### 9.3 `wave-3-traffic-spike.test.ts`

- **Topology:** Entry point → Server → Database (identical to Wave 2).
- **Assertion:** `outcome.passed === false`. Either `dropRate >= 0.05` or
  budget ≤ 0 (most likely the former).
- **Purpose:** proves the lone-server topology collapses under Wave 3
  load. If this test passes when it shouldn't, the wave is mistuned or
  the engine's throughput numbers are too generous.

### 9.4 `wave-3-learning-arc.test.ts`

Three sub-tests using the same `WAVE_3` definition:

**(a) Lone server fails.** Duplicates 9.3's assertion but with explicit
learning-arc framing in the test name. Gives the "architectural failure"
its own dedicated test so failures of the rescue tests below aren't
confused with baseline issues.

**(b) Cache rescue passes.**
- **Topology:** Entry point → Cache → Server → Database.
- **Assertion:** `outcome.passed === true`, `outcome.dropRate < 0.05`.
- **Additional assertion:** `metricsHistory` shows cache-hit events > 0
  (proves the cache is actually short-circuiting reads before the
  Server processes them, not incidentally passing due to other tuning).
- **Why Cache sits before Server, not after.** Stage 3a's Server
  RESPONDs to reads directly via `ProcessingCapability`. If Cache sat
  between Server and Database, it would never see the reads — they'd
  be handled upstream. Placing Cache in front of Server means the
  INTERCEPT phase short-circuits reads before any Server throughput is
  consumed, which is exactly the Wave 3 rescue mechanism we want to
  exercise.

**(c) Horizontal-scale rescue passes.**
- **Topology:** Entry point → LoadBalancer → [Server1, Server2] → Database.
- **Assertion:** `outcome.passed === true`, `outcome.dropRate < 0.05`.
- **Additional assertion:** both Server1 and Server2 processed non-zero
  request counts via `metricsHistory` per-component snapshots (proves
  `RoutingCapability` distributed load).

Both rescues must pass. The test file is the exit criterion for Stage 3a:
if one rescue works and the other doesn't, Stage 3a is not done.

## 10. Design notes and known shortcuts

### 10.1 CachingCapability cache-on-miss shortcut

On a cache miss, `CachingCapability.process()` inserts the key
immediately before returning `PASS`. This is observationally incorrect —
you're caching a response that doesn't exist yet — but fine in Stage 3a
because all `api_read` requests return the same trivial response.
Subsequent identical reads hit the cache, which is the tested behavior.

A correct cache needs one of:
- **Engine-level write-back hook:** after a terminal `RESPOND` from the
  PROCESS phase, re-enter the INTERCEPT phase on the return path so the
  cache can store the real response. Requires engine changes.
- **Per-key miss tracking:** the cache remembers "we asked for this, still
  waiting" and populates on the next matching response. Requires
  request-correlation the engine doesn't currently support.

Both are deferred. The Stage 3a cache is a "request pattern recognizer"
rather than a real cache, and that's fine — it's enough to prove the
INTERCEPT-phase short-circuit works and to exercise the "cache reduces
backend load" signal in the integration test.

### 10.2 MonitoringCapability is ceremonial

The capability does nothing in Stage 3a beyond exist at the OBSERVE phase.
The engine's existing `metricsHistory` collection — already in place from
Stage 2a/2b — provides every number the integration tests need. Real
per-component metric emission via OBSERVE-phase events is a later stage.
The capability exists now so component registry entries can declare an
OBSERVE-phase capability without the pipeline crashing on an empty
OBSERVE phase (which it doesn't, strictly, but future stages will assume
every component has at least one OBSERVE capability and this starts
that convention).

### 10.3 No wave-gated capability unlocks

`TDModeController.getActiveCapabilities()` returns every capability on
the component regardless of wave. The design doc calls for gated unlocks
(e.g., "`ReplicationCapability` is wave-4+ only") but Stage 3a has no
capability that needs gating — all 5 registered capabilities are always
active. Gating becomes meaningful in Stage 3b when more capabilities
land. The `TDModeController` interface supports gating; the Stage 3a
implementation just doesn't use it.

### 10.4 Wave 3 tuning is the load-bearing work

The Wave 3 integration tests depend on a single set of numbers satisfying
three simultaneous constraints:

1. Server+Database alone **fails** Wave 3 (drop rate ≥ 5% or budget ≤ 0)
2. Server+Cache+Database **passes** Wave 3
3. LoadBalancer+[Server,Server]+Database **passes** Wave 3

If the tuning space is empty (e.g., the throughput numbers from Stage 2a
make a single Server impossibly powerful, or Connection bandwidth is too
loose), Slice C stalls. Mitigation: if needed, vary `dropThreshold` or
`startingBudget` per topology in the test fixtures — document as a
Stage 3a limitation and move on. A uniform threshold is preferred but
not required.

## 11. Slice sequencing

Three worktree slices, each ending in a green integration test.

**Slice A — "Wave 1 headless".** Production `ProcessingCapability`
rewrite (with test migration), skeletons for all TD mode classes,
`MonitoringCapability`, `Server` registry entry, `WAVE_1`, integration
test. Slightly larger than it looked pre-review because the
`ProcessingCapability` rewrite touches existing tests. ~7–9 TDD tasks.

**Slice B — "Wave 2 passes".** `StorageCapability`, `Database` registry
entry, `WAVE_2`, integration test. Tunes Wave 2 economy until Server+DB
passes cleanly. ~4–5 TDD tasks.

**Slice C — "Wave 3 learning arc".** `CachingCapability`, `Cache` and
`LoadBalancer` registry entries, `WAVE_3`, both wave-3 integration test
files. Load-bearing tuning step. ~6–8 TDD tasks.

Total: ~17–22 TDD tasks across three slices. Slightly larger than the
pre-review ~15–19 estimate because of the `ProcessingCapability` rewrite
scope correction. Still within an order of magnitude of Stage 2b
(16 tasks) as a sanity check. Each slice merges to `main` before the
next starts.

## 12. Exit criteria

Stage 3a is complete when all of the following are true:

1. `pnpm test` passes (all existing tests plus the four new integration
   files).
2. `pnpm typecheck` is clean.
3. `registerTDDefaults()` populates both registries and `.validate()`
   passes.
4. The four Stage 3a integration tests all assert the intended outcomes:
   - Wave 1: trivial topology passes
   - Wave 2: Server+Database passes
   - Wave 3 lone-server: fails
   - Wave 3 cache-rescue: passes
   - Wave 3 LB-rescue: passes
5. No files under `src/core/` are modified by Stage 3a. (Engine is
   unchanged. Registry classes are unchanged. Mode interfaces are
   unchanged.)

## 13. Risk register

1. **Wave 3 tuning fragility (high impact, medium likelihood).** Three
   constraints, one set of dials. If unsatisfiable, accept per-topology
   threshold variation or tighten Stage 2a throughput as a follow-up.
2. **CachingCapability semantic hole (low impact in 3a, deferred fix).**
   Known and documented in §10.1. Becomes a real problem only when Stage
   3b introduces heterogeneous read payloads.
3. **MonitoringCapability is a no-op (no impact in 3a).** Known,
   documented, intentional. Real implementation comes when a later stage
   needs per-component metric streams.
4. **TDModeController drift from SandboxModeController (low likelihood).**
   The two implementations share no code but cover the same interface.
   If `ModeController` grows a new method during Stage 3a, both
   implementations need updating. Mitigation: if `ModeController`
   changes, update both in the same commit.

## 14. Open questions for review

None. This spec was brainstormed interactively and all decision points
were resolved before writing. If the review surfaces issues, they become
spec revisions before the implementation plan lands.

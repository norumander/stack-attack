# Stage 3a — Wave 1–3 Playable Slice (Design)

**Status:** Design — revised 2026-04-12 post cold-audit (two independent audit passes surfaced seven blockers against the initial draft, fixed in §5–§9 below)
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
   implementation, and ship four new production capabilities —
   `ForwardingCapability`, `StorageCapability`, `CachingCapability`,
   `MonitoringCapability`. All implement the standard `Capability`
   interface with no engine sub-interfaces. Every PROCESS-phase
   capability in this set declares `getThroughputPerTick(tier)` so
   `componentThroughputPerTick` returns a bounded number (required for
   Wave 3's lone-server failure mode — without it the engine cap is
   `Infinity` and a single Server absorbs all traffic).
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

The engine is unchanged. All five capabilities (one rewrite, four new)
are pure pipeline capabilities. The registry interfaces are unchanged.
No new engine sub-interfaces, no new tick steps, no new event types.

**Critical engine-behavior facts this spec respects** (discovered in cold
audit — the first draft of this spec misread all four):

1. **`deliverStaged` drops `PASS` silently.** `src/core/engine/deliver-staged.ts`
   has `default: return false` for any outcome that isn't `RESPOND`,
   `FORWARD`, `DROP`, or `QUEUE_HOLD`. A component whose PROCESS phase
   produces `PASS` (because no capability's `canHandle` matched) emits no
   event, triggers no cascade, and is silently dropped from the queue.
   This means **"let the request fall through to the egress connection"
   is not a primitive** — to forward a request, some capability must
   return `{ kind: "FORWARD" }`. That's why this spec introduces
   `ForwardingCapability` rather than relying on pipeline fall-through.

2. **`componentThroughputPerTick` returns `Infinity` if any PROCESS
   capability omits `getThroughputPerTick`.** `src/core/engine/throughput.ts`
   iterates all PROCESS caps, sums their throughput, and falls back to
   `Infinity` on the first missing method. The existing Stage 1
   `ProcessingCapability` does not implement it — which is why the Stage
   1 test harness can't exercise throughput-limited backpressure. Every
   production PROCESS capability this spec ships declares the method.

3. **`OutcomeReport` is `{ verdict, score: {cost,performance,reliability,composite}, notes }`,
   not a flat pass/fail shape.** `src/core/types/outcome.ts`. The first
   draft of this spec invented a different shape; the real interface
   must be honored.

4. **`TickMetrics.perComponent` has counts only — no event-type or
   per-request-type breakdown.** `src/core/types/metrics.ts`. Assertions
   like "cache-hit events > 0" or "Database processed api_writes" must
   read `state.requestLog: Map<RequestId, RequestEvent[]>` (the real
   per-request event history), not `metricsHistory`.

5. **`SandboxModeController.tryPlace` is a stub** — increments a counter,
   returns a fake ID, never calls `compRegistry.create()` or places into
   state. It exists only for interface conformance. Integration tests
   that need to build topology do not use `tryPlace` — they construct
   `Component` and `Connection` instances directly via harness fixtures
   (`new Component({...})`, `makeConnection(...)`), as every existing
   integration test under `tests/integration/` does. `TDModeController.tryPlace`
   follows the same stub pattern. Topology assembly is a test-harness
   concern, not a mode-controller concern, in Stage 3a.

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

All five capabilities implement `Capability` from
`src/core/capability/capability.ts`. None implement `EngineConsultable`,
`EngineBufferable`, `EnginePullable`, or `InstanceDirectory`.

**Throughput model.** Every PROCESS-phase capability in this set declares
`getThroughputPerTick(tier)`. The engine's `componentThroughputPerTick`
sums these across all PROCESS capabilities on a component, which means a
component's total per-tick request budget is the sum of its PROCESS
capabilities' caps. A `Server` with `ProcessingCapability` (handles
reads) + `ForwardingCapability` (handles writes) has its budget split
between the two capabilities' contributions.

### 5.0 `ProcessingCapability` (stub → production rewrite)

**Location:** `src/capabilities/processing/processing-capability.ts`
(existing file, replaced)
**Phase:** `PROCESS`
**Capability ID:** `"processing"`

**Why this isn't just a new capability.** The current implementation is a
Stage 1 test stub with a `ProcessingCapabilityOptions` config that forces
a single `outcomeKind`, a `canHandle` that returns `true` unconditionally,
no throughput cap, and a source comment saying "Removed when the real
capability lands in a later stage." Stage 3a is that stage. The
replacement keeps the class name and file location so existing tests
that reference `new ProcessingCapability(...)` migrate with mechanical
changes rather than full rewrites. The Stage 1 `outcomeKind: "FORWARD"`
code path is gone — tests that need pure forwarding migrate to
`ForwardingCapability` (§5.0.5).

**Behavior:**
- `canHandle(requestType)`: returns `true` for `"api_read"` only. Every
  other request type returns `false`. This is the read half of the
  Server's read/write split.
- `process(request, context)`: returns `{ kind: "RESPOND" }` with a
  tier-dependent latency bonus (T1: +1 tick via an event's
  `latencyAdded`). Emits one `PROCESSED` event.
- `getThroughputPerTick(tier)`: `{ 1: 20, 2: 35, 3: 60 }[tier] ?? 20`.
  T1 default of ~20 is a starting point for Slice C tuning; the Wave 3
  lone-server failure-mode math depends on this landing somewhere
  that forces a meaningful drop rate at 50 req/tick — numbers are
  tuned during implementation.
- `getUpkeepCost(tier)`: `{ 1: 2, 2: 5, 3: 10 }[tier] ?? 2`.
- Operational state: `{ processedCount: number }`.

### 5.0.5 `ForwardingCapability` (new)

**Location:** `src/capabilities/forwarding/forwarding-capability.ts`
**Phase:** `PROCESS`
**Capability ID:** `"forwarding"`

**Why this capability exists.** The engine does not auto-forward requests
that a component can't handle — `deliverStaged` drops `PASS` silently
(see §2 engine fact #1). The only way to move a request out of a
component via an egress connection is for some capability to return a
`FORWARD` outcome. For a `LoadBalancer` (all traffic), a `Cache` on
miss (reads), or a `Server` on a write, no existing capability produces
that outcome — all of `ProcessingCapability`, `StorageCapability`,
`CachingCapability`, `RoutingCapability`, `MonitoringCapability` have
non-forwarding roles. `ForwardingCapability` is the primitive: a PROCESS
capability configured with a set of request types it accepts, returning
`{ kind: "FORWARD" }` for any matching request. The engine then consults
`RoutingCapability` (if present, via the existing `EngineConsultable`
path) or falls back to round-robin to pick the egress connection.

**Behavior:**
- **Constructor:** `new ForwardingCapability(id, { handledTypes: readonly string[] })`.
  The `handledTypes` set is fixed per instance; different components
  instantiate it with different sets. `Server` uses
  `handledTypes: ["api_write"]`. `Cache` uses `["api_read"]` (for
  misses — the `CachingCapability` INTERCEPT will have short-circuited
  hits before this ever runs). `LoadBalancer` uses `["api_read", "api_write"]`.
- `canHandle(requestType)`: returns `handledTypes.includes(requestType)`.
- `process(request, context)`: returns
  `{ outcome: { kind: "FORWARD" }, sideEffects: [], events: [{ type: "FORWARDED", ... }] }`.
  Emits one `FORWARDED` event.
- `getThroughputPerTick(tier)`: `{ 1: 40, 2: 80, 3: 160 }[tier] ?? 40`.
  Forwarding is cheap — higher cap than computation. For a Server with
  `ProcessingCapability` T1 (~20) + `ForwardingCapability` T1 (~40),
  total budget is ~60/tick. Wave 3's 50 req/tick (35 read + 15 write)
  fits within budget *per capability category*: the 15 writes fit in
  the 40-write-capacity, the 35 reads barely exceed the 20-read-capacity
  — forcing drops on reads. This is the intended Wave 3 lone-server
  failure mode.
- `getUpkeepCost(tier)`: `{ 1: 1, 2: 2, 3: 4 }[tier] ?? 1`.
- No operational state (or a trivial forward counter if needed for
  `getStats`).

**Throughput-sharing note.** Because `componentThroughputPerTick` sums
all PROCESS capabilities' throughputs into a single budget, the
per-capability cap is not strictly enforced at the engine level — a
component with Processing(20) + Forwarding(40) can in principle process
60 requests of any mix per tick. The engine doesn't know which capability
would have handled a given request until it runs `process-pending`, and
at that point the budget is already claimed from the aggregate. In
practice, for the Stage 3a topologies, the per-request `canHandle`
filter means capability selection happens before the budget is
consumed, and the engine's fixed-point loop naturally surfaces the
right failures. If Wave 3 tuning reveals this aggregation is too
generous, we tune `getThroughputPerTick` down or split the throughput
budget implementation into per-capability accounting as a Stage 3b
follow-up.

### 5.1 `StorageCapability`

**Location:** `src/capabilities/storage/storage-capability.ts`
**Phase:** `PROCESS`
**Capability ID:** `"storage"` (cast to `CapabilityId`)

**Behavior:**
- `canHandle(requestType)`: returns `true` for `"api_write"` only.
  Reads are handled at the Server by `ProcessingCapability`, so the
  Database never receives reads in Stage 3a topologies.
- `process(request, context)`: returns `{ kind: "RESPOND" }` with a
  tier-dependent latency bonus (T1: +2 ticks). Emits one `PROCESSED`
  event. Increments internal write counter for `getStats()`.
- `getThroughputPerTick(tier)`: `{ 1: 25, 2: 45, 3: 80 }[tier] ?? 25`.
  Must exceed Wave 2's write load (~7-8 req/tick at 25 req/tick × 0.3)
  and Wave 3's write load (~15 req/tick at 50 × 0.3) by a healthy
  margin — the Database is not supposed to be the Wave 3 bottleneck.
  Numbers tuned during Slice B/C.
- `getUpkeepCost(tier)`: `{ 1: 4, 2: 8, 3: 16 }[tier] ?? 4`.
- Operational state: `{ writeCount: number }`. Read by `getStats()`,
  never by the engine.
- No cache, no replication, no sharding — those are separate capabilities
  in other stages. Stage 3a's `StorageCapability` is "does the write, adds
  latency, costs upkeep, bounds throughput."

### 5.2 `CachingCapability`

**Location:** `src/capabilities/caching/caching-capability.ts`
**Phase:** `INTERCEPT`
**Capability ID:** `"caching"`

**Behavior:**
- Internal state: `Map<string, { tick: number }>` where the key is the
  stringified `request.payload`. Fixed-capacity (T1: 10 entries) with
  FIFO eviction when full. Requires `request.payload` to be a
  distinguishable value — see §7.2 for how `TDTrafficSource` generates
  a small pool of payload keys so the cache exercises a realistic
  working set rather than a degenerate single-bucket hit rate.
- `canHandle()`: returns `true` (INTERCEPT capabilities always do).
- `process(request, context)`:
  - If `request.type !== "api_read"`: return `{ kind: "PASS" }`. Writes
    and other types continue to the component's PROCESS phase, where
    `ForwardingCapability` (configured for writes if present) emits the
    `FORWARD` outcome. In the Stage 3a Cache topology, the Cache
    component has no write handler — writes never reach the Cache
    because topology routes writes directly from Server to Database
    without passing through the Cache.
  - If the key is present in the map: return
    `{ kind: "RESPOND" }` with a `CACHED_HIT` event and
    `latencyAdded: 0`. This short-circuits the INTERCEPT phase and
    resolves the request at the Cache.
  - If the key is absent: insert the key into the map (the cache-on-miss
    shortcut — see §10.1), return `{ kind: "PASS" }`. The component's
    PROCESS phase then runs `ForwardingCapability` (which is registered
    on the Cache for `api_read`), which emits `FORWARD` and the engine
    delivers to the egress connection (→ Server → Database in the
    rescue topology).
- `getUpkeepCost(tier)`: `{ 1: 3, 2: 6, 3: 12 }[tier] ?? 3`.
- No `getThroughputPerTick` — `CachingCapability` is INTERCEPT phase,
  not PROCESS, so it does not contribute to the component's throughput
  budget. The Cache component's throughput budget comes from its
  `ForwardingCapability` (see §6.3).
- Capacity: T1=10 entries, T2=25, T3=50.

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
  - { id: "processing",  defaultTier: 1, maxTier: 3 }   // PROCESS, handles api_read
  - { id: "forwarding",  defaultTier: 1, maxTier: 3 }   // PROCESS, handles api_write (constructed with handledTypes: ["api_write"])
  - { id: "monitoring",  defaultTier: 1, maxTier: 2 }   // OBSERVE
ports:
  - { direction: "ingress", dataType: "http", capacity: 1 }
  - { direction: "egress",  dataType: "data", capacity: 2 }
placementCost: 100
upgradeCostCurve: [100, 200, 400]
```

The Server has two PROCESS capabilities that partition by request type.
`ProcessingCapability` runs for reads (RESPOND), `ForwardingCapability`
runs for writes (FORWARD to egress — Database). The component's pipeline
picks the one whose `canHandle` matches, and the two sets are disjoint,
so only one ever runs per request.

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
  - { id: "caching",     defaultTier: 1, maxTier: 3 }   // INTERCEPT, hit=RESPOND, miss=PASS
  - { id: "forwarding",  defaultTier: 1, maxTier: 3 }   // PROCESS, handles api_read (constructed with handledTypes: ["api_read"])
  - { id: "monitoring",  defaultTier: 1, maxTier: 2 }   // OBSERVE
ports:
  - { direction: "ingress", dataType: "http", capacity: 2 }
  - { direction: "egress",  dataType: "http", capacity: 1 }
placementCost: 150
upgradeCostCurve: [150, 300, 600]
```

On a read: `CachingCapability` INTERCEPT runs first. Hit → RESPOND,
pipeline short-circuits. Miss → PASS, pipeline continues to PROCESS,
`ForwardingCapability` matches `api_read` and emits FORWARD to the
egress connection (→ Server → Database in the Wave 3 rescue topology).
Writes never reach a Cache in the Stage 3a rescue topologies — writes
route Server → Database directly. `Port.dataType` is declarative only
(the engine never reads it — confirmed via audit), so the `"http"`
labeling on Cache ports is cosmetic; pick whichever reads cleanest.

### 6.4 `LoadBalancer`

```
type: "load_balancer"
capabilities:
  - { id: "routing",     defaultTier: 1, maxTier: 3 }   // INTERCEPT, EngineConsultable (canHandle: false — engine consults via sub-interface)
  - { id: "forwarding",  defaultTier: 1, maxTier: 3 }   // PROCESS, handles all types (constructed with handledTypes: ["api_read", "api_write"])
  - { id: "monitoring",  defaultTier: 1, maxTier: 2 }   // OBSERVE
ports:
  - { direction: "ingress", dataType: "http", capacity: 1 }
  - { direction: "egress",  dataType: "http", capacity: 4 }
placementCost: 175
upgradeCostCurve: [175, 350, 700]
```

`RoutingCapability.canHandle` returns `false` (confirmed in the existing
implementation), so it never runs in the pipeline — it's consulted by
`selectEgressConnection` via the `EngineConsultable` sub-interface
during the FORWARD delivery step. The `ForwardingCapability` is what
produces the FORWARD outcome that invokes `selectEgressConnection` in
the first place. Without `ForwardingCapability`, `RoutingCapability`
would never fire because no outcome would ever reach the FORWARD branch
of `deliverStaged`.

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
  capRegistry.register({ id: "forwarding" as CapabilityId, factory: () => new ForwardingCapability(...) });
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

**Factory note for `ForwardingCapability`.** The registry's factory
signature is `() => Capability` — zero arguments — but `ForwardingCapability`
needs per-component `handledTypes`. The registry factory constructs a
"default" Forwarding instance (e.g., `handledTypes: ["api_read", "api_write"]`
accepting everything), and each component registry entry's
`capabilities` array references it by ID. If multiple components need
different `handledTypes` configurations, one option is multiple registry
entries (`"forwarding-reads"`, `"forwarding-writes"`, `"forwarding-all"`)
each with a distinct factory. Simpler option for Stage 3a: register a
single `"forwarding"` factory that returns a "forwards everything"
instance, and let the `canHandle` filtering happen in the pipeline —
the aggregation is harmless for Stage 3a since `canHandle` correctness
is enforced elsewhere (Server's ProcessingCapability claims reads,
so a Server's ForwardingCapability would never run on a read even if
it said it could). Resolved during Slice A implementation — flag for
the plan.

The existing `ProcessingCapability` and `RoutingCapability` constructors
take configuration arguments; the exact factory closure arguments get
decided during implementation. The registry's `validate()` call will
catch any mismatch between component capability references and registered
capability IDs.

## 7. TD mode stack

### 7.1 `TDEconomy`

Implements `EconomyStrategy` from `src/core/mode/economy-strategy.ts`.

**Honest framing:** `TDEconomy` in Stage 3a is largely ceremonial. A
back-of-envelope sanity check on the Wave 3 numbers (50 req/tick × 30
ticks × mixed revenue ~1.3/req = ~1950 gross revenue; lone-server upkeep
~240 over 30 ticks + 300 placement = ~540 costs; starting budget ~600)
shows the economy has ~2010 headroom at 0% drops. Even with dropped
revenue, the economy is not a meaningful pass/fail axis at Stage 3a
traffic levels. The integration tests use `dropRate < threshold` as the
primary pass signal and treat `budget >= 0` as a soft secondary check.
`TDEconomy` exists because `ModeController` requires an `EconomyStrategy`
and because we want the interface in place for later stages when budget
pressure becomes real (Wave 4+ with CDN capital expenses, Wave 5+ with
authentication overhead, etc.). Ship it, wire it, but don't expect it
to fail tests.

**Constructor:** `new TDEconomy({ startingBudget, revenuePerRequestType })`
where `revenuePerRequestType: ReadonlyMap<string, number>`.

**Methods:**
- `getBudget()`: returns current budget.
- `canAfford(cost)`: returns `budget >= cost`.
- `creditRevenue(request)`: returns `revenuePerRequestType.get(request.type) ?? 0`
  and adds it to budget. Stage 3a revenue table:
  `{ "api_read": 1, "api_write": 2 }`.
- `debitUpkeep(totalUpkeep)`: subtracts from budget (can go negative —
  wave-end assertion checks final balance, no mid-wave enforcement).
- `debitPlacement(component)`: subtracts `component.placementCost`.
- `debitUpgrade(component, capabilityId)`: no-op. Upgrades not exercised
  in Stage 3a.
- `resolveInsolvency(state)`: returns `[]`. Stage 3a does not kill
  components mid-wave.

### 7.2 `TDTrafficSource`

Implements `TrafficSource` from `src/core/mode/traffic-source.ts`.

**Constructor:** `new TDTrafficSource({ wave, targetEntryPointId, rng, readKeyPoolSize })`
where `wave: TDWaveDefinition`, `rng` is the simulation RNG, and
`readKeyPoolSize` defaults to 20.

**Generation:** at each tick during the wave's `duration`, generate
`wave.intensity` requests. Each request has:
- `id`: unique (per-request counter).
- `parentId`: `null`.
- `type`: sampled from `wave.composition` (weighted) using `rng`.
- `payload`: for `api_read`, a small string like `"read-${n}"` where
  `n` is a deterministic int in `[0, readKeyPoolSize)` sampled via
  `rng`. For `api_write`, `null` (or `"write-${uniqueCounter}"` — writes
  don't touch the cache so the value only matters for debugging).
- `origin`: `targetEntryPointId`.
- `createdAt`: current tick.
- `ttl`: `wave.ttl`.
- `originZone`: `null`.
- `streamDuration`: `null`.
- `streamBandwidth`: `null`.

**Why a `readKeyPoolSize`.** `CachingCapability` (§5.2) stringifies
`request.payload` as the cache key. `SandboxTrafficSource` hardcodes
`payload: null`, which would collapse every `api_read` into a single
bucket. With `null`-payloads, either the cache hits 100% after tick 1
(making the Wave 3 cache-rescue pass trivially and architecturally
meaninglessly) or misses 0% if the key is stored elsewhere. Neither
exercises the learning arc. A pool of 20 distinct keys at Cache T1
capacity of 10 means ~50% hit rate after warmup — a realistic working
set where the cache is doing meaningful but imperfect work. The exact
numbers are tuned in Slice C: pool size and cache capacity together
determine the hit rate, which must sit in a range where Cache-rescue
beats lone-server without reducing Server load to zero.

Replaces the hardcoded `ttl: 10` from `FixedIntensityTrafficSource` with
`wave.ttl` — per-wave TTL is a tuning dial for Wave 3.

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
  `{ availableComponentTypes: wave.availableComponents, maxPlacements: wave.maxPlacements ?? Infinity }`.
  Uses the real field name `maxPlacements` from `BuildConstraints`, not
  the `maxComponents` typo from the first draft.
- `getTrafficSource()`: returns the `TDTrafficSource` constructed for the
  injected wave.
- `evaluateOutcome(metrics)`: returns a proper `OutcomeReport`
  `{ verdict, score: { cost, performance, reliability, composite }, notes }`
  per the interface in `src/core/types/outcome.ts`:
  - Walks `metrics: readonly TickMetrics[]`, summing `requestsDropped`,
    `requestsTimedOut`, `requestsProcessed` across all ticks. Computes
    `dropRate = (dropped + timedOut) / (dropped + timedOut + resolved)`.
    Reads final economy budget (via the injected `TDEconomy.getBudget()`).
  - `verdict`: `"win"` if `dropRate < wave.dropThreshold`, else `"lose"`.
    Budget is *not* part of the verdict at Stage 3a (ceremony — see §7.1).
  - `score.cost`: `budget` (higher = cheaper finish).
  - `score.performance`: `1 - dropRate`.
  - `score.reliability`: `1 - (dropped + timedOut) / totalRequests`
    (equivalent to `score.performance` here but the field exists on the
    interface and we populate it honestly).
  - `score.composite`: `0.4 * performance + 0.4 * reliability + 0.2 * (cost / startingBudget)`.
    Placeholder weights — tuned later when balance matters.
  - `notes`: `[`\`drop rate: X%\`, \`budget: Y\`, \`total requests: Z\``]`.
    Integration tests parse these notes for per-assertion detail. The
    string format is stable within Stage 3a.
- `tryPlace(state, type, position, zone)`: **stub.** Follows the same
  pattern as `SandboxModeController.tryPlace` (which increments a
  counter and returns a fake ID without actually placing). Stage 3a
  integration tests build topology via harness fixtures
  (`new Component({...})`, `makeConnection(...)`) and then inject
  components into `state.components` directly — exactly how every
  existing integration test under `tests/integration/` does it. The
  `ModeController.tryPlace` contract exists for the eventual UI stage
  where placement happens via user input; no Stage 3a test ever calls
  it. The stub returns
  `{ ok: true, componentId: "td-placed-${counter}" as ComponentId }`
  and debits `economy.debitPlacement()` to exercise the economy path
  for any future test that does call `tryPlace`.
- `tryUpgrade(state, componentId, capabilityId)`: matches
  `SandboxModeController.tryUpgrade` shape — delegates to
  `component.upgrade(capabilityId)` if the capability exists, returns
  `{ ok: true, newPlayerTier: ... }` or `{ ok: false, reason: "capability_not_found" }`.
  Stage 3a tests do not call this.
- `getScheduledChaos(currentTick)`: returns `[]`.
- `getInitialZoneTopology()`: returns a single default zone with an
  empty `pairLatency` map (same shape `SandboxModeController` uses when
  no zones are configured).
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
  readonly maxPlacements?: number;   // real BuildConstraints field name
  readonly readKeyPoolSize?: number; // drives TDTrafficSource payload variety
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

Four test files in `tests/integration/td/`. Each test:

1. **Builds topology via harness fixtures**, not `TDModeController.tryPlace`.
   Constructs `Component` instances directly using
   `new Component({...conditionProfile, capabilities, ports, ...})`
   with registry-created capability instances, and wires them with
   `makeConnection` from `tests/harness/fixtures.ts`. Injects components
   into `state.components` and connections into `state.connections`.
   Populates `state.visitOrder` via `computeVisitOrder(state.components)`
   (Stage 2a gotcha: required before any engine step). This is exactly
   how existing `tests/integration/*.test.ts` files construct topology,
   e.g. `condition-routing.test.ts`, `sandbox-backpressure.test.ts`.
2. **Constructs a `TDModeController`** with the relevant wave and
   injects it into `engine.tick(modeController)`.
3. **Runs the engine for `wave.duration` ticks** by calling
   `engine.tick(modeController)` in a loop.
4. **Reads assertions from both `state.metricsHistory` (for rollup counts)
   and `state.requestLog` (for per-request event inspection).** The
   `requestLog` is a `Map<RequestId, RequestEvent[]>` populated by the
   engine and capabilities via `state.appendEvent()`. Tests walk this
   map to count events by type (`CACHED_HIT`, `FORWARDED`, `PROCESSED`)
   and by component ID.
5. **Calls `modeController.evaluateOutcome(state.metricsHistory)`** at
   the end and asserts on the returned `OutcomeReport.verdict`.

A small helper `runWave(mc, engine, state)` lives in
`tests/integration/td/helpers.ts` to encapsulate the tick loop and
produce `{ outcome, totalRequests, cacheHits, processedByComponent }`
from a single run. Each test file then asserts against that struct.

### 9.1 `wave-1-launch-day.test.ts`

- **Topology:** Entry point → Server → Database. (Database is placed but
  receives no requests in Wave 1; Wave 1 is 100% `api_read` and the
  Server's `ProcessingCapability` handles reads directly — reads never
  reach the Database. Keeping Database in the topology simplifies the
  Wave 2 test's topology reuse.)
- **Assertions:**
  - `outcome.verdict === "win"`
  - No `DROPPED` or `TIMED_OUT` events in `state.requestLog`
  - `state.economy.getBudget() >= 0`
- **Purpose:** smoke test. Proves the full mode stack boots, registered
  capabilities instantiate correctly, the engine ticks, and a trivial
  topology survives a benign wave.

### 9.2 `wave-2-signups.test.ts`

- **Topology:** Entry point → Server → Database.
- **Assertions:**
  - `outcome.verdict === "win"`
  - `(droppedCount + timedOutCount) / totalRequests < 0.05`
  - **Write-routing verification** via `state.requestLog`: walk all
    request events, filter to requests whose type is `api_write`, and
    confirm their event history contains a `FORWARDED` event with
    `componentId === serverId` (Server's `ForwardingCapability` emitted
    it) and a `PROCESSED` event with `componentId === databaseId`
    (Database's `StorageCapability` handled it). Both counts should
    be > 0 and approximately equal to the generated write count.
- **Purpose:** proves `StorageCapability`, `ForwardingCapability`, and
  the Server's two-capability read/write split (Processing handles
  reads, Forwarding handles writes).

### 9.3 `wave-3-traffic-spike.test.ts`

- **Topology:** Entry point → Server → Database (identical to Wave 2).
- **Assertion:** `outcome.verdict === "lose"`. `dropRate >= 0.05`
  (failure is driven by drops, not budget — see §7.1).
- **Purpose:** proves the lone-server topology collapses under Wave 3
  load. The collapse mechanism is the Server's bounded throughput
  (`ProcessingCapability.getThroughputPerTick(1) ≈ 20` + `ForwardingCapability.getThroughputPerTick(1) ≈ 40`,
  total ≈ 60/tick, below Wave 3's 50 req/tick effective read-rate
  after the per-capability filter imposes its own pressure — see §10.5
  for the throughput-sharing nuance). If this test passes when it
  shouldn't, Slice C's first action is to tune the per-tier throughput
  numbers down until lone-server actually fails.

### 9.4 `wave-3-learning-arc.test.ts`

Three sub-tests using the same `WAVE_3` definition:

**(a) Lone server fails.** Duplicates 9.3's assertion but with explicit
learning-arc framing in the test name. Gives the "architectural failure"
its own dedicated test so failures of the rescue tests below aren't
confused with baseline issues.

**(b) Cache rescue passes.**
- **Topology:** Entry point → Cache → Server → Database.
- **Assertions:**
  - `outcome.verdict === "win"`
  - `(droppedCount + timedOutCount) / totalRequests < 0.05`
  - **Cache-hit verification** via `state.requestLog`: count
    `CACHED_HIT` events. The count must be > 0 AND a meaningful
    fraction of the read count — ideally the ~50% implied by the
    `readKeyPoolSize: 20` + Cache capacity 10 tuning. If the count is
    100% that means every read is hitting a single bucket and the test
    is not meaningful; if the count is 0%, the cache isn't actually
    working. A range like "between 20% and 80% of reads hit the cache"
    is the Slice C tuning target.
- **Why Cache sits before Server.** Stage 3a's Server RESPONDs to
  reads directly via `ProcessingCapability`. If Cache sat between
  Server and Database, it would never see the reads — they'd be
  handled upstream. Placing Cache in front of Server means the
  INTERCEPT phase short-circuits reads on hits, and the Cache's
  `ForwardingCapability` forwards misses to the Server, which then
  handles them normally.

**(c) Horizontal-scale rescue passes.**
- **Topology:** Entry point → LoadBalancer → [Server1, Server2] → Database.
- **Assertions:**
  - `outcome.verdict === "win"`
  - `(droppedCount + timedOutCount) / totalRequests < 0.05`
  - **Load-distribution verification** via `state.requestLog`: walk all
    request events, count `FORWARDED` events where `componentId ===
    loadBalancerId` grouped by their `connectionId` metadata (which
    egress connection was chosen). Both Server1-destined and
    Server2-destined connections must have non-zero counts, and the
    ratio should be reasonably balanced (Slice C target: each Server
    receives between 30% and 70% of LB-forwarded traffic). This proves
    `RoutingCapability`'s round-robin is actually distributing load,
    not defaulting to one connection.

Both rescues must pass. The test file is the exit criterion for Stage 3a:
if one rescue works and the other doesn't, Stage 3a is not done.

## 10. Design notes and known shortcuts

### 10.0 Why `ForwardingCapability` instead of engine changes

The simplest theoretical fix for "writes at Server don't reach Database"
would be to change `deliverStaged` to treat `PASS` as an implicit
FORWARD when the component has egress connections. This spec rejects
that approach because:

1. **It violates the "one outcome kind per semantic" principle.** `PASS`
   currently means "this capability has nothing to do with this request,
   try the next one" (INTERCEPT fall-through). Making `PASS` also mean
   "forward to egress when no PROCESS capability matched" would conflate
   two distinct pipeline states and introduce subtle bugs the engine's
   current test suite specifically guards against.
2. **The capability-based approach is more explicit and composable.**
   Other stages will need components that don't forward on PASS (e.g.,
   a TrafficSource endpoint, a terminal sink). Making forwarding a
   capability decision rather than a default behavior keeps each
   component's forwarding semantics declarative and visible in the
   registry entry.
3. **It keeps `src/core/engine/` unchanged.** Stage 3a's exit criterion
   §12.5 ("no `src/core/` modifications") stands.
4. **It's aligned with the "capabilities are atomic behaviors"
   principle** from `component-architecture.md` §1.

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

### 10.4 Throughput-sharing nuance

`componentThroughputPerTick` sums all PROCESS capabilities' throughputs
into a single budget. This means a Server with `ProcessingCapability(T1) + ForwardingCapability(T1)`
has a single pooled budget (e.g., 20 + 40 = 60 req/tick at tuned
numbers). The engine's `process-pending` loop pulls up to 60 requests
out of the pending queue per tick and processes them; which capability
actually runs is decided per-request by `canHandle`.

**Consequence for Wave 3 rescue math:** at 50 req/tick (35 reads + 15
writes), a single Server with a 60-req/tick total budget technically
has headroom on aggregate, but `ProcessingCapability`'s narrow
throughput component (~20) combined with the fixed-point loop's
per-component budget accounting creates effective backpressure once
the per-tick budget is exhausted, regardless of which capability would
have handled the excess. In practice, tuning
`getThroughputPerTick` lower on `ProcessingCapability` (e.g., T1: 15)
produces the "lone-server drops reads" signal we want while leaving
enough forwarding budget that writes still route.

If the aggregation turns out to be too generous and we can't tune to
the right regime, Slice C has two escape hatches: (a) make
`ForwardingCapability`'s `getThroughputPerTick` very small (e.g., T1=2)
so the aggregate budget is dominated by `ProcessingCapability`, or
(b) move to per-capability throughput accounting as a Stage 3b change
(touches `src/core/engine/throughput.ts` — breaks the "no `src/core/`
modification" rule but is a known-safe change with focused test
coverage).

### 10.5 Wave 3 tuning is the load-bearing work

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
rewrite (with test migration), new `ForwardingCapability`, new
`MonitoringCapability`, skeletons for all TD mode classes,
`Server` registry entry, `WAVE_1`, integration test helpers
(`runWave`, topology fixtures), `wave-1-launch-day.test.ts`. Largest
slice because `ProcessingCapability` rewrite touches existing tests
and `ForwardingCapability` is the spine of all three later slices.
~9–11 TDD tasks.

**Slice B — "Wave 2 passes".** `StorageCapability`, `Database` registry
entry, `WAVE_2`, integration test. Tunes Wave 2 economy until Server+DB
passes cleanly. ~4–5 TDD tasks.

**Slice C — "Wave 3 learning arc".** `CachingCapability`, `Cache` and
`LoadBalancer` registry entries, `WAVE_3`, both wave-3 integration test
files. Load-bearing tuning step. ~6–8 TDD tasks.

Total: ~19–24 TDD tasks across three slices. Expanded from the
pre-audit ~15–19 because of the `ProcessingCapability` rewrite,
`ForwardingCapability` addition, and outcome-report conformance.
Still comparable to Stage 2b (16 tasks). Each slice merges to `main`
before the next starts.

## 12. Exit criteria

Stage 3a is complete when all of the following are true:

1. `pnpm test` passes (all existing tests plus the four new integration
   files).
2. `pnpm typecheck` is clean.
3. `registerTDDefaults()` populates both registries and
   `CapabilityRegistry.validate()` + `ComponentRegistry.validate()` pass.
4. The four Stage 3a integration tests all assert the intended outcomes:
   - Wave 1: trivial topology wins (`verdict === "win"`)
   - Wave 2: Server+Database wins, with write-routing verified via
     `requestLog` event inspection
   - Wave 3 lone-server: loses (`verdict === "lose"`) due to drop rate
     above threshold
   - Wave 3 cache-rescue: wins, with meaningful cache-hit rate verified
     via `requestLog` `CACHED_HIT` event count
   - Wave 3 LB-rescue: wins, with load distribution verified via
     `requestLog` `FORWARDED` event counts per egress connection
5. **No files under `src/core/engine/` are modified.** This is the real
   invariant. The first draft said "no files under `src/core/`" at all,
   but the Stage 3a analysis may surface small non-engine adjustments
   that are cheaper to land here than to carve out as a separate stage
   (e.g., a minor shape tweak to `BuildConstraints` or `OutcomeReport`
   if the audit discovers a gap). Engine files under `src/core/engine/`
   stay untouched; other `src/core/` subdirectories are touched only
   with explicit justification in the commit message and only if the
   alternative is a core interface hack in `src/modes/td/`.
6. The implementation plan (written after this spec is approved)
   explicitly lists every `ProcessingCapability` test that migrates as
   part of Slice A, and the migration keeps or replaces each one
   cleanly — no silent test deletions.

## 13. Risk register

1. **Per-capability throughput aggregation (high impact, medium
   likelihood).** `componentThroughputPerTick` sums PROCESS cap
   throughputs into a single budget (§10.4). If the tuning space where
   "lone-server fails, cache rescue passes, LB rescue passes" can't be
   hit with aggregated accounting, Slice C must either tune around it
   (e.g., making `ForwardingCapability` throughput trivially small) or
   move to per-capability accounting in `src/core/engine/throughput.ts`.
   The latter touches engine code and breaks exit criterion §12.5 — a
   reason to carve a Stage 3a.5 out. Mitigation: try aggregated tuning
   first, escalate to per-capability only if forced.
2. **Cache hit-rate tuning window (medium impact, medium likelihood).**
   The assertion "20% < cache hit rate < 80%" requires careful tuning of
   `readKeyPoolSize`, Cache T1 capacity, and FIFO eviction against
   Wave 3's read volume and duration. If the window is too narrow,
   determinism-stability is fragile. Mitigation: widen the acceptance
   window in the test (e.g., "10% < hit rate < 90%") during Slice C
   tuning, tightening only after the core tuning stabilizes.
3. **`ProcessingCapability` rewrite breaks existing tests in
   non-obvious ways (medium impact, high likelihood).** ~dozen test
   files reference the Stage 1 stub, including tests that use
   `outcomeKind: "FORWARD"` to build forward-only processors. Slice A
   must inventory every reference, decide per-test whether to migrate
   to `ForwardingCapability` or keep a minimal test helper, and verify
   each migration doesn't change test semantics. Mitigation: Slice A's
   first task is the inventory + migration plan, checked as a
   standalone commit before any new capability work.
4. **`TDModeController` drift from `SandboxModeController` (low impact,
   low likelihood).** Both implement the same interface but share no
   code. If `ModeController` grows a method during Stage 3a, both must
   be updated. Mitigation: co-commit changes.
5. **CachingCapability semantic hole (no 3a impact, deferred fix).**
   Documented in §10.1. Only a problem when Stage 3b introduces
   heterogeneous read payloads with real write-through semantics.
6. **`MonitoringCapability` is a no-op (no 3a impact, deferred fix).**
   Documented in §10.2. Real implementation in a later stage when
   per-component metric streams are needed.

## 14. Open questions for review

After the two-pass cold audit and revision, two questions remain for
the user to decide before the plan is written:

1. **Exit criterion strictness on `src/core/` modifications.** §12.5 as
   revised allows non-engine `src/core/` touches with explicit
   justification. Is that the right call, or do you want to preserve
   the stricter "no `src/core/` touches at all" bar and handle any
   edge cases with a follow-up stage? Default answer (pending your
   direction): the revised, slightly-relaxed version.

2. **Fallback plan if per-capability throughput aggregation fails
   Wave 3 tuning.** Risk #1 in §13. If Slice C can't find a tuning
   regime, escalating to `src/core/engine/throughput.ts` is the
   cleanest fix but breaks the "engine unchanged" pledge. Alternative
   is the "tune ForwardingCapability throughput very small" escape
   hatch in §10.4. Default answer: try escape hatch first, escalate
   only if forced — but you may want to commit to one approach upfront.

Neither is a blocker; both have reasonable defaults. Flagged so the
implementation plan can make the right assumption instead of
re-discovering the choice mid-Slice C.

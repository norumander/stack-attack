# Tower Defense Foundation Design

**Status:** Draft
**Date:** 2026-04-10
**Authors:** Normid + Claude (brainstorming session)
**Tethered to:** `CLAUDE.md`, `component-architecture.md`, `wave-progression-strategy.md`

---

## Purpose

This document is the implementation contract for Phase 1 of the System Architecture Tower Defense game. It exists so that one developer can build the shared simulation foundation solo (agentically), then hand off to a second developer (also agentic) who builds a second mode in parallel without touching Phase 1 files.

The design doc in `component-architecture.md` describes the intended architecture. This document takes that architecture as input, fixes the holes a red-team audit surfaced, and translates it into concrete TypeScript contracts, folder layout, build order, and a clean Phase 2 seam.

**If you are an agent reading this document to implement Phase 1:** read it end-to-end before writing code. Stages 1–5 must be executed in order. Each stage has explicit exit criteria.

**If you are an agent reading this document to implement Phase 2 (a mode):** read the "Phase 2 seam" section first, then `docs/phase-2-onboarding.md`. Do not modify anything outside `src/modes/<yourmode>/`.

---

## Audit fixes applied to `component-architecture.md`

Thirteen issues in the original architecture doc are resolved in this spec. Full rationale lives in the git history; the TypeScript contracts, folder layout, and engine sections below are the authoritative replacement. Where this document conflicts with `component-architecture.md`, this document wins.

| ID | Problem | Resolution |
|---|---|---|
| A1 | Tick loop named `BatchProcessingCapability` → hidden type check | New `EnginePullable` sub-interface; engine discovers pullers structurally |
| A2 | Stringly-typed condition effects (`"latency_bonus_50pct"`) | Closed `ConditionEffect` discriminated union, single interpretation site |
| A3 | "Engine scans topology for ServiceRegistry" type check + incoherent auto-register | `InstanceDirectory` sub-interface; ServiceRegistry is **informational** — filters existing player-wired connections, never creates phantom ones |
| B1 | `instanceCount` multiplied upkeep but not throughput → auto-scaling collapsed | `getThroughputPerTick()` on PROCESS capabilities + capacity gate in step 3 + new `OVERLOADED` event distinct from `BACKPRESSURED` |
| B2 | Re-emission flag would violate Request immutability | `QueueCapability` tracks `justReEmittedThisTick` internally; new optional `Capability.resetPerTickState?()` hook called in step 9 |
| B3 | `EntryPoint` mentioned once, no registry entry, no multi-zone story | Client is a normal Component with only an egress port; auto-placement is a ModeController decision |
| B4 | Condition effect application sites unspecified | Four fixed sites in a single `applyConditionEffects` helper (see Engine section) |
| B5 | Stream "per-tick revenue" had no crediting site | Credited per tick in step 4b (`UPDATE ACTIVE STREAMS`) |
| B6 | "Topological order" undefined for cyclic graphs | Stable-per-wave visitation order + fixed-point loop with iteration cap |
| C1 | Topology ownership ambiguous (engine vs ModeController) | `SimulationState` is the single source of truth; engine mutates during tick, ModeController mutates build-phase only, capabilities read via `SimulationStateReader` |
| C2 | `Capability.phase` was required but `RoutingCapability` omits it | `phase` is optional; capabilities are pipeline OR sub-interface-only OR both; registry validates "phase OR sub-interface" at load time |
| C3 | Dual authority for tier (player upgrade + mode cap) → drift risk | Standalone `getEffectiveTier(component, capId, modeController)` function in `src/core/component/effective-tier.ts`; `Component.capabilityTiers` private; `Component.getPlayerTier()` is the only raw read path |
| C5 | Economy coupled to ModeController → Sandbox dev would have to untangle later | `EconomyStrategy` interface extracted day 1; ModeController holds one instance; engine always goes through the strategy |

Every fix is reflected in the contracts below. Implementers should read the contracts, not re-derive intent from this table.

---

## Phase 1 scope

Phase 1 contains everything both modes depend on and neither mode owns. If something is more TD than Sandbox (or vice versa), it's Phase 2.

### In scope
1. Core value types (Request, RequestEvent, ProcessResult, Phase, ConditionEffect, Port, Connection, IDs)
2. `Capability` interface + all four sub-interfaces (`EngineConsultable`, `EngineBufferable`, `EnginePullable`, `InstanceDirectory`)
3. `Component` class
4. `SimulationState` + `SimulationStateReader`
5. `Engine` with full 10-step tick loop, fixed-point loop (B6), condition effects (B4), throughput gate (B1)
6. `CapabilityRegistry` and `ComponentRegistry` with registration-time validation
7. All 24 capabilities (one per capability type in `component-architecture.md`)
8. All 14 components (13 from the registry + Client/EntryPoint)
9. Abstract `ModeController`, `EconomyStrategy`, `TrafficSource` interfaces — no implementations
10. `CompositeTrafficSource` utility (mode-agnostic multi-source wrapper)
11. Headless test harness (fixtures, assertions, trace utilities)
12. `RenderSnapshot` extraction function
13. Basic UI (React chrome + Pixi board + request visualization)
14. `src/modes/example/` as a reference implementation for Phase 2 onboarding
15. Phase 2 onboarding doc, frozen-folder `CLAUDE.md` markers, ESLint import boundaries

### Out of scope (Phase 2 or later)
- `TDModeController`, `TDEconomy`, wave configurations, TD-specific UI
- `SandboxModeController`, `SandboxEconomy`, traffic configurator, Sandbox-specific UI
- Sprite art, icons, animations beyond request dots, sound, custom fonts, themes
- Level select, menus, campaign flow, scenario library, save files
- Multi-zone data-center grouping UI (engine supports zones; UI grouping is mode-specific)
- Chaos event configuration UI

---

## TypeScript contracts

The shapes below are the stable contracts for Phase 1. Agent implementers should reference these, not reinvent them. Where TypeScript syntax is used, treat it as the authoritative signature.

### Supplementary types (referenced throughout the spec)

These are the small "glue" types referenced by signatures in later subsections. They're grouped here so there's one place to find them.

```ts
// src/core/types/position.ts
interface Position {
  readonly x: number;
  readonly y: number;
}

// src/core/engine/rng.ts
// Deterministic PRNG seeded with a string composed of
// (tick, componentId, requestId, purposeTag). Used by the engine for
// any randomness that must be replay-safe (condition drop_probability,
// eviction policy ties, etc.). Capabilities never allocate their own
// RNG — they receive one through ProcessContext.
interface DeterministicRng {
  next(): number;                 // returns float in [0, 1)
  nextInt(maxExclusive: number): number;
  fork(purposeTag: string): DeterministicRng;  // child RNG for isolated sub-uses
}

// src/core/types/stream.ts
// Entry in SimulationState.activeStreams. Created by the engine in
// step 4a when a StreamingCapability returns RESPOND with streamDuration > 0.
// Iterated by step 4b to decrement duration, credit revenue, and release
// bandwidth on completion.
interface ActiveStream {
  readonly requestId: RequestId;
  readonly connectionId: ConnectionId;   // connection holding the reservation
  readonly originComponentId: ComponentId;
  readonly baseRevenue: number;          // credited per tick via economy
  remainingDuration: number;             // mutated by step 4b
  reservedBandwidth: number;             // may be reduced by adaptive streaming
}

// src/core/mode/chaos.ts
// Mode-agnostic chaos event vocabulary. Modes schedule these via
// ModeController.getScheduledChaos(); the engine applies them in step 6b.
// Closed union — adding a new kind is a single interpretation site in the
// engine's chaos application helper (same pattern as ConditionEffect in A2).
type ChaosEvent =
  | { kind: "component_failure"; componentId: ComponentId }
  | { kind: "zone_outage"; zone: string; durationTicks: number }
  | { kind: "connection_sever"; connectionId: ConnectionId; durationTicks: number }
  | { kind: "latency_injection"; connectionId: ConnectionId; extraLatency: number; durationTicks: number };

// Stored in SimulationState.activeChaos for kinds that persist across ticks.
// Keyed by a stable chaos key (e.g., `${kind}:${connectionId}`).
// component_failure is instantaneous and does NOT create an activeChaos entry
// (the condition mutation is the only effect).
interface ActiveChaosEntry {
  readonly event: ChaosEvent;
  readonly expiresAtTick: number;
}

// src/core/types/zone.ts
// Zone-pair latency table, owned by SimulationState and populated by the
// current ModeController via getInitialZoneTopology() at level start.
// Pure data — no class, no behavior. Pre-wave-9 single-zone games use an
// empty topology; getZonePairLatency returns 0 for all pairs.
interface ZoneTopology {
  readonly zones: readonly string[];
  // Keys are canonical unordered pairs: `${min(a,b)}|${max(a,b)}`.
  // Same-zone is always 0 and is not stored in the map.
  readonly pairLatency: ReadonlyMap<string, number>;
}

function zonePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function getZonePairLatency(
  topology: ZoneTopology,
  a: string | null,
  b: string | null
): number {
  if (a === null || b === null || a === b) return 0;
  return topology.pairLatency.get(zonePairKey(a, b)) ?? 0;
}

// src/core/engine/per-component-counters.ts
// Per-tick outcome counters maintained by the engine as side effects of
// tick steps 3/4a/5. Read by step 6 (UPDATE CONDITION) to compute the
// unhealthySignal, and by step 8 (RECORD METRICS) to build TickMetrics.
// Reset in step 9. Entries are lazily created when first incremented;
// the engine uses `state.perComponentThisTick.get(id) ?? EMPTY_COUNTERS`
// where EMPTY_COUNTERS is an exported zero-filled singleton.
interface PerComponentTickCounters {
  processed: number;        // incremented ONCE per request, in step 4a (delivery),
                            // on RESPOND or FORWARD outcome. Step 3 does not
                            // increment it — this prevents double-counting.
  drops: number;            // DROP outcome (step 3 or 4a)
  timeouts: number;         // timed out while this component was current (step 5)
  overloaded: number;       // rejected by throughput gate (step 3)
  backpressured: number;    // rejected by egress bandwidth (step 4a)
}

const EMPTY_COUNTERS: Readonly<PerComponentTickCounters> = {
  processed: 0, drops: 0, timeouts: 0, overloaded: 0, backpressured: 0,
};

// src/core/mode/build-constraints.ts
interface BuildConstraints {
  readonly availableComponentTypes: readonly string[];  // drives the palette
  readonly maxPlacements?: number;
  readonly zoneAllowlist?: readonly string[];
}

// src/core/mode/placement-result.ts
type PlacementResult =
  | { ok: true; componentId: ComponentId }
  | {
      ok: false;
      reason: "insufficient_budget" | "invalid_position" | "invalid_zone" | "disallowed_by_mode" | "registry_unknown_type";
      detail?: string;
    };

type UpgradeResult =
  | { ok: true; newPlayerTier: number }
  | {
      ok: false;
      reason: "insufficient_budget" | "max_tier_reached" | "disallowed_by_mode" | "capability_not_found";
      detail?: string;
    };

// src/core/engine/metrics.ts
interface TickMetrics {
  readonly tick: number;
  readonly requestsProcessed: number;
  readonly requestsResolved: number;   // successful RESPOND
  readonly requestsDropped: number;
  readonly requestsOverloaded: number; // distinct from dropped/backpressured
  readonly requestsBackpressured: number;
  readonly requestsTimedOut: number;
  readonly revenueEarned: number;
  readonly upkeepPaid: number;
  readonly avgLatency: number;
  readonly perComponent: ReadonlyMap<ComponentId, {
    processed: number;
    dropped: number;
    overloaded: number;
    backpressured: number;
    condition: number;
  }>;
}

// src/core/mode/outcome.ts
interface OutcomeReport {
  readonly verdict: "win" | "lose" | "neutral";
  readonly score: {
    readonly cost: number;
    readonly performance: number;
    readonly reliability: number;
    readonly composite: number;
  };
  readonly notes: readonly string[];
}

// src/core/component/component-args.ts
interface ComponentConstructorArgs {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: ReadonlyMap<CapabilityId, Capability>;
  readonly initialTiers: ReadonlyMap<CapabilityId, number>;  // seeds the private capabilityTiers map
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly position: Position;
  readonly zone: string | null;
  readonly placementTick: number;
  readonly conditionProfile: ConditionProfile;
  // Defaults (set by Component constructor if not provided):
  readonly initialInstanceCount?: number;   // default 1
  readonly initialCondition?: number;       // default 1.0
}
```

### Engine sub-interface discovery

The engine discovers which capabilities implement which sub-interfaces via **structural predicate functions**, not runtime tags. Each sub-interface has a unique method name, so method presence is a safe and type-narrowing check:

```ts
// src/core/capability/engine-interfaces.ts
function isEngineConsultable(c: Capability): c is Capability & EngineConsultable {
  return typeof (c as unknown as EngineConsultable).selectConnection === "function";
}

function isEngineBufferable(c: Capability): c is Capability & EngineBufferable {
  return typeof (c as unknown as EngineBufferable).enqueueForRetry === "function";
}

function isEnginePullable(c: Capability): c is Capability & EnginePullable {
  return typeof (c as unknown as EnginePullable).pullPending === "function";
}

function isInstanceDirectory(c: Capability): c is Capability & InstanceDirectory {
  return typeof (c as unknown as InstanceDirectory).listCandidates === "function";
}
```

`Component.getCapabilityByInterface<T>(predicate)` takes a predicate of the above shape and returns `(Capability & T) | null`. The engine never names a specific capability class.

### Core value types

```ts
// src/core/types/ids.ts
type RequestId = string & { readonly __brand: "RequestId" };
type ComponentId = string & { readonly __brand: "ComponentId" };
type CapabilityId = string & { readonly __brand: "CapabilityId" };
type ConnectionId = string & { readonly __brand: "ConnectionId" };
type PortId = string & { readonly __brand: "PortId" };

// src/core/types/request.ts
type Phase = "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE";

interface Request {
  readonly id: RequestId;
  readonly parentId: RequestId | null;
  readonly type: string;
  readonly payload: unknown;
  readonly origin: ComponentId;
  readonly createdAt: number;
  readonly ttl: number;
  readonly originZone: string | null;
  readonly streamDuration: number | null;
  readonly streamBandwidth: number | null;
}

type RequestEventType =
  | "ENTERED" | "PROCESSED" | "FORWARDED"
  | "CACHED_HIT" | "CACHED_MISS"
  | "QUEUED" | "DEQUEUED"
  | "SPAWNED_SUB"
  | "RESPONDED" | "DROPPED" | "TIMED_OUT"
  | "BACKPRESSURED" | "OVERLOADED"  // OVERLOADED is new (item B1)
  | "TRAVERSED";

interface RequestEvent {
  readonly tick: number;
  readonly componentId: ComponentId;
  readonly capabilityId: CapabilityId | null;  // null for engine-produced events
  readonly connectionId: ConnectionId | null;  // only for TRAVERSED
  readonly type: RequestEventType;
  readonly latencyAdded: number;
  readonly metadata?: Record<string, unknown>;
}

// src/core/types/result.ts
type PrimaryOutcome =
  | { kind: "RESPOND" }
  | { kind: "FORWARD" }
  | { kind: "DROP"; reason: string }
  | { kind: "QUEUE_HOLD" }
  | { kind: "PASS" };

type SideEffect =
  | { kind: "SPAWN"; request: Request; blocking: boolean }
  | { kind: "SCALE"; targetInstanceCount: number };

interface ProcessResult {
  outcome: PrimaryOutcome;
  sideEffects: SideEffect[];
  events: RequestEvent[];
}

// src/core/types/port.ts
interface Port {
  readonly id: PortId;
  readonly direction: "ingress" | "egress";
  readonly dataType: string;
  readonly capacity: number;
  connections: ConnectionId[];
}

// src/core/types/connection.ts
interface Connection {
  readonly id: ConnectionId;
  readonly source: { componentId: ComponentId; portId: PortId };
  readonly target: { componentId: ComponentId; portId: PortId };
  readonly bandwidth: number;
  readonly latency: number;
  currentLoad: number;  // reset each tick in step 9
}

// src/core/types/condition.ts
type ConditionEffect =
  | { kind: "latency_multiplier"; factor: number }
  | { kind: "drop_probability"; p: number }
  | { kind: "throughput_multiplier"; factor: number }
  | { kind: "upkeep_multiplier"; factor: number };

interface ConditionProfile {
  degradedThreshold: number;     // condition below this → degraded tier
  criticalThreshold: number;     // condition below this → critical tier
  decayRate: number;             // max points lost per tick at signal=1.0
  recoveryRate: number;          // points recovered per tick at signal=0
  degradedEffects: ConditionEffect[];
  criticalEffects: ConditionEffect[];
}
```

### Capability interface and sub-interfaces

```ts
// src/core/capability/process-context.ts
interface ProcessContext {
  readonly state: SimulationStateReader;
  readonly componentId: ComponentId;
  readonly effectiveTier: number;                          // pre-computed by engine for THIS capability
  readonly effectiveTiers: ReadonlyMap<CapabilityId, number>;  // full map for the component
  readonly activeCapabilityIds: ReadonlySet<CapabilityId>; // filtered by ModeController
  readonly currentTick: number;
  readonly rng: DeterministicRng;                          // seeded per (tick, componentId, requestId)
  readonly directories: readonly InstanceDirectory[];      // from item A3
}

// src/core/capability/capability.ts
interface Capability {
  readonly id: CapabilityId;
  readonly phase?: Phase;  // optional — item C2
  canHandle(requestType: string): boolean;
  process(request: Request, context: ProcessContext): ProcessResult;
  getUpkeepCost(tier: number): number;
  getThroughputPerTick?(tier: number): number;  // PROCESS-phase only — item B1
  getStats(): CapabilityStats;
  configure?(config: unknown): void;  // Sandbox-only, TD never calls
  resetPerTickState?(): void;  // item B2 — called in tick step 9
}

interface CapabilityStats {
  hitRate?: number;
  queueDepth?: number;
  latencyAdded?: number;
  [key: string]: number | undefined;
}

// src/core/capability/engine-interfaces.ts
interface EngineConsultable {
  selectConnection(
    request: Request,
    egressConnections: Connection[],
    context: ProcessContext
  ): ConnectionId;
}

interface EngineBufferable {
  // Called by the engine in step 4a when a Connection rejects an outbound
  // FORWARD delivery. The buffered entry remembers the pre-computed
  // ProcessResult so re-delivery does NOT re-run the pipeline.
  // Returns false if the buffer is at capacity — the engine then drops.
  enqueueForRetry(request: Request, result: ProcessResult): boolean;

  // Called by the engine in step 2 (RE-EMIT QUEUED). Returns everything
  // ready to re-enter the system on the component owning this capability:
  //   - awaitingPipeline: requests that were proactively held (QUEUE_HOLD
  //     during INTERCEPT). These re-enter their own component's pipeline
  //     from the top. QueueCapability's re-emission tag (item B2) ensures
  //     they PASS on the second visit.
  //   - awaitingDelivery: requests that were backpressure-held via
  //     enqueueForRetry. These bypass the pipeline entirely — the engine
  //     retries delivery directly with the preserved ProcessResult.
  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  };

  // Called by EnginePullable holders (e.g., BatchProcessingCapability on
  // a Worker) during step 2. Pulls up to n requests from a SEPARATE internal
  // buffer (awaitingWorkerPull) that is NEVER touched by emitReady.
  // A given request is in exactly one buffer for its entire lifecycle
  // inside the queue — there is no path by which a request can be delivered
  // twice. The routing rule at hold time: a request enters awaitingWorkerPull
  // if the Queue is configured in "worker-pull mode" (a constructor option
  // on QueueCapability). Other requests enter awaitingPipeline (proactive
  // hold for re-emission into the Queue's own component pipeline).
  dequeueBatch(n: number): Request[];
}

interface EnginePullable {
  pullPending(context: PullContext): Request[];
}

interface PullContext {
  readonly state: SimulationStateReader;
  readonly componentId: ComponentId;
  readonly currentTick: number;
}

interface InstanceDirectory {
  listCandidates(query: {
    componentType?: string;
    zone?: string;
    healthyOnly?: boolean;
  }): ComponentRef[];
}

// Snapshot returned by InstanceDirectory.listCandidates. `condition` is a
// live read at call time, not a cached value — directories consult
// state.components on each query. Consumers treat the ref as a short-lived
// value, not a handle to subscribe to.
interface ComponentRef {
  readonly componentId: ComponentId;
  readonly componentType: string;
  readonly zone: string | null;
  readonly condition: number;
}
```

### Component class and effective-tier function

```ts
// src/core/component/component.ts
class Component implements ComponentReader {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: ReadonlyMap<CapabilityId, Capability>;
  private capabilityTiers: Map<CapabilityId, number>;   // private, only upgrade() writes
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly placementTick: number;                        // used by visitation order (item B6)
  position: Position;
  zone: string | null;
  instanceCount: number;
  condition: number;
  readonly conditionProfile: ConditionProfile;

  constructor(args: ComponentConstructorArgs);

  // Single read path for the player's upgraded tier. Does NOT consult the mode.
  // For the effective tier (min of player tier and mode cap), use the standalone
  // getEffectiveTier function in src/core/component/effective-tier.ts.
  getPlayerTier(capabilityId: CapabilityId): number;

  getCapabilitiesByPhase(phase: Phase): Capability[];
  getCapabilityByInterface<T>(
    predicate: (c: Capability) => c is Capability & T
  ): (Capability & T) | null;

  // These methods take activeCapabilityIds + effectiveTiers as arguments because
  // Component has no ambient reference to ModeController — it's a pure pipeline runner.
  getThroughputPerTick(
    activeCapabilityIds: ReadonlySet<CapabilityId>,
    effectiveTiers: ReadonlyMap<CapabilityId, number>
  ): number;  // item B1
  getUpkeepCost(
    activeCapabilityIds: ReadonlySet<CapabilityId>,
    effectiveTiers: ReadonlyMap<CapabilityId, number>
  ): number;

  // Runs the pipeline. Engine pre-computes activeCapabilityIds + effectiveTiers
  // and passes them via ProcessContext; the pipeline runner filters each phase
  // by activeCapabilityIds before invoking capabilities.
  process(request: Request, context: ProcessContext): ProcessResult;

  // Low-level tier mutator. Called by ModeController.tryUpgrade() AFTER economy
  // checks have passed. UI code never calls this directly.
  upgrade(capabilityId: CapabilityId, registryMaxTier: number): void;

  // Iterates all capabilities and calls resetPerTickState() on any that
  // implement it (item B2). Called by engine in tick step 9.
  resetPerTickState(): void;
}

// src/core/component/effective-tier.ts
// THE single source of truth for effective tier (item C3). Every call site
// that needs an effective tier — pipeline, upkeep, throughput gate, UI inspector,
// renderer, diagnostics — imports and uses this function. Component itself
// exposes only getPlayerTier; no method on Component returns effectiveTier.
export function getEffectiveTier(
  component: ComponentReader,
  capabilityId: CapabilityId,
  modeController: ModeController
): number {
  const playerTier = component.getPlayerTier(capabilityId);
  const modeCap = modeController.getTierCap(component, capabilityId);
  return Math.min(playerTier, modeCap);
}

// Convenience: compute the full effective-tier map for a component. Engine
// calls this once per component per tick and passes the result through
// ProcessContext so capabilities never re-compute.
export function computeEffectiveTiers(
  component: ComponentReader,
  modeController: ModeController
): ReadonlyMap<CapabilityId, number>;
```

### ComponentReader (read-only view exposed to capabilities)

`SimulationStateReader` exposes components through `ComponentReader`, not `Component`. A `ComponentReader` has every readable field but no mutators — capabilities cannot call `upgrade()`, cannot modify `position`, cannot mutate `condition`. Mutations flow only through `SimulationState`'s explicit mutators and `ModeController`'s guarded flows.

```ts
// src/core/component/component-reader.ts
interface ComponentReader {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly placementTick: number;
  readonly position: Readonly<Position>;
  readonly zone: string | null;
  readonly instanceCount: number;      // readonly view — engine mutates via SimulationState
  readonly condition: number;          // readonly view — engine mutates via SimulationState
  readonly conditionProfile: ConditionProfile;

  getPlayerTier(capabilityId: CapabilityId): number;
  getCapabilityIds(): readonly CapabilityId[];
  getCapabilityByInterface<T>(
    predicate: (c: Capability) => c is Capability & T
  ): (Capability & T) | null;
}
```

`Component` implements `ComponentReader`. `SimulationState` exposes `Component` instances directly (engine can mutate); `SimulationStateReader` narrows the same instances to `ComponentReader`. This is a compile-time guarantee — TypeScript's structural typing prevents a capability from calling `upgrade()` on a `ComponentReader` even though the underlying object is a full `Component`.

### SimulationState

```ts
// src/core/state/simulation-state.ts
// THE single source of truth for mutable runtime state. Engine mutates during
// tick. ModeController mutates economy and build-phase topology via its
// guarded tryPlace/tryUpgrade flows. Capabilities never mutate directly —
// they receive a SimulationStateReader (which narrows components to
// ComponentReader) and produce ProcessResult.
class SimulationState {
  readonly components: Map<ComponentId, Component>;
  readonly connections: Map<ConnectionId, Connection>;
  readonly pending: Map<ComponentId, Request[]>;
  readonly activeStreams: Map<RequestId, ActiveStream>;
  readonly requestLog: Map<RequestId, RequestEvent[]>;
  readonly activeChaos: Map<string, ActiveChaosEntry>;
  readonly zoneTopology: ZoneTopology;  // set at construction, immutable thereafter
  currentTick: number;
  phase: "build" | "simulate" | "assess";
  readonly perComponentThisTick: Map<ComponentId, PerComponentTickCounters>;
  connectionLoadThisTick: Map<ConnectionId, number>;

  // Topology mutators (called by ModeController.tryPlace / tryUpgrade after
  // economy checks, never by capabilities or the engine tick loop directly)
  placeComponent(c: Component): void;
  removeComponent(id: ComponentId): void;
  addConnection(c: Connection): void;
  removeConnection(id: ConnectionId): void;

  // Runtime mutators (engine-only, called during tick execution)
  appendEvent(requestId: RequestId, event: RequestEvent): void;
  enqueuePending(componentId: ComponentId, request: Request): void;
  dequeuePending(componentId: ComponentId): Request | undefined;
  registerActiveStream(stream: ActiveStream): void;
  releaseActiveStream(requestId: RequestId): void;
  incrementProcessedCount(componentId: ComponentId): void;
  incrementConnectionLoad(connectionId: ConnectionId, amount: number): void;
  setCondition(componentId: ComponentId, value: number): void;
  setInstanceCount(componentId: ComponentId, count: number): void;
  advanceTick(): void;

  // Read-only view exposed to capabilities via ProcessContext
  asReader(): SimulationStateReader;
}

// src/core/state/state-reader.ts
// Narrows the full SimulationState to read-only access. Capabilities receive
// this via ProcessContext; they cannot mutate the simulation directly.
// Note: components are exposed as ComponentReader, not Component — this prevents
// capabilities from calling upgrade(), mutating position/condition, etc.
interface SimulationStateReader {
  readonly components: ReadonlyMap<ComponentId, ComponentReader>;
  readonly connections: ReadonlyMap<ConnectionId, Readonly<Connection>>;
  readonly zoneTopology: ZoneTopology;
  readonly currentTick: number;
  readonly phase: "build" | "simulate" | "assess";
  getEventsFor(requestId: RequestId): readonly RequestEvent[];
  getActiveStreamsOnConnection(connectionId: ConnectionId): readonly ActiveStream[];
  getActiveChaos(): readonly ActiveChaosEntry[];
  // No mutators
}
```

### Registry types

```ts
// src/core/registry/capability-registry.ts
// Sub-interface implementation is NOT declared in the registry — it's
// discovered structurally at runtime via the isEngineConsultable /
// isEngineBufferable / isEnginePullable / isInstanceDirectory predicate
// functions. The registry only holds the factory and the capability's ID.
interface CapabilityRegistryEntry {
  id: CapabilityId;
  factory: () => Capability;
  // Optional human-readable declaration for documentation / validation only.
  // The engine never consults this field — it uses the predicate functions.
  documentsSubInterfaces?: readonly ("EngineConsultable" | "EngineBufferable" | "EnginePullable" | "InstanceDirectory")[];
}

class CapabilityRegistry {
  register(entry: CapabilityRegistryEntry): void;
  get(id: CapabilityId): CapabilityRegistryEntry | undefined;
  validate(): void;  // throws on missing dependencies
}

// src/core/registry/component-registry.ts
interface ComponentRegistryEntry {
  type: string;
  name: string;
  description: string;
  capabilities: Array<{
    id: CapabilityId;
    defaultTier: number;
    maxTier: number;
  }>;
  ports: Port[];
  placementCost: number;
  upgradeCostCurve: number[];
  visual: { icon: string; color: string; shape: string };
  conditionProfile: ConditionProfile;
}

class ComponentRegistry {
  register(entry: ComponentRegistryEntry): void;
  get(type: string): ComponentRegistryEntry | undefined;
  list(): ComponentRegistryEntry[];
  create(type: string, position: Position, zone: string | null): Component;
  validate(): void;  // enforces the "phase OR sub-interface" rule from C2
}
```

### Engine

```ts
// src/core/engine/engine.ts
class Engine {
  tick(state: SimulationState, modeController: ModeController): void;

  // Each private method corresponds to a numbered tick step. Step 4 is split
  // into 4a (deliver results + credit one-shot revenue on RESPOND + reserve
  // stream bandwidth on streaming RESPOND) and 4b (update active streams +
  // credit per-tick stream revenue, item B5).
  private injectTraffic(state, modeController): void;         // step 1
  private reEmitQueued(state): void;                          // step 2
  private processPending(state, modeController): void;        // step 3 (fixed-point loop, item B6)
  private deliverResults(state, modeController, results): void; // step 4a
  private updateActiveStreams(state, modeController): void;   // step 4b (per-tick stream revenue)
  private checkTtl(state): void;                              // step 5
  private updateCondition(state): void;                       // step 6
  private injectChaos(state, modeController): void;           // step 6b
  private deductUpkeep(state, modeController): void;          // step 7
  private recordMetrics(state): void;                         // step 8
  private resetPerTickState(state): void;                     // step 9
  private advanceTick(state, modeController): void;           // step 10

  // Internal helper invoked at the start of step 3 for each component.
  // Pre-computes the per-tick activeCapabilityIds set (via modeController
  // .getActiveCapabilities) and the full effectiveTiers map (via
  // computeEffectiveTiers) and caches them for the duration of the tick.
  // These cached values are threaded into every ProcessContext passed to
  // Component.process() for the component during the tick.
  private buildProcessContext(
    state: SimulationState,
    component: Component,
    modeController: ModeController,
    request: Request
  ): ProcessContext;
}

// src/core/engine/condition-effects.ts
// The ONLY place ConditionEffect kinds are interpreted.
function applyConditionEffects(
  component: ComponentReader,
  phase: "pre_process" | "throughput_gate" | "post_process_event" | "upkeep",
  input: unknown,
  ctx: { rng: DeterministicRng; currentTick: number; requestId?: RequestId }
): unknown;
```

**Tick step 4a responsibilities** (canonical list — implementers should reference this when filling in `deliver-results.ts`):

1. For each `ProcessResult` from step 3:
   - **RESPOND (non-stream):** Credit via `economy.creditRevenue(request)` (amount computed internally by the mode). Deliver the response via the reply channel (see "Response transport" below). Append a single `RESPONDED` event to the request log with return-path metadata. If the request has a `parentId`, check whether the parent can now resolve. Increment `perComponentThisTick[componentId].processed` once.
   - **RESPOND (stream, i.e., `request.streamDuration != null`):** Do NOT credit lump-sum revenue. Register an `ActiveStream` entry in `SimulationState.activeStreams` with `remainingDuration = streamDuration`, `reservedBandwidth = streamBandwidth`, `connectionId` = the connection the request arrived on. Per-tick revenue is credited by step 4b. The `RESPONDED` event is appended at stream completion, not here. Increment `processed` once at registration time.
   - **FORWARD:** Consult `EngineConsultable.selectConnection()` or fall back to round-robin. Attempt delivery on the chosen connection. Compute per-traversal latency via `getConnectionChaosAdjustments` + `getZonePairLatency` (see "Connection latency composition" below). If effective bandwidth is exceeded, reject: route to `EngineBufferable.enqueueForRetry()` on the sending component if present, else drop with a `BACKPRESSURED` event. On successful delivery, append a `TRAVERSED` event and increment `processed`. On rejection, increment `backpressured` and do NOT increment `processed`.
   - **DROP:** Append `DROPPED` event with reason. Increment `drops`.
   - **QUEUE_HOLD:** Already handled — the request is inside `QueueCapability`'s awaiting-pipeline buffer. No counter increment.
2. For each `SPAWN` side effect: create child Request with `parentId` set and `ttl = min(parent's (createdAt + ttl - currentTick), childDefinedTtl)` (the remaining wall-clock TTL of the parent relative to the current tick, not a stored field). Enqueue in the target component's `state.pending[targetComponentId]`. Blocking spawns (from PROCESS phase) register the parent as waiting.
3. For `SPAWN` side effects emitted by `ReplicationCapability` in the REPLICATE phase, see "Pub/sub fanout" below — the fanout rule determines which egress connections receive a SPAWN.
4. For each `SCALE` side effect: adjust `instanceCount` via `state.setInstanceCount()`. **Do not debit the delta here** — step 7 recomputes total upkeep from `Component.getUpkeepCost()` which already reflects the new `instanceCount`, so the scaling cost is automatically captured on the next upkeep deduction without double-charging. A one-time scaling fee (if the mode's economy defines one) is the only additional charge at this site.

**Counter-increment rule (authoritative):** Each request outcome increments exactly ONE counter on exactly ONE component per tick, at the site listed above. Step 3 does NOT increment `processed` on PROCESS success — the increment waits until delivery in 4a. This prevents the double-count that would occur if a request counted at step 3 was later backpressured at 4a.

**Insolvency application** (referenced by step 7): when `economy.resolveInsolvency(state.asReader())` returns component IDs, the engine applies accelerated degradation to each — specifically, it sets their `condition` directly to the component's `conditionProfile.criticalThreshold`, triggering the critical-tier condition effects for the following tick. This is a single site and matches the existing condition mechanism rather than introducing a new degradation path.

### Connection latency composition (used in step 4a)

Every time the engine delivers a FORWARD across a connection, the latency recorded on the TRAVERSED event is the sum of three sources, each with a single lookup site:

```ts
// Inside deliver-results.ts
const baseLatency = connection.latency;
const chaosAdjustments = getConnectionChaosAdjustments(state, connection.id, currentTick);
const sourceZone = state.components.get(connection.source.componentId)!.zone;
const targetZone = state.components.get(connection.target.componentId)!.zone;
const zonePairLatency = getZonePairLatency(state.zoneTopology, sourceZone, targetZone);
const totalLatency = baseLatency + chaosAdjustments.extraLatency + zonePairLatency;
const effectiveBandwidth = chaosAdjustments.bandwidthOverride ?? connection.bandwidth;
```

`getConnectionChaosAdjustments` is a small helper in `src/core/engine/chaos-effects.ts`:
```ts
function getConnectionChaosAdjustments(
  state: SimulationStateReader,
  connectionId: ConnectionId,
  currentTick: number
): { bandwidthOverride?: number; extraLatency: number } {
  let extraLatency = 0;
  let bandwidthOverride: number | undefined;
  for (const entry of state.getActiveChaos()) {
    if (entry.expiresAtTick < currentTick) continue;
    if (entry.event.kind === "latency_injection" && entry.event.connectionId === connectionId) {
      extraLatency += entry.event.extraLatency;
    } else if (entry.event.kind === "connection_sever" && entry.event.connectionId === connectionId) {
      bandwidthOverride = 0;
    }
  }
  return { bandwidthOverride, extraLatency };
}
```

This is the only place zone topology and connection chaos are consumed during delivery. The reply channel and diagnostic views read these composed latencies from the event log after the fact — they never re-compute.

### Response transport (reply channel)

When a `RESPOND` primary outcome flows through step 4a for a non-stream request (or through step 4b at stream completion for a stream), the engine delivers the response via a dedicated reply channel with these invariants:

**Invariants:**
1. **Response delivery never fails.** Once a request gets RESPOND, the response is guaranteed to reach the origin. This is asserted in integration tests.
2. **No bandwidth consumption.** Return transport does not consume `Connection.currentLoad`. Bandwidth contention applies only on the forward path.
3. **No TTL interaction.** Return latency does not count against TTL. A request that gets RESPOND before TTL expires is successful regardless of return latency.
4. **Return path is reconstructed, not stored.** The request remains an immutable creation snapshot; the path is derived from the event log.

**Algorithm:**
```ts
// src/core/engine/response-transport.ts
function reconstructReturnPath(events: readonly RequestEvent[]): {
  connectionIds: ConnectionId[];
  totalLatency: number;
} {
  const traversed = events.filter(e => e.type === "TRAVERSED");
  return {
    connectionIds: traversed.map(e => e.connectionId!).reverse(),
    totalLatency: traversed.reduce((sum, e) => sum + e.latencyAdded, 0),
  };
}
```

A request that resolves at the same component where it entered (never traversed a connection) has `connectionIds: []` and `totalLatency: 0`. This is valid: diagnostics show "return: 0 ticks, 0 hops" for such requests. The invariant "response delivery never fails" is satisfied trivially.

The engine calls `reconstructReturnPath` once per RESPOND in step 4a (or once per stream completion in step 4b), then appends a `RESPONDED` event to the request log with:
- `componentId` = the component that issued the RESPOND
- `capabilityId` = the capability that produced the RESPOND (or null for engine-issued)
- `latencyAdded` = the computed return-path total latency (zone modifiers included because they were folded into the TRAVERSED events' `latencyAdded` at delivery time)
- `metadata` = `{ returnPath: connectionIds, destinationComponentId: request.origin }`

**`totalLatency` for a request** = sum of `latencyAdded` across every event in the log, including the `RESPONDED` event. The diagnostics renderer can split forward vs return visually by reading `metadata.returnPath` on the RESPONDED event, but the single-sum rule means there's no separate accounting.

### Chaos application (tick step 6b)

Chaos application mirrors the condition-effects pattern from item B4: a single helper that interprets every `ChaosEvent` kind, called from exactly one tick step.

```ts
// src/core/engine/chaos-effects.ts
// THE only place ChaosEvent kinds are interpreted.
function applyChaosEvent(state: SimulationState, event: ChaosEvent, currentTick: number): void {
  switch (event.kind) {
    case "component_failure": {
      const comp = state.components.get(event.componentId);
      if (!comp) return;
      state.setCondition(event.componentId, comp.conditionProfile.criticalThreshold);
      // Persist for 1 tick so the cascade registers before recovery kicks in.
      state.activeChaos.set(
        `component_failure:${event.componentId}`,
        { event, expiresAtTick: currentTick + 1 }
      );
      return;
    }
    case "zone_outage": {
      for (const [id, c] of state.components) {
        if (c.zone === event.zone) {
          state.setCondition(id, c.conditionProfile.criticalThreshold);
        }
      }
      state.activeChaos.set(
        `zone_outage:${event.zone}`,
        { event, expiresAtTick: currentTick + event.durationTicks }
      );
      return;
    }
    case "connection_sever": {
      state.activeChaos.set(
        `connection_sever:${event.connectionId}`,
        { event, expiresAtTick: currentTick + event.durationTicks }
      );
      return;
    }
    case "latency_injection": {
      state.activeChaos.set(
        `latency_injection:${event.connectionId}`,
        { event, expiresAtTick: currentTick + event.durationTicks }
      );
      return;
    }
  }
}
```

**Tick step 6b algorithm:**
1. Sweep `state.activeChaos` for expired entries (`expiresAtTick <= currentTick`) and remove them. The `<=` is deliberate: an event with `durationTicks: 1` scheduled at tick T has `expiresAtTick = T + 1`, and at tick T+1 it should no longer affect the simulation.
2. Call `modeController.getScheduledChaos(currentTick)` to get newly-scheduled events.
3. For each event, call `applyChaosEvent(state, event, currentTick)`.

Consumption sites for persistent chaos:
- `connection_sever` → consumed in step 4a's delivery logic via `getConnectionChaosAdjustments` (bandwidth override to 0). Consumer uses the same `<= currentTick` expiry check as the sweep.
- `latency_injection` → consumed in step 4a's delivery logic via `getConnectionChaosAdjustments` (extra latency added). Same expiry check.
- `component_failure` → **persisted as an `activeChaos` entry with `durationTicks: 1`**, not instantaneous. This ensures the failed component's condition stays at critical for at least one full tick of cascade effects before normal recovery resumes. Without this, the condition-recovery step would heal the failure before any downstream damage could register.
- `zone_outage` → recorded in `activeChaos`; condition update mechanics (step 6) holds condition at `criticalThreshold` for all components in the zone while the outage persists.

Adding a new chaos kind is a single new `case` branch in `applyChaosEvent` + an optional new consumption site if persistent. Same extensibility rule as `ConditionEffect`.

### Condition update mechanics (tick step 6)

Condition is a float in `[0.0, 1.0]` driven by a single per-tick signal: the ratio of bad outcomes to total outcomes for this component in this tick.

**Signal formula:**
```
unhealthySignal = (drops + timeouts + overloaded + backpressured) / totalTouched
totalTouched = drops + timeouts + overloaded + backpressured + processed
```

If `totalTouched == 0`, signal is 0 (idle components gently recover).

**Update rule:**
```ts
// src/core/engine/tick-steps/update-condition.ts
function updateCondition(state: SimulationState): void {
  // Build the set of component IDs suppressed by active chaos — these
  // components skip the normal update and are pinned at criticalThreshold.
  const suppressed = new Set<ComponentId>();
  for (const entry of state.activeChaos.values()) {
    if (entry.expiresAtTick <= state.currentTick) continue;
    if (entry.event.kind === "zone_outage") {
      for (const [id, c] of state.components) {
        if (c.zone === entry.event.zone) suppressed.add(id);
      }
    } else if (entry.event.kind === "component_failure") {
      suppressed.add(entry.event.componentId);
    }
  }

  for (const [componentId, component] of state.components) {
    if (suppressed.has(componentId)) {
      state.setCondition(componentId, component.conditionProfile.criticalThreshold);
      continue;
    }

    const counters = state.perComponentThisTick.get(componentId) ?? EMPTY_COUNTERS;
    const bad = counters.drops + counters.timeouts + counters.overloaded + counters.backpressured;
    const total = bad + counters.processed;

    let delta: number;
    if (total === 0 || bad === 0) {
      delta = component.conditionProfile.recoveryRate;
    } else {
      const unhealthySignal = bad / total;
      delta = -component.conditionProfile.decayRate * unhealthySignal;
    }

    const newCondition = Math.max(0, Math.min(1, component.condition + delta));
    state.setCondition(componentId, newCondition);
  }
}
```

**Suppression set invariant:** a component in the `suppressed` set has its condition pinned at exactly `criticalThreshold` (not a floor, not a ceiling — an exact assignment). This matches the intent of "condition persists at critical until the chaos expires." Once the chaos expires and the sweep removes it from `activeChaos`, the component drops out of the suppression set on the next tick and normal recovery resumes.

**Condition tier is derived, not stored:**
```ts
// src/core/engine/condition-tier.ts
function getConditionTier(
  condition: number,
  profile: ConditionProfile
): "healthy" | "degraded" | "critical" {
  if (condition <= profile.criticalThreshold) return "critical";
  if (condition <= profile.degradedThreshold) return "degraded";
  return "healthy";
}
```

Called by `applyConditionEffects` at each of the four application sites (item B4). The effects list is selected based on the tier: `healthy` → none, `degraded` → `profile.degradedEffects`, `critical` → `profile.criticalEffects`.

**Counter incrementing requirements:**
- **Tick step 3** (process pending): increments `overloaded` on throughput-gate rejection, `drops` on DROP outcome. Does NOT increment `processed` — that happens at delivery in step 4a to avoid double-counting requests that pass the pipeline but then get rejected on delivery.
- **Tick step 4a** (deliver results): increments `processed` on successful RESPOND/FORWARD delivery, `backpressured` on connection rejection, `drops` on DROP outcome that originated at this step.
- **Tick step 5** (check TTL): increments `timeouts` on the component where the request was current when it timed out.
- **Tick step 9** (reset per-tick state): clears `state.perComponentThisTick` to an empty map. Fresh counter entries are created lazily by each incrementing step.

### Pub/sub fanout via REPLICATE + port-type filter

Pub/sub events are handled by `ReplicationCapability` in the REPLICATE phase. The subscription topology is **the set of egress connections the player wired** — there is no separate subscription registry.

**Fanout rule:** when `ReplicationCapability.process()` is called with a request whose type matches its fanout criteria (typically `request.type === "event"`), it emits one non-blocking SPAWN side effect per **port-compatible egress connection** on its component. A connection is port-compatible if the target component's ingress port has a `dataType` matching the request type (e.g., `"event"`).

The port-compatibility check already exists in the placement tool — it's the same rule that allows or rejects wiring. At fanout time, the same check narrows the set of legitimate subscribers.

**Pseudocode:**
```ts
// src/capabilities/replication/replication-capability.ts
class ReplicationCapability implements Capability {
  readonly phase = "REPLICATE";

  canHandle(): boolean { return true; }  // REPLICATE phase always runs

  process(request: Request, context: ProcessContext): ProcessResult {
    if (request.type !== "event") {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }
    const component = context.state.components.get(context.componentId)!;

    // Inline filter — no external helper. Walks the component's egress ports,
    // collects connections whose TARGET component has an ingress port with
    // matching dataType.
    const fanoutConnectionIds: ConnectionId[] = [];
    for (const port of component.ports) {
      if (port.direction !== "egress") continue;
      for (const connId of port.connections) {
        const conn = context.state.connections.get(connId);
        if (!conn) continue;
        const target = context.state.components.get(conn.target.componentId);
        if (!target) continue;
        const targetIngress = target.ports.find(
          p => p.direction === "ingress" && (p.dataType === "event" || p.dataType === "any")
        );
        if (targetIngress) fanoutConnectionIds.push(connId);
      }
    }

    const remainingTtl = Math.max(0, (request.createdAt + request.ttl) - context.currentTick);
    const spawns: SideEffect[] = fanoutConnectionIds.map(connId => ({
      kind: "SPAWN",
      request: {
        ...makeChildRequestId(),
        parentId: request.id,
        type: "event",
        payload: request.payload,
        origin: context.componentId,
        createdAt: context.currentTick,
        ttl: remainingTtl,
        originZone: request.originZone,
        streamDuration: null,
        streamBandwidth: null,
      },
      blocking: false,
    }));
    return { outcome: { kind: "PASS" }, sideEffects: spawns, events: [] };
  }
}
```

**Tier progression:**
- **Tier 1:** Blind fanout to all port-compatible egress connections. If a subscriber is down, the event is lost (or queued if the subscriber has a `QueueCapability` in front of it — handled by the normal backpressure path).
- **Tier 2:** Health-aware fanout. Consults `context.directories` (any capability implementing `InstanceDirectory`) and skips subscribers whose registered condition is critical.
- **Tier 3:** Zone-aware fanout. Prefers same-zone subscribers; replicates cross-zone asynchronously via additional SPAWNs with higher composed latency.

**Teaching moment intact:** "Subscriptions are just connections. Adding a new subscriber means wiring one."

**Deprecated:** the `fanout: true` flag previously declared on the `event` request type is dropped. Fanout is a REPLICATE-phase behavior driven by the capability, not a property of the request. This is more extensible — a future `broadcast_metric` type can fan out via a different capability without touching the request schema.

### Mode and economy interfaces (abstract only in Phase 1)

```ts
// src/core/mode/mode-controller.ts
interface ModeController {
  readonly economy: EconomyStrategy;

  // Filters which capabilities on a component are active in the current
  // mode/phase/wave. The engine calls this once per component at the start
  // of each tick and caches the result in ProcessContext.activeCapabilityIds
  // for the duration of that tick. A capability not in the returned set is
  // skipped by Component.process() in every phase and does not accrue upkeep.
  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId>;

  // Returns Infinity if no cap is imposed. Consumed by the standalone
  // getEffectiveTier() function in src/core/component/effective-tier.ts.
  getTierCap(component: ComponentReader, capabilityId: CapabilityId): number;

  getBuildConstraints(): BuildConstraints;
  getTrafficSource(): TrafficSource;
  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport;
  getPhase(): "build" | "simulate" | "assess";
  advancePhase(): void;

  // Supplies the zone-pair latency table at level start. Returned topology
  // becomes SimulationState.zoneTopology and is immutable for the duration
  // of the simulation. Single-zone levels return an empty topology:
  //   { zones: [], pairLatency: new Map() }
  getInitialZoneTopology(): ZoneTopology;

  // Build-phase guarded mutators. The ONLY public code path for component
  // placement and upgrades. UI calls these; they internally:
  //   1. Validate against getBuildConstraints()
  //   2. Check economy.canAfford(cost)
  //   3. Debit economy (debitPlacement / debitUpgrade)
  //   4. Call SimulationState.placeComponent() or Component.upgrade() — the
  //      low-level mutators, which are never called directly from UI or engine
  //   5. Return a PlacementResult / UpgradeResult
  // Build-phase only. tryPlace returns { ok: false, reason: "disallowed_by_mode" }
  // if called while getPhase() !== "build". Matches CLAUDE.md's "build → watch
  // → assess → repeat" principle: no mid-wave intervention.
  tryPlace(
    state: SimulationState,
    type: string,
    position: Position,
    zone: string | null
  ): PlacementResult;
  tryUpgrade(
    state: SimulationState,
    componentId: ComponentId,
    capabilityId: CapabilityId
  ): UpgradeResult;

  // Chaos injection — engine calls in step 6b. Returns events scheduled
  // for the current tick. The engine applies them via applyChaosEvent.
  getScheduledChaos(currentTick: number): readonly ChaosEvent[];

  // Optional per-tick observation hook. Engine calls this in step 10
  // (ADVANCE TICK), after all tick work but before checking wave-over
  // condition. Modes use it to react to dynamic simulation state —
  // e.g., a scripted-failure mode triggering an explainer when a specific
  // component first hits critical condition. Most modes do not implement it.
  // The mode receives a read-only view; it cannot mutate state from here.
  onTick?(state: SimulationStateReader): void;
}

// src/core/mode/economy-strategy.ts
interface EconomyStrategy {
  getBudget(): number;
  canAfford(cost: number): boolean;

  // The mode's economy computes the amount from request.type internally —
  // no Phase 1 RequestTypeRegistry exists. Returns the credited amount for
  // metrics aggregation. A sandbox-style "observation only" economy may
  // return 0 without actually mutating budget.
  creditRevenue(request: Request): number;

  debitUpkeep(totalUpkeep: number): void;
  debitPlacement(component: ComponentReader): void;
  debitUpgrade(component: ComponentReader, capabilityId: CapabilityId): void;
  resolveInsolvency(state: SimulationStateReader): ComponentId[];
}

// src/core/mode/traffic-source.ts
interface TrafficSource {
  // null for composite sources that hold per-zone sub-sources; consumers
  // must check for null and iterate sub-sources instead.
  readonly targetEntryPointId: ComponentId | null;
  generate(tick: number): Request[];
  // For composite sources; atomic sources return [this].
  getSubSources?(): readonly TrafficSource[];
}

// src/core/mode/composite-traffic-source.ts
// Mode-agnostic utility: wraps N sub-sources, one per entry point.
// targetEntryPointId is null; engine consumes via getSubSources().
class CompositeTrafficSource implements TrafficSource {
  readonly targetEntryPointId: null;
  constructor(sources: TrafficSource[]);
  generate(tick: number): Request[];  // concatenates all sub-source outputs
  getSubSources(): readonly TrafficSource[];
}

// src/core/mode/mode-definition.ts
interface ModeDefinition {
  id: string;
  name: string;
  description: string;
  createController: () => ModeController;
  hudSlot: React.ComponentType;
}
```

### Render snapshot

```ts
// src/render/snapshot.ts
interface RenderSnapshot {
  readonly tick: number;
  readonly phase: "build" | "simulate" | "assess";
  readonly budget: number;
  readonly components: Array<{
    id: ComponentId;
    type: string;
    position: Position;
    zone: string | null;
    condition: number;
    instanceCount: number;
    visual: { icon: string; color: string; shape: string };
  }>;
  readonly connections: Array<{
    id: ConnectionId;
    source: { componentId: ComponentId; portId: PortId };
    target: { componentId: ComponentId; portId: PortId };
    currentLoad: number;
    bandwidth: number;
  }>;
  readonly inFlightRequests: Array<{
    id: RequestId;
    type: string;
    currentComponentId: ComponentId;
    age: number;
  }>;
  readonly metrics: {
    requestsPerTick: number;
    successRate: number;
    avgLatency: number;
    upkeepPerTick: number;
  };
}

// Visual data lives on ComponentRegistryEntry, not Component, so the
// snapshot extractor must be given access to the registry. This is the
// only outside dependency — the function otherwise reads only from state
// and economy.
function getRenderSnapshot(
  state: SimulationStateReader,
  economy: EconomyStrategy,
  registry: ComponentRegistry
): RenderSnapshot;
```

---

## Folder layout

```
src/
├── core/                        # Phase 1 frozen — simulation core
│   ├── types/
│   │   ├── ids.ts
│   │   ├── request.ts
│   │   ├── result.ts
│   │   ├── port.ts
│   │   ├── connection.ts
│   │   ├── condition.ts
│   │   └── index.ts
│   ├── capability/
│   │   ├── capability.ts
│   │   ├── process-context.ts
│   │   ├── engine-interfaces.ts
│   │   └── index.ts
│   ├── component/
│   │   ├── component.ts
│   │   ├── effective-tier.ts
│   │   └── index.ts
│   ├── state/
│   │   ├── simulation-state.ts
│   │   ├── state-reader.ts
│   │   └── index.ts
│   ├── engine/
│   │   ├── engine.ts
│   │   ├── tick-steps/
│   │   │   ├── inject-traffic.ts
│   │   │   ├── re-emit-queued.ts
│   │   │   ├── process-pending.ts
│   │   │   ├── deliver-results.ts
│   │   │   ├── update-active-streams.ts
│   │   │   ├── check-ttl.ts
│   │   │   ├── update-condition.ts
│   │   │   ├── inject-chaos.ts
│   │   │   ├── deduct-upkeep.ts
│   │   │   ├── record-metrics.ts
│   │   │   └── reset-per-tick-state.ts
│   │   ├── condition-effects.ts
│   │   ├── chaos-effects.ts
│   │   ├── condition-tier.ts
│   │   ├── response-transport.ts
│   │   ├── per-component-counters.ts
│   │   ├── throughput-gate.ts
│   │   ├── visitation-order.ts
│   │   └── rng.ts
│   ├── registry/
│   │   ├── capability-registry.ts
│   │   ├── component-registry.ts
│   │   └── index.ts
│   ├── mode/                    # Interfaces only — no implementations in Phase 1
│   │   ├── mode-controller.ts
│   │   ├── economy-strategy.ts
│   │   ├── traffic-source.ts
│   │   ├── composite-traffic-source.ts
│   │   ├── mode-definition.ts
│   │   └── index.ts
│   └── CLAUDE.md                # "Phase 1 frozen" marker
│
├── capabilities/                # Phase 1 frozen — all capability implementations
│   ├── processing/
│   │   ├── processing-capability.ts
│   │   ├── storage-capability.ts
│   │   ├── caching-capability.ts
│   │   ├── blob-storage-capability.ts
│   │   ├── search-capability.ts
│   │   ├── streaming-capability.ts
│   │   └── batch-processing-capability.ts
│   ├── routing/
│   │   ├── routing-capability.ts
│   │   ├── filter-capability.ts
│   │   └── geo-routing-capability.ts
│   ├── security/
│   │   ├── auth-capability.ts
│   │   ├── rate-limit-capability.ts
│   │   ├── ssl-termination-capability.ts
│   │   └── compression-capability.ts
│   ├── resilience/
│   │   ├── circuit-breaker-capability.ts
│   │   ├── retry-capability.ts
│   │   └── auto-scale-capability.ts
│   ├── discovery/
│   │   └── registration-capability.ts
│   ├── queue/
│   │   └── queue-capability.ts
│   ├── replication/
│   │   ├── replication-capability.ts
│   │   └── sharding-capability.ts
│   ├── shared/
│   │   ├── monitoring-capability.ts
│   │   ├── health-check-capability.ts
│   │   └── logging-capability.ts
│   ├── index.ts                 # Re-exports all + registration side effects
│   └── CLAUDE.md
│
├── components/                  # Phase 1 frozen — all component registry entries
│   ├── client.ts
│   ├── server.ts
│   ├── database.ts
│   ├── cache.ts
│   ├── load-balancer.ts
│   ├── queue.ts
│   ├── cdn.ts
│   ├── api-gateway.ts
│   ├── service-registry.ts
│   ├── worker.ts
│   ├── circuit-breaker.ts
│   ├── dns-gtm.ts
│   ├── blob-storage.ts
│   ├── streaming-media-server.ts
│   ├── index.ts
│   └── CLAUDE.md
│
├── render/                      # Phase 1 frozen — sim-to-renderer bridge
│   ├── snapshot.ts
│   ├── index.ts
│   └── CLAUDE.md
│
├── ui/
│   ├── board/                   # Phase 1 frozen — Pixi board
│   │   ├── Board.tsx
│   │   ├── pixi-board.ts
│   │   ├── placement-tool.ts
│   │   └── CLAUDE.md
│   ├── chrome/                  # Phase 1 frozen — React chrome
│   │   ├── Palette.tsx
│   │   ├── Inspector.tsx
│   │   ├── HudBar.tsx           # Has a modeSlot prop
│   │   ├── TickControls.tsx
│   │   ├── DiagnosticsPanel.tsx
│   │   └── CLAUDE.md
│   ├── store.ts                 # Zustand store — Phase 1 frozen
│   └── App.tsx                  # Root — Phase 1 frozen
│
├── modes/
│   ├── CLAUDE.md                # "Each subfolder is owned by exactly one agent"
│   ├── example/                 # Phase 1 frozen — reference implementation
│   │   ├── example-mode-controller.ts
│   │   ├── example-economy.ts
│   │   ├── example-traffic-source.ts
│   │   ├── ui/
│   │   │   └── example-hud-slot.tsx
│   │   ├── index.ts
│   │   └── CLAUDE.md            # "Copy this folder, do not modify it"
│   ├── td/                      # Phase 2 — TD agent owns this
│   │   └── CLAUDE.md            # "Owned by TD agent. Other agents do not read or modify."
│   └── sandbox/                 # Phase 2 — Sandbox agent owns this
│       └── CLAUDE.md            # "Owned by Sandbox agent. Other agents do not read or modify."
│
└── main.ts

tests/
├── harness/
│   ├── fixtures.ts
│   ├── assertions.ts
│   └── trace.ts
├── integration/
│   ├── cache-hit-flow.test.ts
│   ├── backpressure-to-queue.test.ts
│   ├── circuit-breaker-trip.test.ts
│   ├── mode-swap.test.ts        # Proves the seam is clean
│   └── ...
└── unit/
    ├── caching-capability.test.ts
    └── ...

docs/
├── phase-2-onboarding.md        # Numbered task list for Phase 2 agents
└── superpowers/
    └── specs/
        └── 2026-04-10-tower-defense-foundation-design.md  # This doc
```

### Import boundary enforcement

`eslint.config.js` uses `import/no-restricted-paths` (or equivalent) to enforce:

- `src/modes/*/**` may import from: `src/core/**`, `src/capabilities/**`, `src/components/**`, `src/render/**`, and its own mode folder only
- `src/modes/td/**` may NOT import `src/modes/sandbox/**` and vice versa
- `src/capabilities/**` and `src/components/**` may NOT import from `src/modes/**`
- `src/core/**` may NOT import from `src/capabilities/**`, `src/components/**`, `src/modes/**`, or `src/ui/**`

TypeScript is configured strict: `strict: true`, `noImplicitAny: true`, `exactOptionalPropertyTypes: true`.

---

## Build order (stages)

### Stage 1 — Core types + engine skeleton

1. Core value types: Request, RequestEvent, Port, Connection, ProcessResult, PrimaryOutcome, SideEffect, ConditionEffect, branded IDs, Phase
2. `Capability` interface + all four sub-interfaces
3. `ProcessContext` + `DeterministicRng`
4. `Component` class — constructor, `getPlayerTier`, pipeline runner skeleton, `ComponentReader` interface, and the standalone `getEffectiveTier` + `computeEffectiveTiers` functions in `src/core/component/effective-tier.ts`
5. `SimulationState` + `SimulationStateReader`
6. `CapabilityRegistry` + `ComponentRegistry` with registration-time validation
7. Abstract `ModeController`, `EconomyStrategy`, `TrafficSource`, `ModeDefinition` interfaces
8. Stub `ProcessingCapability` (always PASS)
9. Stub implementations for the Phase 1 test harness (live under `tests/harness/` so they never ship to production):
   - `NoOpModeController` — implements `ModeController`, returns empty constraints, no tier caps, a no-op economy, and a single `FixedIntensityTrafficSource`
   - `NoOpEconomy` — implements `EconomyStrategy`, all debits are no-ops, `getBudget()` returns `Infinity`, `resolveInsolvency()` returns `[]`
   - `FixedIntensityTrafficSource` — implements `TrafficSource`. Constructor takes `{ targetEntryPointId, intensity, requestType }`. `generate(tick)` returns an array of `intensity` requests of the given type with sequential IDs, `ttl: 10`, no zone, no streaming properties. Used for deterministic integration tests.
10. First integration test: place Client + Server, wire them, inject 10 requests, run 5 ticks, assert RequestLog contents

**Exit criterion:** The smoke-test integration test passes. Every core interface is committed and exported.

### Stage 2 — Engine mechanics

11. Pipeline phase iteration (INTERCEPT → PROCESS → REPLICATE → OBSERVE)
12. Tick step 1 (INJECT TRAFFIC) — real implementation
13. Tick step 3 (PROCESS PENDING) — fixed-point loop (item B6) + visitation order
14. Tick step 4 (DELIVER RESULTS) — backpressure routing via `EngineBufferable`, SPAWN handling, blocking vs non-blocking children
15. Tick step 5 (CHECK TTL) — with recursive child timeout
16. Tick step 7 (DEDUCT UPKEEP) — calls `EconomyStrategy`
17. Tick steps 8, 9, 10 (metrics, reset per-tick state, advance)
18. Throughput gate (item B1) including `OVERLOADED` event distinct from `BACKPRESSURED`
19. `applyConditionEffects` helper (item B4) + tick step 6 (UPDATE CONDITION)
20. Integration tests: TTL drop, backpressure-to-queue, throughput-gate saturation, condition degradation drop, cache-hit short-circuit, cycle-between-two-components termination

**Exit criterion:** All tick steps implemented. All Stage 2 integration tests green. No further changes to `ProcessContext` or core interfaces permitted after this point — if they need to change, that's a Stage 1 regression.

### Stage 3 — Capabilities + components

Build in this order so each capability exercises a new engine feature:

1. `ProcessingCapability`, `StorageCapability`, `MonitoringCapability` → Server + Database
2. `CachingCapability` → Cache (first INTERCEPT RESPOND/FORWARD)
3. `RoutingCapability` → LoadBalancer (first EngineConsultable)
4. `FilterCapability` → CDN
5. `QueueCapability` → Queue (first EngineBufferable, exercises item B2 re-emission)
6. `BatchProcessingCapability` → Worker (first EnginePullable, item A1)
7. `AuthCapability`, `RateLimitCapability` → API Gateway
8. `CircuitBreakerCapability`, `RetryCapability` → CircuitBreaker
9. `ReplicationCapability`, `ShardingCapability` → replication flows
10. `StreamingCapability`, `BlobStorageCapability` → StreamingMediaServer + BlobStorage (first active_stream + per-tick stream revenue, item B5)
11. `GeoRoutingCapability`, `HealthCheckCapability` → DNS/GTM
12. `AutoScaleCapability` → auto-scaling via SCALE side effect
13. `RegistrationCapability` (implementing `InstanceDirectory`, item A3) → ServiceRegistry
14. `SSLTerminationCapability`, `CompressionCapability`, `LoggingCapability`, `SearchCapability` → remaining mixins

Add each component's registry entry immediately after its defining capabilities are green. Unit tests per capability. Integration tests for cross-component flows.

**Exit criterion:** All 24 capabilities + 14 components operational. Each capability has a unit test. Each component has at least one integration test demonstrating a flow it enables.

### Stage 4 — Basic UI

21. Vite + React + Pixi.js project setup
22. Zustand store holding `RenderSnapshot`
23. Pixi board — colored rectangles per component, lines per connection, arrows
24. React palette — data-driven from `ComponentRegistry`
25. Placement tool — click-to-place, drag-to-wire with port compatibility validation
26. Inspector panel — capabilities list, effective vs player tier, upgrade buttons
27. Tick controls — play, pause, step
28. HUD bar — budget, tick, phase, empty `modeSlot`
29. Request visualization — colored dots along connections
30. Diagnostics panel — reads RequestLog, shows per-request traces

**Exit criterion:** Manual placement + wiring + play works. Stub `NoOpModeController` runs. Request dots move through the topology.

### Stage 5 — Handoff prep

31. `src/modes/example/` reference implementation — complete, working, minimal
32. `tests/integration/mode-swap.test.ts` — runs engine with both `NoOpModeController` and `ExampleModeController`, asserts behavior
33. Frozen-folder `CLAUDE.md` markers in every Phase 1 directory
34. ESLint import boundaries configured and passing
35. `docs/phase-2-onboarding.md` — numbered task list for Phase 2 agents
36. Dry-run test: spawn a fresh agent session with `docs/phase-2-onboarding.md`, tell it "implement a mode called 'echo' that just echoes request counts to the HUD," confirm it completes without asking questions. If it can't, fix the onboarding doc and re-run.

**Exit criterion:** Phase 2 dry-run succeeds. Teammate agent can start Phase 2 cold.

### Risk flags for solo agentic execution

1. **Fixed-point processing loop (Stage 2 step 14).** Write the integration tests BEFORE the implementation. Required test cases: forward flow, cache hit short-circuit, backpressure to queue, queue re-emission, cycle between two components, throughput gate saturation, blocking SPAWN resolution.

2. **Condition effect application sites.** Easy to silently apply an effect in the wrong tick step and have tests still pass. Write a test that specifically counts events per component per tick at each effect application site.

3. **QueueCapability's two invocation paths.** Test proactive INTERCEPT buffering and backpressure `enqueueForRetry` separately before testing them together.

4. **Interface drift during Stage 3.** Do not start Stage 3 until Stage 2's interfaces are locked. Agent-generated capabilities against a drifting `Capability` interface produce 24 files that all need regeneration. Stage 2 exit criterion is a hard gate.

---

## Phase 2 seam

### What a Phase 2 agent implements

Exactly four things:

1. **`ModeController` interface** — `src/modes/<name>/<name>-mode-controller.ts`
2. **`EconomyStrategy` interface** — `src/modes/<name>/<name>-economy.ts`
3. **`TrafficSource`** — `src/modes/<name>/<name>-traffic-source.ts` (or a collection of them)
4. **HUD slot React component** — `src/modes/<name>/ui/<name>-hud-slot.tsx`

Plus the mode registration:

```ts
// src/modes/<name>/index.ts
export const <name>Mode: ModeDefinition = {
  id: "<name>",
  name: "...",
  description: "...",
  createController: () => new <Name>ModeController(),
  hudSlot: <Name>HudSlot,
};
```

### What a Phase 2 agent MUST NOT touch

- `src/core/**`
- `src/capabilities/**`
- `src/components/**`
- `src/render/**`
- `src/ui/board/**`
- `src/ui/chrome/**`
- `src/modes/example/**`
- `src/modes/<the other mode>/**`

ESLint blocks imports from/into these boundaries. `CLAUDE.md` markers in each folder provide the same instruction in natural language for agent comprehension.

### The mode-swap integration test

`tests/integration/mode-swap.test.ts` is the proof that the seam is clean. It combines a runtime swap with a static-source assertion:

**Runtime portion:**
1. Instantiate `SimulationState` twice with identical initial topology
2. Run one tick loop with `NoOpModeController`, one with `ExampleModeController`
3. Assert both produce valid tick outcomes and both call through the same `Engine` instance without error
4. Assert observable engine behavior is unchanged when modes are swapped (same tick counter advancement, same component visitation order, same pipeline phase order)

**Static portion (ensures "the engine never names a specific mode"):**
5. Read every `.ts` file under `src/core/`, `src/capabilities/`, and `src/components/`
6. For each file, assert there are no identifiers matching `/\b[A-Z]\w*Mode(Controller)?\b/` or `/\b[A-Z]\w*Economy\b/` EXCEPT for an explicit allowlist: `ModeController`, `ModeDefinition`, `EconomyStrategy`, `NoOpModeController`, `NoOpEconomy`. Concretely: tokenize, filter out allowlisted identifiers, assert the remaining set is empty.
7. Assert none of them import from `src/modes/` (ESLint already enforces this at build time; the test provides a second check in case the ESLint config is ever weakened)

If both portions are green, any new mode that correctly implements the four interfaces will drop into the engine without requiring core modifications.

### Phase 2 onboarding doc

`docs/phase-2-onboarding.md` is created at Stage 5 as a numbered task list for agent consumption. It tells a Phase 2 agent: which paths are frozen, that the starting task is "copy `src/modes/example/` and rename," and how to run tests. The spec does not embed its template — the doc is a deliverable, not a design artifact.

---

## Design invariants (quick reference)

- **No type checks in the engine.** Sub-interfaces (`EngineConsultable`, `EngineBufferable`, `EnginePullable`, `InstanceDirectory`) discovered structurally.
- **Closed unions have single interpretation sites.** `ConditionEffect` in `applyConditionEffects`; `ChaosEvent` in `applyChaosEvent`. Four branches each, one file each.
- **Single source of truth for state.** `SimulationState` for runtime, `getEffectiveTier` for tier, `EconomyStrategy` for budget. No dual-authority mutation paths.
- **Capabilities can only read state** — they receive `SimulationStateReader` (narrowing components to `ComponentReader`) and return `ProcessResult`. The engine applies results.
- **Phase 2 seam is four interfaces + one React slot.** No Phase 2 file modifies a Phase 1 file. Enforced by ESLint import boundaries and frozen-folder `CLAUDE.md` markers.

---

## Glossary

- **Capability:** Atomic unit of behavior. Implements `Capability` + optional engine sub-interfaces.
- **Component:** Named bundle of capabilities. Generic pipeline runner. No subclasses.
- **Pipeline phase:** One of INTERCEPT, PROCESS, REPLICATE, OBSERVE. Fixed order. Capabilities declare their phase (optional for sub-interface-only capabilities).
- **Engine sub-interface:** An opt-in interface a capability can implement to interact with the engine beyond the standard pipeline. `EngineConsultable`, `EngineBufferable`, `EnginePullable`, `InstanceDirectory`.
- **Effective tier:** `min(playerTier, modeTierCap)`. Computed by the standalone `getEffectiveTier` function in `src/core/component/effective-tier.ts`. The ONLY valid tier value for any call site.
- **Visitation order:** Stable-per-wave ordering of components, used by the fixed-point loop in tick step 3. Sorted by `(zone, placementTick, componentId)`.
- **Condition effect:** A structured effect applied by the engine when a component is degraded or critical. Closed discriminated union, interpreted only by `applyConditionEffects`.
- **SimulationState:** The single source of truth for all mutable runtime state.
- **RenderSnapshot:** Pure data shape extracted from `SimulationState` for the renderer.
- **The seam:** The four-file boundary between Phase 1 and Phase 2 work: `ModeController`, `EconomyStrategy`, `TrafficSource`, HUD slot.

---

*End of design document.*

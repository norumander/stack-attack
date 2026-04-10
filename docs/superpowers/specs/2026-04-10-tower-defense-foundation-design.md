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

An adversarial audit of the existing architecture found 13 issues ranging from contract violations to missing mechanics. All 13 are resolved in this design. Implementers should treat this document as authoritative where it conflicts with `component-architecture.md`.

### A1 — `EnginePullable` sub-interface replaces Worker+Queue type coupling

**Problem:** The tick loop previously named `BatchProcessingCapability` explicitly when describing how Workers pull from Queues, violating the "no type checks in the engine" principle.

**Resolution:** Introduce a new engine sub-interface alongside `EngineConsultable`, `EngineBufferable`, and `InstanceDirectory`:

```ts
interface EnginePullable {
  // Called by the engine in tick step 2 (RE-EMIT QUEUED).
  // Returns requests this capability wants to pull from upstream sources
  // (typically connected Queues via EngineBufferable.dequeueBatch)
  // to inject into its own component's pending pipeline this tick.
  pullPending(context: PullContext): Request[];
}
```

`BatchProcessingCapability` implements `EnginePullable`. Inside `pullPending()`, it inspects its component's ingress connections, locates any capability on the far side implementing `EngineBufferable`, and calls the new `dequeueBatch(n)` method on it. The engine never names either capability.

This pattern also supports future components that need periodic activation (cron triggers, external pollers) without engine modification.

### A2 — `ConditionEffect` as discriminated union

**Problem:** The condition profile previously stored effects as opaque strings (`"latency_bonus_50pct"`, `"random_drop_20pct"`). Something had to interpret those strings, which would become an implicit hardcoded switch in the engine — exactly the switch statement the architecture forbids.

**Resolution:** Effects are a closed discriminated union. Each component registry entry declares effects as structured data, and the engine applies them at four documented sites.

```ts
type ConditionEffect =
  | { kind: "latency_multiplier"; factor: number }
  | { kind: "drop_probability"; p: number }
  | { kind: "throughput_multiplier"; factor: number }
  | { kind: "upkeep_multiplier"; factor: number };

interface ConditionProfile {
  degradedThreshold: number;
  criticalThreshold: number;
  decayRate: number;
  recoveryRate: number;
  triggerWindow: number;
  degradedEffects: ConditionEffect[];
  criticalEffects: ConditionEffect[];
}
```

The engine has exactly four `if (effect.kind === ...)` branches, co-located in a single `applyConditionEffects` helper (see item B4 for sites). Adding a new effect kind is a 5-line change in one file.

### A3 — `InstanceDirectory` sub-interface + informational ServiceRegistry

**Problem:** The doc previously said "the engine checks whether a ServiceRegistry exists in the topology" — another hidden type check. Additionally, the "auto-register becomes a routing target" story was incoherent because connections are player-wired and no mechanism was defined for dynamic wiring.

**Resolution — two parts:**

**Discovery via interface:**
```ts
interface InstanceDirectory {
  listCandidates(query: {
    componentType?: string;
    zone?: string;
    healthyOnly?: boolean;
  }): ComponentRef[];
}
```

`RegistrationCapability` (on the ServiceRegistry component) implements `InstanceDirectory`. When the engine constructs a `ProcessContext` for an `EngineConsultable.selectConnection()` call, it collects all capabilities implementing `InstanceDirectory` from the topology and exposes them via `context.directories`. Routing capabilities query them if they want health or zone filtering. No type checks.

**Routing model:** ServiceRegistry is purely **informational**. It filters existing player-wired connections based on health and zone — it does not create phantom connections. New component instances become routing targets by being registered and reported as healthy, not by implicit wiring. This keeps the topology honest: what the player wires is what exists. The teaching moment — "service discovery tells your routers which wired targets are alive and nearby" — is closer to how Eureka actually behaves.

### B1 — Throughput gate via `getThroughputPerTick()`

**Problem:** The doc said `instanceCount: 3` meant 3× processing throughput, but the tick loop had no per-component capacity gate. `instanceCount` was only multiplying upkeep cost, not throughput. Horizontal scaling had no benefit. The entire auto-scaling lesson collapsed.

**Resolution:**

1. PROCESS-phase capabilities declare per-tier throughput via an optional new method:
   ```ts
   interface Capability {
     // ...
     getThroughputPerTick?(tier: number): number;
   }
   ```

2. `Component` derives effective throughput:
   ```
   Component.getThroughputPerTick() =
     sum of active PROCESS-phase capabilities' getThroughputPerTick(effectiveTier)
     × instanceCount
     × conditionEffect("throughput_multiplier", default 1.0)
   ```

3. Tick step 3 enforces the gate. The engine tracks `requestsProcessedThisTick` per component (reset in step 9). Before processing, it checks the gate. If at capacity, the engine treats it like a bandwidth rejection: routes to `EngineBufferable.enqueueForRetry()` if present, else drops with a new event type `OVERLOADED`.

4. `OVERLOADED` is distinct from `BACKPRESSURED` so the diagnostics screen can tell the player whether their components are saturated or their wires are.

5. INTERCEPT-only components (Cache, LoadBalancer, CDN) return `Infinity` from `getThroughputPerTick()`. They are gated by their connection bandwidths, not their own throughput. This matches reality: a load balancer's limit is its NIC, not its CPU.

`AutoScaleCapability` now has a real signal to scale against: `requestsProcessedThisTick / getThroughputPerTick()`.

### B2 — Re-emitted request identification without mutating Request

**Problem:** `QueueCapability`'s proactive buffering requires re-emitted requests to be recognized on re-entry (so the Queue doesn't infinitely re-hold them). Requests are declared immutable creation snapshots, so there's no place to store a "re-emitted" flag.

**Resolution:** `QueueCapability` tracks re-emission internally, per-tick.

```ts
class QueueCapability implements Capability, EngineBufferable {
  private awaitingPipeline: Map<RequestId, Request>;
  private awaitingDelivery: Map<RequestId, { request: Request; result: ProcessResult }>;
  private justReEmittedThisTick: Set<RequestId>;

  emitReady(): { awaitingPipeline: Request[]; awaitingDelivery: ... } {
    const pipelineReady = [...this.awaitingPipeline.values()];
    pipelineReady.forEach(r => this.justReEmittedThisTick.add(r.id));
    this.awaitingPipeline.clear();
    // ...
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    if (this.justReEmittedThisTick.has(request.id)) {
      return { outcome: PASS };
    }
    // Otherwise decide hold or pass based on queue policy
  }

  resetPerTickState() {
    this.justReEmittedThisTick.clear();
  }
}
```

**New contract addition:** `Capability.resetPerTickState?(): void`. The engine calls it in tick step 9 on every capability that implements it. Future per-tick-stateful capabilities (rate limit windows, token buckets) can use the same hook.

Request remains immutable. The re-emission tag lives entirely in the Queue's own operational state.

### B3 — EntryPoint (Client) is a normal Component

**Problem:** `EntryPoint` was mentioned once as "a special ingress-only component" but had no registry entry, no ports, no capabilities, and no multi-zone story.

**Resolution:** The Client (EntryPoint) is a normal Component with a registry entry. It has only an egress port — the engine injects traffic into it via the TrafficSource, not via an ingress connection. Auto-placement vs player-placement is a per-level ModeController decision, not an engine or registry constraint.

Registry entry outline:
```
Client:
  name: "Client"
  description: "Where user traffic enters your system."
  capabilities:
    - MonitoringCapability (default tier: 1, max tier: 1, phase: OBSERVE)
  ports:
    - egress: { dataType: "http", capacity: 1 }
  placementCost: 0
  upgradeCostCurve: []
```

**TrafficSource injection contract:**
```ts
interface TrafficSource {
  generate(tick: number): Request[];
  targetEntryPointId: ComponentId;
}
```

Single-zone: one Client, TrafficSource targets it. Multi-zone: one Client per zone, a `CompositeTrafficSource` (shipped in Phase 1 as a mode-agnostic utility) wraps one sub-source per zone, each targeting its own zone's Client. When the player places a DNS/GTM, the ModeController redirects the TrafficSource to target the DNS/GTM instead — DNS/GTM's `GeoRoutingCapability` then routes to the right zone's Client via its egress connections.

The engine has no special case for Client. It's just a Component with no ingress port.

### B4 — Condition effect application sites

**Problem:** Even with `ConditionEffect` as a typed union, we still needed to specify *where* in the tick each effect applies.

**Resolution:** Every effect kind has exactly one application site. All four sites live in a single `applyConditionEffects` helper in `src/core/engine/condition-effects.ts`. Nothing else in the engine interprets condition effects.

| Effect | Site |
|---|---|
| `drop_probability` | Tick step 3, pre-pipeline, per request. Engine rolls a seeded RNG (tick + componentId + requestId). On hit, short-circuits with a `DROPPED` event tagged `reason: "condition_degraded"`. Pipeline never runs. |
| `throughput_multiplier` | Tick step 3, capacity gate. Folds into `Component.getThroughputPerTick()` computation. |
| `latency_multiplier` | Tick step 3, post-pipeline. Engine multiplies `latencyAdded` on events originating at the component before appending to RequestLog. |
| `upkeep_multiplier` | Tick step 7, upkeep deduction. Engine multiplies `Component.getUpkeepCost()` before handing it to `EconomyStrategy.debitUpkeep()`. |

**Determinism rule:** The RNG used for `drop_probability` is seeded with `(currentTick, componentId, requestId)`. Same inputs always produce the same result. This is critical for replay.

### B5 — Stream revenue credited per-tick in step 4b

**Problem:** The `stream` request type has "per-tick revenue while active," but no tick step specified where per-tick revenue is credited.

**Resolution:** Tick step 4b (UPDATE ACTIVE STREAMS) credits stream revenue once per active stream per tick:

```
4b. UPDATE ACTIVE STREAMS
    For each active_stream request:
      - Decrement remaining streamDuration by 1
      - Credit baseRevenue for this tick via modeController.economy.creditRevenue()
      - If streamDuration reaches 0, complete the stream (release bandwidth,
        append RESPONDED event)
      - If the connection is overloaded and StreamingCapability is adaptive,
        degrade stream bandwidth instead of dropping
```

Rationale: aligns with the "earn while your architecture holds; stop earning when it breaks" feedback loop. Mid-stream failure visibly costs money. Matches Netflix's per-minute economics.

### B6 — Fixed-point processing loop replaces undefined topological order

**Problem:** The tick loop said step 3 processes requests "in topological order — upstream first," but the component graph has cycles (retries, cache write-back, circuit-breaker probes). Topological order doesn't exist for cyclic graphs.

**Resolution:**

1. **Visitation order is stable per wave.** Computed once at the start of the simulate phase as a deterministic sort of `SimulationState.components` by `(zone, placementTick, componentId)`. Doesn't change during the wave.

2. **Tick step 3 runs as a fixed-point loop:**
   ```
   loop:
     progressed = false
     for each component in visitation order:
       while component.pending is non-empty AND throughput-gate allows:
         process one request from component.pending
         deliver result (FORWARD/SPAWN may add to another component's pending)
         progressed = true
     if not progressed: break
     if iterationCount > componentCount × 4: warn + break  // safety cap
   ```

3. Cycles terminate because either (a) throughput gates saturate, (b) TTL expires, (c) a capability short-circuits with RESPOND/DROP/QUEUE_HOLD.

4. The phrase "topological order" is removed from all documentation. The correct term is "visitation order (stable per wave)."

### C1 — `SimulationState` as single source of truth

**Problem:** Nothing in the existing docs declared who owns the list of placed components and connections. Tick step 7 implied the engine; `getBuildConstraints()` implied the ModeController. Ambiguous ownership is the number-one risk for parallel work at the Phase 2 seam.

**Resolution:** Introduce an explicit `SimulationState` class that is the single source of truth for all mutable runtime state.

```ts
class SimulationState {
  readonly components: Map<ComponentId, Component>;
  readonly connections: Map<ConnectionId, Connection>;
  readonly pending: Map<ComponentId, Request[]>;
  readonly activeStreams: Map<RequestId, ActiveStream>;
  readonly requestLog: Map<RequestId, RequestEvent[]>;
  currentTick: number;
  phase: "build" | "simulate" | "assess";
  requestsProcessedThisTick: Map<ComponentId, number>;
  connectionLoadThisTick: Map<ConnectionId, number>;

  // Explicit mutators — no direct Map access from outside
  placeComponent(c: Component): void;
  removeComponent(id: ComponentId): void;
  addConnection(c: Connection): void;
  // ...
}
```

**Ownership rules:**
- `SimulationState` owns topology and runtime state. Passive data container.
- **Engine** mutates `SimulationState` during tick execution only.
- **ModeController** mutates its own economy (via `EconomyStrategy`) and the build-phase topology (via `tryPlace`, `tryUpgrade`). Never touches per-tick runtime state.
- **Capabilities** get read-only `SimulationStateReader` via `ProcessContext`. They never mutate state directly — they produce `ProcessResult`, the engine applies it.

The engine's tick step 3 no longer calls `Component.process()` directly. Instead:
```
engine.processComponentTick(state, component):
  1. Apply condition pre-filters (drop_probability)
  2. Enforce throughput gate
  3. Run component.process(request, context)
  4. Write events and side effects back to SimulationState
```

`Component` stays thin — pipeline runner only. It does not directly access `SimulationState`.

### C2 — `Capability.phase` is optional

**Problem:** The interface declared `phase` as required, but `RoutingCapability` and `GeoRoutingCapability` omit it because they're only invoked via `EngineConsultable.selectConnection()` after the pipeline runs. Direct contract violation.

**Resolution:** `phase` is optional. Capabilities are either **pipeline capabilities** (phase set, participate in `Component.process()`) or **sub-interface-only capabilities** (phase omitted, only invoked via engine sub-interfaces). A capability can be both.

```ts
type Phase = "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE";

interface Capability {
  readonly id: string;
  readonly phase?: Phase;
  // ... rest
}
```

**Pipeline runner rule:** `Component.process()` iterates only capabilities where `phase` is defined. Phaseless capabilities are never called by the pipeline.

**Registry validation rule:** At component registration, a capability must either have `phase` OR implement at least one engine sub-interface. A capability with neither throws a registration error at load time.

### C3 — `Component.getEffectiveTier()` is the single source of tier truth

**Problem:** Two authorities decide tier: `capabilityTiers[id]` (player upgrade) and `ModeController.getTierCap()` (mode cap). If any call site computes `min()` its own way, tiers drift.

**Resolution:**

```ts
class Component {
  private capabilityTiers: Map<CapabilityId, number>;  // private, no getter

  getEffectiveTier(capabilityId: CapabilityId): number {
    const playerTier = this.capabilityTiers.get(capabilityId) ?? 0;
    const modeCap = this.modeController.getTierCap(this, capabilityId);
    return Math.min(playerTier, modeCap);
  }
}
```

**Rule:** Every site that uses tier calls `getEffectiveTier`. No direct access to `capabilityTiers`. Enforced by making the field private with no getter. The only public read path is `getEffectiveTier`.

**Call sites that must use it:**
1. Pipeline runner (passes `effectiveTier` to `capability.process()`)
2. Upkeep calculation (`capability.getUpkeepCost(effectiveTier)`)
3. Throughput gate (`capability.getThroughputPerTick(effectiveTier)`)
4. UI upgrade panel (shows both `playerTier` and `effectiveTier` as a teaching signal)
5. Renderer (picks visual based on effective tier)
6. Diagnostics screen

**New ModeController method:**
```ts
interface ModeController {
  // ...
  getTierCap(component: Component, capabilityId: CapabilityId): number;
  // Returns Infinity if no cap
}
```

SandboxModeController always returns `Infinity`. TDModeController returns per-wave caps.

### C5 — Extract `EconomyStrategy` from day 1

**Problem:** The doc flagged this as a future refactor. Deferring it couples economy logic to ModeController and forces the Sandbox developer to untangle it later.

**Resolution:** Extract on day 1.

```ts
interface EconomyStrategy {
  getBudget(): number;
  canAfford(cost: number): boolean;
  creditRevenue(request: Request, amount: number): void;
  debitUpkeep(totalUpkeep: number): void;
  debitPlacement(component: Component): void;
  debitUpgrade(component: Component, capabilityId: CapabilityId): void;
  resolveInsolvency(state: SimulationStateReader): ComponentId[];
}
```

**Ownership:**
- `ModeController` owns one `EconomyStrategy` instance via `modeController.economy`.
- Engine reads/writes economy through the strategy only. Never through the ModeController directly.
- Tick step 7 becomes:
  ```
  const totalUpkeep = sumUpkeep(state.components);
  modeController.economy.debitUpkeep(totalUpkeep);
  const insolvent = modeController.economy.resolveInsolvency(state);
  for (const id of insolvent) applyInsolvencyDegradation(id);
  ```
- Build-phase placement: `modeController.tryPlace(type, position)` internally calls `economy.canAfford()` then `economy.debitPlacement()`.
- Capabilities never touch economy. They produce events; the engine credits revenue in step 4a (one-shot) or 4b (per-tick for streams).

**Phase 1 ships only the interface.** `TDEconomy` and `SandboxEconomy` are Phase 2.

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
  degradedThreshold: number;
  criticalThreshold: number;
  decayRate: number;
  recoveryRate: number;
  triggerWindow: number;
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
  readonly effectiveTier: number;
  readonly currentTick: number;
  readonly rng: DeterministicRng;  // seeded per (tick, componentId, requestId)
  readonly directories: InstanceDirectory[];  // from item A3
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
  enqueueForRetry(request: Request, result: ProcessResult): boolean;
  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  };
  dequeueBatch(n: number): Request[];  // called by EnginePullable holders
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

interface ComponentRef {
  readonly componentId: ComponentId;
  readonly componentType: string;
  readonly zone: string | null;
  readonly condition: number;
}
```

### Component class

```ts
// src/core/component/component.ts
class Component {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: Map<CapabilityId, Capability>;
  private capabilityTiers: Map<CapabilityId, number>;  // private — item C3
  readonly ports: Port[];
  readonly placementCost: number;
  position: { x: number; y: number };
  zone: string | null;
  instanceCount: number;
  condition: number;

  constructor(config: ComponentConstructorArgs);

  // THE ONLY public tier read path — item C3
  getEffectiveTier(capabilityId: CapabilityId): number;

  getCapabilitiesByPhase(phase: Phase): Capability[];
  getCapabilityByInterface<T>(iface: SubInterfaceTag): T | null;

  getThroughputPerTick(): number;  // item B1
  getUpkeepCost(): number;

  process(request: Request, context: ProcessContext): ProcessResult;
  upgrade(capabilityId: CapabilityId): void;
  resetPerTickState(): void;  // item B2 — iterates all capabilities
}
```

### SimulationState

```ts
// src/core/state/simulation-state.ts
class SimulationState {
  readonly components: ReadonlyMap<ComponentId, Component>;
  readonly connections: ReadonlyMap<ConnectionId, Connection>;
  readonly pending: ReadonlyMap<ComponentId, Request[]>;
  readonly activeStreams: ReadonlyMap<RequestId, ActiveStream>;
  readonly requestLog: ReadonlyMap<RequestId, RequestEvent[]>;
  currentTick: number;
  phase: "build" | "simulate" | "assess";
  requestsProcessedThisTick: ReadonlyMap<ComponentId, number>;
  connectionLoadThisTick: ReadonlyMap<ConnectionId, number>;

  // Mutators — only these change state
  placeComponent(c: Component): void;
  removeComponent(id: ComponentId): void;
  addConnection(c: Connection): void;
  removeConnection(id: ConnectionId): void;
  appendEvent(requestId: RequestId, event: RequestEvent): void;
  enqueuePending(componentId: ComponentId, request: Request): void;
  // ... etc
}

// src/core/state/state-reader.ts
interface SimulationStateReader {
  readonly components: ReadonlyMap<ComponentId, Component>;
  readonly connections: ReadonlyMap<ConnectionId, Connection>;
  readonly currentTick: number;
  getEventsFor(requestId: RequestId): readonly RequestEvent[];
  // No mutators
}
```

### Registry types

```ts
// src/core/registry/capability-registry.ts
interface CapabilityRegistryEntry {
  id: CapabilityId;
  factory: () => Capability;
  implementsSubInterfaces: SubInterfaceTag[];
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

  // Each private method corresponds to a numbered tick step
  private injectTraffic(state, modeController): void;         // step 1
  private reEmitQueued(state): void;                           // step 2
  private processPending(state, modeController): void;        // step 3 (fixed-point loop)
  private deliverResults(state, results): void;               // step 4
  private updateActiveStreams(state, modeController): void;   // step 4b (per-tick stream revenue)
  private checkTtl(state): void;                               // step 5
  private updateCondition(state): void;                       // step 6
  private injectChaos(state, modeController): void;           // step 6b
  private deductUpkeep(state, modeController): void;          // step 7
  private recordMetrics(state): void;                         // step 8
  private resetPerTickState(state): void;                     // step 9
  private advanceTick(state, modeController): void;           // step 10
}

// src/core/engine/condition-effects.ts
// The ONLY place ConditionEffect kinds are interpreted
function applyConditionEffects(
  component: Component,
  phase: "pre_process" | "throughput_gate" | "post_process_event" | "upkeep",
  input: unknown,
  ctx: { rng: DeterministicRng; currentTick: number; requestId?: RequestId }
): unknown;
```

### Mode and economy interfaces (abstract only in Phase 1)

```ts
// src/core/mode/mode-controller.ts
interface ModeController {
  readonly economy: EconomyStrategy;

  getActiveCapabilities(component: Component): Set<CapabilityId>;
  getTierCap(component: Component, capabilityId: CapabilityId): number;
  getBuildConstraints(): BuildConstraints;
  getTrafficSource(): TrafficSource;
  evaluateOutcome(metrics: TickMetrics[]): OutcomeReport;
  getPhase(): "build" | "simulate" | "assess";
  advancePhase(): void;

  tryPlace(type: string, position: Position, zone: string | null): PlacementResult;
  tryUpgrade(componentId: ComponentId, capabilityId: CapabilityId): UpgradeResult;

  // Chaos injection — called by engine in step 6b
  getScheduledChaos(currentTick: number): ChaosEvent[];
}

// src/core/mode/economy-strategy.ts
interface EconomyStrategy {
  getBudget(): number;
  canAfford(cost: number): boolean;
  creditRevenue(request: Request, amount: number): void;
  debitUpkeep(totalUpkeep: number): void;
  debitPlacement(component: Component): void;
  debitUpgrade(component: Component, capabilityId: CapabilityId): void;
  resolveInsolvency(state: SimulationStateReader): ComponentId[];
}

// src/core/mode/traffic-source.ts
interface TrafficSource {
  readonly targetEntryPointId: ComponentId;
  generate(tick: number): Request[];
}

// src/core/mode/composite-traffic-source.ts
// Mode-agnostic utility: wraps N sub-sources, one per entry point
class CompositeTrafficSource implements TrafficSource {
  constructor(sources: TrafficSource[]);
  // targetEntryPointId throws — use sub-sources
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

function getRenderSnapshot(state: SimulationStateReader, economy: EconomyStrategy): RenderSnapshot;
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
4. `Component` class — constructor, `getEffectiveTier`, pipeline runner skeleton
5. `SimulationState` + `SimulationStateReader`
6. `CapabilityRegistry` + `ComponentRegistry` with registration-time validation
7. Abstract `ModeController`, `EconomyStrategy`, `TrafficSource`, `ModeDefinition` interfaces
8. Stub `ProcessingCapability` (always PASS)
9. Stub `NoOpModeController` + `NoOpEconomy` + `FixedIntensityTrafficSource`
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

`tests/integration/mode-swap.test.ts` is the proof that the seam is clean:

1. Instantiate `SimulationState` twice with identical initial topology
2. Run one tick loop with `NoOpModeController`, one with `ExampleModeController`
3. Assert both produce valid (though different) tick outcomes
4. Assert the engine never named either mode explicitly

If this test is green, any new mode that correctly implements the four interfaces will drop into the engine without requiring core modifications.

### Phase 2 onboarding doc format

`docs/phase-2-onboarding.md` is written as a numbered task list optimized for agent consumption, not prose for humans. Structure:

```
# Phase 2 Onboarding — Implementing a New Mode

You are an agent building [TD mode | Sandbox mode | other].

## Do not modify:
- <list of frozen paths>

## Task list:
1. Copy src/modes/example/ to src/modes/<yourmode>/
2. Rename all files and class names
3. Implement <yourmode>-mode-controller.ts — see "ModeController contract"
4. Implement <yourmode>-economy.ts — see "EconomyStrategy contract"
5. Implement <yourmode>-traffic-source.ts — see "TrafficSource contract"
6. Implement ui/<yourmode>-hud-slot.tsx
7. Register in src/app-root.tsx
8. Run npm test — all tests must pass
9. Run npm run dev — verify basic gameplay

## ModeController contract
[Per-method signatures, invariants, one-line examples]

## EconomyStrategy contract
[Same structure]

## TrafficSource contract
[Same structure]

## When to stop and ask the human
- You need to modify any file in "Do not modify"
- A test in tests/integration/ that isn't under your mode is failing
- ESLint is blocking an import that seems necessary
- Example mode tests fail without you touching src/modes/example/
```

---

## What this design prevents

- **God class.** Engine knows `Component`, `Capability`, `Connection`, `Request`, `SimulationState`. Nothing else. All 14 components interchangeable.
- **Switch statement.** Engine uses sub-interfaces (`EngineConsultable`, `EngineBufferable`, `EnginePullable`, `InstanceDirectory`) instead of type checks. `ConditionEffect` is a closed union with exactly one interpretation site.
- **Refactor cascade.** Adding a component is a registry entry. Adding a capability is an interface implementation. Adding an effect kind is 5 lines in one file. None of these modify the engine.
- **Mode coupling.** `ModeController`, `EconomyStrategy`, and `TrafficSource` are abstract interfaces in Phase 1. The engine only calls through them. Modes never see each other.
- **Rendering coupling.** Simulation produces `SimulationState`. `getRenderSnapshot()` extracts a pure data shape. Renderer reads the snapshot. Sim and renderer never call each other.
- **Ownership ambiguity.** `SimulationState` is the single source of truth for runtime state. `Component.getEffectiveTier()` is the single source for tier. `applyConditionEffects` is the single interpreter of effects. `EconomyStrategy` is the single economy. No dual-authority bugs.
- **Tier drift.** `capabilityTiers` is private. All call sites go through `getEffectiveTier`.
- **Immutable request mutations.** `Request` stays immutable. Per-tick state that looks like request metadata (re-emission flags) lives in the capability that owns the state.
- **Parallel-work collisions.** Phase 2 agents work in isolated subfolders enforced by ESLint and `CLAUDE.md` markers. Zero merge surface after Phase 1.

---

## Glossary

- **Capability:** Atomic unit of behavior. Implements `Capability` + optional engine sub-interfaces.
- **Component:** Named bundle of capabilities. Generic pipeline runner. No subclasses.
- **Pipeline phase:** One of INTERCEPT, PROCESS, REPLICATE, OBSERVE. Fixed order. Capabilities declare their phase (optional for sub-interface-only capabilities).
- **Engine sub-interface:** An opt-in interface a capability can implement to interact with the engine beyond the standard pipeline. `EngineConsultable`, `EngineBufferable`, `EnginePullable`, `InstanceDirectory`.
- **Effective tier:** `min(playerTier, modeTierCap)`. Computed by `Component.getEffectiveTier()`. The ONLY valid tier value for any call site.
- **Visitation order:** Stable-per-wave ordering of components, used by the fixed-point loop in tick step 3. Sorted by `(zone, placementTick, componentId)`.
- **Condition effect:** A structured effect applied by the engine when a component is degraded or critical. Closed discriminated union, interpreted only by `applyConditionEffects`.
- **SimulationState:** The single source of truth for all mutable runtime state.
- **RenderSnapshot:** Pure data shape extracted from `SimulationState` for the renderer.
- **The seam:** The four-file boundary between Phase 1 and Phase 2 work: `ModeController`, `EconomyStrategy`, `TrafficSource`, HUD slot.

---

*End of design document.*

# Component Architecture Design

This document describes the object model for the simulation engine. The goal is an architecture where adding a new component means declaring its capabilities and cost curve — not modifying the simulation, routing, or rendering systems.

---

## Design Principles

1. **Composition over inheritance.** Components are not a class hierarchy. A Database is not a subclass of Component that overrides `process()`. A Database is a Component that *has* a `StorageCapability`, a `ReplicationCapability`, and a `QueryCapability`. The Component class is the same for every component — what varies is the capability bundle.

2. **Open/Closed.** The simulation engine, routing system, and economy system are closed to modification. New components, capabilities, and modes are added by implementing interfaces and registering — never by editing existing classes.

3. **Capabilities are the atomic unit of behavior.** Everything a component "does" is a capability. If it can't be expressed as a capability, it doesn't belong on the component. This keeps the Component class thin and the behavior modular.

4. **Mode controllers filter, they don't modify.** The same component object exists in TD mode and Sandbox mode. The mode controller determines which capabilities are visible and at what tier. Components never know which mode they're in.

5. **The simulation is rendering-agnostic.** The simulation produces state. The renderer reads state. They never call each other. This means the simulation can run headless (for testing, balancing, or AI agents), and the renderer can be swapped (flat 2D now, isometric later) without touching game logic.

---

## Core Abstractions

There are seven core abstractions. Every object in the system is one of these or composed of these. Additional structural concepts (Zones, Auto-Scaling, Request Types, Failure Injection) layer on top of these without adding new abstractions — they're properties and engine behaviors, not new object types.

### 1. Request

The fundamental unit that flows through the system. A Request represents a user action — a page load, an API call, a database query. Requests are created by a TrafficSource, routed through Connections, processed by Capabilities on Components, and ultimately resolved as success or failure.

**Properties (creation snapshot — set once, never mutated):**
- `id` — unique identifier
- `parentId` — ID of the request that spawned this one, or `null` for root requests. This is the first-class link that makes sub-request trees traceable. The engine uses it to: (a) roll up sub-request latency into the parent's total, (b) let the diagnostics screen render the full request tree, and (c) determine when a parent request can resolve (all blocking children must complete first).
- `type` — the kind of request (read, write, query, static asset, etc.)
- `payload` — arbitrary data describing what the request needs (which endpoint, what data, etc.)
- `origin` — where the request entered the system
- `createdAt` — when it was created (simulation tick)
- `ttl` — time-to-live in ticks before the request times out and counts as a failure. Sub-requests inherit the parent's remaining TTL at spawn time — they can't outlive their parent.
- `originZone` — geographic zone where the request originated (e.g., `"eu-west"`). Set by the TrafficSource. Used by GeoRoutingCapability on DNS/GTM to route to the nearest zone. Default: `null` (pre-iteration-9).
- `streamDuration` — (streaming requests only) how many ticks this stream remains active after initial processing. Must be > 0 for streaming requests; `null` for non-streaming requests. A streaming request with `streamDuration` set triggers the active stream tracking in the engine (see Simulation Tick step 4b).
- `streamBandwidth` — (streaming requests only) bandwidth consumed per tick on the connection during the stream's duration. `null` for non-streaming requests.

**Associated state (accumulated in the RequestLog):**
- `status` — derived from the most recent event's type: ENTERED→pending, PROCESSED/FORWARDED→processing, RESPONDED→completed, DROPPED→failed, TIMED_OUT→timed_out. Never set independently — it's a read-through from the event log. This eliminates a separate mutation path.
- `events` — ordered list of `RequestEvent` entries, each recording what happened, where, and when

A `RequestEvent` is:
- `tick` — simulation tick when this event occurred
- `componentId` — which component produced this event
- `capabilityId` — which capability produced this event
- `type` — one of: ENTERED, PROCESSED, FORWARDED, CACHED_HIT, CACHED_MISS, QUEUED, DEQUEUED, SPAWNED_SUB, RESPONDED, DROPPED, TIMED_OUT, BACKPRESSURED, TRAVERSED
- `latencyAdded` — ticks of latency this event contributed
- `connectionId` — (only for TRAVERSED events) which connection the request crossed. Null for capability-produced events.
- `metadata` — optional key-value pairs (cache hit rate at that moment, queue depth, etc.)

Note: most events are produced by capabilities and have a `capabilityId`. TRAVERSED events are produced by the simulation engine when a request crosses a Connection. These have a `connectionId` instead of a `capabilityId`, and their `latencyAdded` equals the Connection's latency. Without TRAVERSED events, connection latency would be invisible in the event log and `totalLatency` would undercount.

**Derived from the event log (never stored separately):**
- `path` — reconstructed from events where type ∈ {ENTERED, PROCESSED, FORWARDED}
- `totalLatency` — sum of all `latencyAdded` across events
- `hops` — count of FORWARDED events
- `currentComponent` — the componentId of the most recent event

**Key design note:** The Request itself is an immutable creation snapshot. All state changes are appended to the RequestLog as events. This makes the simulation deterministic, debuggable, and replayable. The event log is also what the post-wave diagnostics screen reads: the player can trace any request's journey through their architecture, seeing exactly where latency accumulated and where failures occurred.

**Who appends events:** Capabilities do not write to the RequestLog directly. Instead, `capability.process()` returns a `ProcessResult` that includes a list of `RequestEvent` entries the capability wants to record. `Component.process()` collects events from each phase and returns them alongside the primary outcome and side effects. The engine then batch-appends all events to the RequestLog for that request. The engine also appends its own events (TRAVERSED for connection crossings, BACKPRESSURED for delivery failures, TIMED_OUT for TTL expiry). This means the RequestLog has exactly one writer — the engine — and event ordering is guaranteed because the engine controls the append sequence.

### 2. Capability

The atomic unit of behavior. A Capability is a single thing a component can do: store data, cache responses, route traffic, queue requests, replicate state. Capabilities are implemented against an interface, registered in the CapabilityRegistry, and composed onto Components.

**Interface:**
- `id` — unique identifier (e.g., `"storage"`, `"caching"`, `"routing"`)
- `phase` — which execution phase this capability runs in (see Execution Pipeline below). Declared at registration, never changes.
- `canHandle(requestType)` → `boolean` — returns whether this capability can process the given request type. Used by the PROCESS phase to select which capability runs. INTERCEPT, REPLICATE, and OBSERVE capabilities always return true (they run unconditionally within their phase).
- `process(request, context)` → `ProcessResult` — the core method. Takes a request and the component's context, returns a result (transformed request, response, sub-requests to spawn, etc.)
- `getUpkeepCost(tier)` → `number` — operational cost per tick at the given tier. **This is the single source of truth for recurring upkeep cost.** The simulation sums these to compute component and system upkeep. The capability itself is stateless with respect to tier — it receives tier as an argument.
- `getStats()` → `CapabilityStats` — current performance stats (hit rate, queue depth, latency added, etc.)
- `configure(config)` — for Sandbox mode. Accepts user configuration (eviction policy, shard count, replica count, etc.). In TD mode this is never called — the mode controller locks it.

**State ownership — who controls what:**

Capabilities are **stateless with respect to tier and activation.** A Capability object does not store `tier`, `maxTier`, or `isActive`. Instead:

- The **component registry** declares `defaultTier` and `maxTier` per capability per component type. This is static data — the blueprint.
- The **Component** instance stores the runtime `tier` for each of its capabilities in a `capabilityTiers: Map<capabilityId, number>`. `Component.upgrade(capabilityId)` increments this value, capped at the registry's `maxTier`.
- The **ModeController** determines which capabilities are active via `getActiveCapabilities(component)`, returning a set of capability IDs. The Component asks the ModeController at each phase to filter its capability list. The ModeController can also cap tier (e.g., "in wave 3, ReplicationCapability is capped at tier 1 even if upgraded to tier 2").
- When the pipeline runs, the Component passes the current tier to `capability.process(request, { tier, ... })` and to `capability.getUpkeepCost(tier)`.

This means: registry owns the blueprint, Component owns the runtime tier state, ModeController owns visibility and tier caps. No overlap.

**What capabilities ARE stateful about:** Capabilities don't own tier or activation, but they absolutely own operational state — a CachingCapability has cache entries, a QueueCapability has a buffer of held requests, a StorageCapability has persisted data. This is internal, mutable state that evolves as requests flow through. The distinction is: **configuration state** (tier, active/inactive) is owned externally by the Component and ModeController, while **operational state** (cache contents, queue depth, stored records) is owned by the capability instance itself. `getStats()` reads operational state. `process()` mutates it. This is expected and necessary — the point of the ownership model above is to prevent multiple authorities from writing to the same fields, not to make capabilities stateless objects.

**Engine-contract sub-interfaces:** Some capabilities have responsibilities beyond the standard `process()` pipeline. Rather than having the engine type-check for specific capability classes (which would violate the "no type-checking" principle), these are expressed as explicit sub-interfaces that any capability can implement:

- **`EngineConsultable`** — declares `selectConnection(request, egressConnections, context)` → `connectionId`. The engine calls this at delivery time to determine which egress connection a FORWARD result should use. RoutingCapability implements this. If no capability on the component implements `EngineConsultable`, the engine falls back to round-robin. Any future capability that needs to influence delivery routing (e.g., a CircuitBreakerCapability) would implement this same interface — no engine modification needed.

- **`EngineBufferable`** — declares `enqueueForRetry(request, processResult)` → `boolean` (true = accepted, false = at capacity, drop the request) and `emitReady()` → `{ awaitingPipeline: Request[], awaitingDelivery: { request, processResult }[] }`. The engine calls `enqueueForRetry()` when a Connection rejects, and calls `emitReady()` at the start of each tick to get re-emittable requests. QueueCapability implements this. If no capability on the component implements `EngineBufferable`, backpressured requests are dropped.

The engine checks for these interfaces, not for specific capability types. `component.getCapabilityByInterface(EngineConsultable)` returns the first matching capability or null. This keeps the engine closed to modification: adding a new engine-consulted behavior means implementing one of these interfaces on a new capability, not editing the engine.

**Execution Pipeline:** When a component has multiple capabilities, they don't run in arbitrary order. Each capability declares which `phase` it operates in. The component executes capabilities in phase order. The phases are:

1. **INTERCEPT** — runs first, before main processing. Each INTERCEPT capability runs in registration order and returns one of three results:
   - **A primary outcome (RESPOND, FORWARD, DROP, QUEUE_HOLD):** short-circuits the pipeline. No later INTERCEPT capabilities or phases run. RESPOND means the request is done (cache hit). FORWARD means it leaves this component immediately. DROP means rejection. QUEUE_HOLD means buffered for later.
   - **PASS:** this capability has nothing to do with this request. Continue to the next INTERCEPT capability. This is the default — if a capability doesn't match the request, it returns PASS.
   
   PASS is what makes multi-capability INTERCEPT work. A CDN's FilterCapability returns PASS for static requests (letting CachingCapability handle them) and FORWARD for non-static requests (ejecting them from the component). CachingCapability returns RESPOND on cache hit and FORWARD on cache miss. Without PASS, there's no way for an INTERCEPT capability to say "not my problem" without also terminating the pipeline.
   
   If all INTERCEPT capabilities return PASS, execution continues to the PROCESS phase.
2. **PROCESS** — the main work phase. `ProcessingCapability`, `StorageCapability`, `QueryCapability` live here. Only one PROCESS-phase capability runs per request. Selection: the component iterates PROCESS capabilities in registration order and calls `capability.canHandle(request.type)` — a method on the Capability interface that returns true/false based on the request type. The first capability that returns true runs. If none match, the component returns FORWARD (it can't handle this request). `canHandle()` is the only method capabilities use to declare which request types they support.
3. **REPLICATE** — runs after PROCESS succeeds. `ReplicationCapability` and `ShardingCapability` live here. These append SPAWN side effects to the ProcessResult without overriding the primary outcome. A write that returns RESPOND in the PROCESS phase still returns RESPOND after REPLICATE — but now with additional sub-requests attached. REPLICATE capabilities never block the primary response and never change the primary outcome.
4. **OBSERVE** — runs unconditionally after every request, regardless of outcome. `MonitoringCapability`, `HealthCheckCapability`, `LoggingCapability` live here. They record metrics but never modify the request or its result. Their `process()` return value is ignored by the pipeline — the primary outcome from INTERCEPT/PROCESS is already locked in. OBSERVE capabilities can still return events in their ProcessResult (for logging), but the primary outcome and side effects are discarded. This means an OBSERVE capability cannot short-circuit, forward, or drop — it's read-only by contract.

This pipeline is fixed. Capabilities declare their phase; they don't choose when to run. A component with CachingCapability (INTERCEPT) + ProcessingCapability (PROCESS) + MonitoringCapability (OBSERVE) executes in exactly that order. A CDN with CachingCapability (INTERCEPT) + FilterCapability (INTERCEPT) executes both INTERCEPT capabilities in registration order — FilterCapability first (rejects non-static requests) then CachingCapability (serves cached static assets). Registration order within a phase is defined by the component registry entry's capability list order.

**Tier system:** Tiers are the upgrade path. A `CachingCapability` at tier 1 has a small fixed-size cache. At tier 2, the cache is larger. At tier 3, the player can choose between eviction policies (LRU vs TTL). The tier determines both power and upkeep cost. The tier value is stored on the Component instance (not the Capability) and passed to capability methods as an argument. In TD mode, tiers map to the upgrade tree and the ModeController can cap them. In Sandbox mode, all tiers are unlocked.

**Categories of capabilities:**

- **Processing capabilities** — do work on requests. `ProcessingCapability` (generic compute), `StorageCapability` (persist/retrieve data), `CachingCapability` (store and serve recent responses), `BlobStorageCapability` (large unstructured assets — video files, images — with high-bandwidth/high-latency cost profile, fundamentally different from `StorageCapability`'s structured data), `SearchCapability` (full-text indexed retrieval, CPU-heavy and memory-heavy, different cost curve from `StorageCapability`), `StreamingCapability` (adaptive bitrate chunked delivery for long-lived connections — a single request occupies bandwidth for multiple ticks), `BatchProcessingCapability` (pulls N items from a connected Queue and processes as a batch — throughput-optimized, latency-insensitive).
- **Routing capabilities** — direct traffic. `RoutingCapability` (load balancer logic: round-robin, least-connections, weighted; see Routing section under Connection for how this integrates with the engine), `FilterCapability` (route by request type or content), `GeoRoutingCapability` (routes based on request origin zone and region health; implements `EngineConsultable`; sits at the DNS/GTM layer above per-zone topologies).
- **Security capabilities** — protect the system. `AuthCapability` (INTERCEPT — authenticates/authorizes requests, rejects unauthenticated traffic before it consumes processing), `RateLimitCapability` (INTERCEPT — rejects excess traffic immediately via token bucket or sliding window, as opposed to `QueueCapability` which buffers excess traffic; buffering and rejecting are opposite strategies), `SSLTerminationCapability` (INTERCEPT — terminates TLS connections, adds latency but is mandatory at scale), `CompressionCapability` (INTERCEPT — compresses responses, trades CPU for bandwidth savings).
- **Resilience capabilities** — keep the system running under failure. `CircuitBreakerCapability` (INTERCEPT + `EngineConsultable` — tracks failure counts per downstream connection, opens circuit after N failures to prevent cascading failure, half-opens to probe recovery), `RetryCapability` (INTERCEPT + `EngineBufferable` — automatic retry with exponential backoff for transient failures, distinct from Queue which buffers for capacity), `AutoScaleCapability` (OBSERVE — monitors load metrics and adjusts the component's `instanceCount` up/down within a configured range; triggers SCALE side effects; see Auto-Scaling section).
- **Discovery capabilities** — meta-infrastructure. `RegistrationCapability` (PROCESS — accepts service registration requests, maintains a registry of live component instances and their zones/health; consulted by the engine when resolving routing decisions on components that implement `EngineConsultable`).
- **Queue capabilities** — buffer and order. `QueueCapability` (FIFO, priority queue, rate limiting). Adds latency but prevents overload.
- **Replication capabilities** — duplicate state. `ReplicationCapability` (read replicas, primary-secondary), `ShardingCapability` (partition data across instances).
- **Shared capabilities** — available on any component. `MonitoringCapability` (exposes metrics), `HealthCheckCapability` (reports health status), `LoggingCapability` (records request history). These are mixins — every component can have them regardless of type.

### 3. Component

A named bundle of capabilities with a visual identity, a cost curve, and a set of ports. The Component class itself is generic — what makes a "Database" different from a "Server" is its capability bundle, its port configuration, and its flavor text.

**Properties:**
- `id` — unique identifier
- `type` — component type identifier (e.g., `"database"`, `"server"`, `"cache"`, `"load_balancer"`)
- `name` — display name (e.g., "Database")
- `description` — flavor text one-liner (e.g., "Persists data so your servers don't have to remember everything.")
- `capabilities` — map of capability ID → Capability instance (own operational state like cache entries and queue buffers; do NOT own tier or activation state)
- `capabilityTiers` — map of capability ID → current tier (runtime state, mutated by `upgrade()`)
- `ports` — list of Ports (typed input/output connection points)
- `placementCost` — one-time cost to place this component
- `position` — grid coordinates
- `zone` — geographic zone identifier (e.g., `"na-east"`, `"eu-west"`), assigned at placement time. See Zones & Multi-Region section. Default: `null` (pre-iteration-9, zones are not yet unlocked).
- `instanceCount` — number of instances in this component's pool, defaulting to 1. Throughput and upkeep scale linearly. Managed by `AutoScaleCapability` when active, or manually set in Sandbox mode. See Auto-Scaling section.
- `condition` — a single numeric value (0.0–1.0) representing the component's operational health. Starts at 1.0. This is the single authoritative field for the component's physical state — the renderer, routing logic (via `EngineConsultable.selectConnection()`), and failure system all read this one value. Behavior at each threshold, the decay/recovery rates, and the trigger window are all defined in the component registry's `conditionProfile` (see Component Registry section), so different component types can have different resilience characteristics — a CDN might be more resilient than a cache. The engine reads the profile and applies it uniformly; it doesn't hardcode any numbers.

**Methods:**
- `process(request)` — runs the execution pipeline. Iterates through active capabilities in phase order (INTERCEPT → PROCESS → REPLICATE → OBSERVE), stopping early if an INTERCEPT capability short-circuits. Passes the current tier from `capabilityTiers` to each capability's `process()` call. The Component itself contains no business logic — it's a pipeline runner.
- `getUpkeepCost()` — sum of all active capabilities' `getUpkeepCost(tier)` calls, using the tier from `capabilityTiers`. This is the single source of truth for recurring upkeep cost.
- `getActiveCapabilities()` — returns only capabilities the ModeController has enabled. The component calls `modeController.getActiveCapabilities(this)` and caches the result. Cache is invalidated at game-phase transitions (build→simulate→assess) — these are the only moments the ModeController's decisions change.
- `upgrade(capabilityId)` — increments the capability's tier in `capabilityTiers`, capped at the registry's `maxTier` for that capability. Increases power and upkeep.

**Why no subclasses:** A `Database` is not `class Database extends Component`. It's `new Component({ type: "database", capabilities: [StorageCapability, ReplicationCapability, QueryCapability, ...], ports: [...] })`. This means:
- Adding a new component type never requires a new class
- Component behavior is entirely determined by its capability composition
- The simulation engine only knows about `Component` — it never type-checks for "is this a database?" It checks for sub-interfaces (`EngineConsultable`, `EngineBufferable`) but never for specific capability types.
- Two components with the same capabilities behave identically regardless of their `type` label

### 4. Port

A typed connection point on a component. Ports enforce what can connect to what and prevent invalid topologies.

**Properties:**
- `id` — unique identifier within the component
- `direction` — `ingress` (receives requests) or `egress` (sends requests)
- `dataType` — what kind of traffic this port accepts/produces (e.g., `"http"`, `"data"`, `"any"`)
- `capacity` — maximum concurrent connections
- `connections` — list of Connection IDs attached to this port

**Why ports matter:** Without ports, any component can connect to any other component in any direction. That's fine for a prototype but creates nonsensical topologies (a cache feeding into a load balancer feeding into an entry point). Ports make connection validity a property of the type system, not runtime validation. A load balancer has one `ingress` port (from entry point or upstream) and N `egress` ports (to downstream servers). A database has one `ingress` port (receives queries) and optionally an `egress` port (for replication to read replicas). The connection system checks port compatibility before allowing a link.

### 5. Connection

A directional link between two ports on two components. Connections are how requests travel through the topology.

**Properties:**
- `id` — unique identifier
- `source` — `{ componentId, portId }`
- `target` — `{ componentId, portId }`
- `bandwidth` — maximum requests per tick
- `latency` — ticks added to request travel time
- `currentLoad` — requests sent through this connection on the current tick. Reset to 0 each tick. When `currentLoad >= bandwidth`, subsequent requests are rejected (BACKPRESSURE). This is the only state a Connection tracks — it's a counter, not a buffer.

**Behavior:** Connections are passive pipes with bandwidth limits and fixed latency. They do not buffer. When a connection receives more requests per tick than its bandwidth allows, excess requests are **rejected** with a BACKPRESSURE signal. Connections are simple — they either deliver or reject. They never hold state.

**Backpressure ownership — the engine, not capabilities:** The capability pipeline (INTERCEPT → PROCESS → REPLICATE → OBSERVE) runs to completion and produces a ProcessResult (RESPOND, FORWARD, SPAWN, etc.). After the pipeline finishes, the **simulation engine** attempts to deliver FORWARD/SPAWN results through the appropriate egress Connection. If the Connection rejects due to bandwidth, the engine — not a capability — handles it:

1. If the sending component has a QueueCapability, the engine routes the rejected request into it. The QueueCapability holds the request internally and re-emits it on a future tick. From the engine's perspective, the request's status becomes QUEUED (a RequestEvent is appended).
2. If the sending component has no QueueCapability, the request is dropped. A DROPPED event is appended.
3. The engine never re-runs the capability pipeline for a backpressured request. The pipeline already decided what to do. The engine just couldn't deliver the result yet.

This means backpressure is a **delivery concern**, not a processing concern. The pipeline is pure: it takes a request and decides an outcome. The engine is the transport layer: it attempts delivery and falls back to queue-or-drop. QueueCapability is still the only thing that buffers, but it's invoked by the engine as a fallback, not as part of the pipeline's phase execution.

**Why one buffering layer matters:** Earlier iterations had three places that could buffer: Connection queues, QueueCapability during INTERCEPT, and a generic QUEUE ProcessResult. That made it unclear who owns backpressure. The fix: Connections reject, the engine routes to QueueCapability if present, QueueCapability is the only buffer. One mechanism, one owner, one place to tune.

**QueueCapability's two invocation paths:** QueueCapability implements both `Capability` (for the pipeline) and `EngineBufferable` (for engine backpressure fallback). These serve different roles with different re-emission semantics:

1. **Proactive buffering (INTERCEPT phase, via `Capability.process()`).** The pipeline calls `process()` during INTERCEPT. QueueCapability inspects the incoming request and decides whether to hold it (QUEUE_HOLD) or pass it through (PASS). Held requests have NOT been processed yet — they haven't run through PROCESS, REPLICATE, or OBSERVE. When re-emitted on a future tick via `EngineBufferable.emitReady()`, the engine feeds them back into the component's pipeline from the top (INTERCEPT again — but QueueCapability recognizes re-emitted requests and returns PASS, letting them through to PROCESS).

2. **Backpressure fallback (engine-invoked, via `EngineBufferable.enqueueForRetry()`).** The engine calls `enqueueForRetry(request, processResult)` after a Connection rejects an outbound delivery. These requests HAVE already been fully processed — they have a complete ProcessResult with a FORWARD primary outcome. When re-emitted via `emitReady()`, the engine retries the delivery directly. It does NOT re-run the pipeline. The ProcessResult is preserved.

Both paths write to the same internal buffer, both respect the same capacity limits and priority ordering, and both show up in `getStats()`. But re-emission routing differs: proactive holds re-enter the pipeline, backpressure holds retry delivery. The engine never checks "is this a QueueCapability" — it checks `component.getCapabilityByInterface(EngineBufferable)`.

**Re-entrancy guard:** A request can cycle through both paths: proactively queued (INTERCEPT), dequeued and processed (pipeline runs, produces FORWARD), then backpressure-queued on the same component (engine calls `enqueueForRetry()`). This is valid — the request is in a fundamentally different state each time. The QueueCapability distinguishes them internally: proactively held requests are tagged `awaiting_pipeline`, backpressure holds are tagged `awaiting_delivery`. When re-emitting, the engine checks the tag. The pipeline is never re-run for an `awaiting_delivery` request, even if it re-enters the same component's queue. If the queue is at capacity when the engine tries `enqueueForRetry()`, the request is dropped — there's no fallback beyond the queue.

**Routing:** When a component has multiple egress connections, the engine must decide which connection to use for a FORWARD result. The engine calls `component.getCapabilityByInterface(EngineConsultable)` — if a capability implements `EngineConsultable`, the engine calls its `selectConnection(request, egressConnections, context)` method to get a specific Connection ID. If no capability implements `EngineConsultable`, the engine uses round-robin by default.

RoutingCapability implements both `Capability` and `EngineConsultable`. Its `process()` method is a no-op (returns PASS) — it doesn't participate in the pipeline. Its real work happens through `selectConnection()`, called by the engine at delivery time. It has no pipeline phase — its registry entry omits `phase` entirely. RoutingCapability still reads component state (other capabilities' stats, connection condition) via the context the engine passes, and its tier still affects behavior (tier 1 = round-robin, tier 2 = least-connections, tier 3 = weighted + condition-aware). But it runs after the pipeline, not during it.

### 6. TrafficSource

Generates requests and injects them into the system. In TD mode, this is the wave system. In Sandbox mode, this is a configurable traffic generator.

**Properties:**
- `pattern` — the shape of traffic over time (steady, bursty, ramping, spike)
- `requestTypes` — distribution of request types generated (80% reads / 20% writes, etc.)
- `intensity` — requests per tick
- `duration` — how long this traffic source runs (in TD: wave length; in Sandbox: continuous)

**TD mode:** The TDModeController creates TrafficSources for each wave. Early waves are low-intensity, mostly reads. Later waves introduce writes, bursts, mixed types, and boss waves (viral traffic events). The player doesn't configure traffic — they react to it.

**Sandbox mode:** The player configures TrafficSources directly. They can model steady-state production traffic, simulate a traffic spike, or create custom patterns to stress-test their architecture.

### 7. ModeController

Sits above the entire simulation and determines the rules of engagement. The simulation engine calls the ModeController at each phase transition (build phase → wave phase → assess phase) and the ModeController determines what happens.

**Interface:**
- `getActiveCapabilities(component)` — returns which capabilities are enabled for this component in this mode/tier
- `getBuildConstraints()` — returns budget, available component types, placement rules
- `getTrafficSource()` — returns the TrafficSource for this phase (wave in TD, player-configured in Sandbox)
- `evaluateOutcome(metrics)` — determines win/lose/score after a simulation run
- `getPhase()` — returns current phase (build, simulate, assess)
- `advancePhase()` — transitions to the next phase
- `getBudget()` — returns current budget. The ModeController owns the economy ledger: it tracks income, deducts upkeep per tick, deducts placement/upgrade costs, and triggers component degradation when budget goes negative. The economy is not a separate system — it lives on the ModeController because economic rules differ by mode (TD has income/upkeep pressure; Sandbox has optional or no budget).

**TDModeController:**
- Manages wave progression, economy (income per successful request, upkeep drain between waves), build/watch/assess phases
- Restricts capabilities to tier-appropriate subsets
- Evaluates outcome on three axes: cost efficiency, performance (latency/throughput), reliability (error rate)
- Controls difficulty curve through wave escalation

**SandboxModeController:**
- Unlocks all capabilities at all tiers
- No economy constraints (or optional budget mode)
- Player controls traffic patterns
- No win/lose — metrics are informational
- Enables configuration panels for each capability

**Future refactor note:** ModeController currently owns 7 methods spanning capability filtering, phase management, traffic sourcing, outcome evaluation, and economy. This is intentional for the MVP — economy rules vary by mode, so co-locating them avoids coordination overhead. If the class grows unwieldy during implementation, the cleanest extraction point is an `EconomyStrategy` interface (with TD and Sandbox implementations) that the ModeController delegates to for `getBudget()`, upkeep deduction, and placement/upgrade cost handling. The ModeController would own the strategy; the engine would still call ModeController only.

---

## The Request Lifecycle

A single request flows through the system like this:

```
1. TrafficSource creates a Request with a type, payload, and TTL

2. Request enters the system at the EntryPoint (a special ingress-only component)

3. EntryPoint's egress Connection delivers the Request to the first Component
   (typically a LoadBalancer or a Server)

4. The Component receives the Request on an ingress Port
   → Component.process(request) runs the capability pipeline (INTERCEPT → PROCESS → REPLICATE → OBSERVE)
   → The pipeline produces a ProcessResult with two parts:
     a. Primary outcome (exactly one):
        - RESPOND: request is complete, response flows back to the origin
        - FORWARD: request should continue to another component (via an egress Port)
        - QUEUE_HOLD: request is buffered inside QueueCapability, will be re-emitted in a future tick
        - DROP: request is rejected (component overloaded, no capacity)
        (Note: PASS is also a valid return from individual INTERCEPT capabilities,
        meaning "continue to next capability." PASS never becomes the pipeline's
        final primary outcome — if all capabilities PASS, the component returns FORWARD.)
     b. Side effects (zero or more, from REPLICATE phase):
        - SPAWN: sub-requests to send to other components (e.g., replication writes to read replicas)

   This compound structure is what makes REPLICATE work. A Database processes a write request
   (PROCESS phase returns RESPOND), then the REPLICATE phase appends SPAWN side effects for
   replication — without overriding the primary outcome. The primary response flows back
   immediately; the spawned replication requests are fire-and-forget background work.

5. The engine delivers the primary outcome:
   - If FORWARD or any SPAWN side effects: the engine sends the request (or sub-requests)
     via egress Connections. Connection bandwidth and latency apply.
     If a Connection rejects (backpressure), the engine routes to QueueCapability
     if present, otherwise drops. (See Connection section for full backpressure semantics.)
   → Repeat from step 4 at the next Component.

6. If RESPOND: the response travels back to the origin via the reverse of the
   request's path. Response transport is NOT routed through connections in reverse.
   Instead, it uses a dedicated reply channel: the engine reads the request's event
   log to reconstruct the path, then delivers the response directly to the origin,
   adding a flat per-hop latency for each connection the request traversed on the
   way in. This means:
   - Response latency = sum of all capability processing times + (connection latency × 2
     for each hop, representing round-trip). Bandwidth contention only applies on the
     forward path — responses don't compete for connection bandwidth.
   - Response delivery never fails. Once a request gets RESPOND, the response reaches
     the origin. This is a simplification: real networks can drop responses, but modeling
     that adds complexity without teaching a useful tradeoff at the level this game targets.
   - The diagnostics screen shows both legs: forward path with per-hop latency and
     processing time, and return path as a single aggregated return latency.

7. The simulation records the outcome:
   - Success: request completed within TTL → generates revenue
   - Timeout: request exceeded TTL → no revenue, counts against reliability
   - Drop: request was rejected → no revenue, counts against reliability
   - Error: capability produced an error (e.g., stale cache) → partial penalty

8. Metrics are updated: latency, throughput, error rate, cost, revenue.
```

**Sub-requests:** When a Server needs data from a Database, it spawns a sub-request with `parentId` pointing to the original request. The sub-request has its own RequestLog but its latency rolls up into the parent's total. The engine tracks the parent→child relationship via `parentId`:

- **Blocking SPAWNs** (from PROCESS phase): the parent cannot resolve until every blocking child reaches a terminal state (completed, failed, or timed_out). A child timing out unblocks the parent — timeout IS a terminal state. If any blocking child fails or times out, the parent itself fails (it needed that data and didn't get it). The parent's failure event records which child caused it.
- **Non-blocking SPAWNs** (from REPLICATE phase): fire-and-forget. The parent doesn't wait. If a replication sub-request fails, it's logged but doesn't affect the parent's outcome.

This models real behavior: an API call that queries a database has latency = API processing + DB query + network round-trip, and if the DB query fails the API call fails. But replication writes happen asynchronously — a failed replica doesn't break the primary write. The diagnostics screen renders the full request tree so the player sees exactly why adding a cache between the server and database reduces total latency.

---

## The Economy

The economy is not a separate system — it emerges from the components and the request lifecycle.

**Income:** Every successfully resolved request generates revenue. Revenue per request can vary by type (a complex write is worth more than a static asset read). This maps to real-world business logic: successful requests = happy users = revenue.

**Upkeep (recurring):** Every active capability on every placed component costs per tick, whether traffic is flowing or not. `Component.getUpkeepCost()` sums all active capabilities' `getUpkeepCost(tier)` calls — this is the single source of truth for recurring cost. Total system upkeep = sum across all components. This is the drain that prevents overbuilding — idle infrastructure still costs money.

**Placement cost (one-time):** Defined in the component registry. Deducted from budget when a component is placed. This is the initial capital investment — separate from recurring upkeep.

**Upgrade cost (one-time):** Defined in the component registry's `upgradeCostCurve`. Deducted from budget when a capability's tier is incremented. Costs escalate per tier (roughly doubling), forcing prioritization. You can't max everything.

**Cost model summary:** There are three kinds of cost. Recurring upkeep is computed from capabilities (`getUpkeepCost(tier)` is the single source of truth). Placement and upgrade costs are one-time charges defined in the registry. These are separate systems with separate authorities — they never overlap.

**Budget:** Income minus upkeep, accumulated over time. If budget hits zero, the player can't place or upgrade. If budget goes negative (upkeep > income for too long), components start degrading.

**The tradeoff loop:** More components = higher capacity = more successful requests = more revenue, BUT also more upkeep = tighter margins = less room to scale for the next wave. The player who overbuilds has high throughput but razor-thin margins. The player who underbuilds has healthy margins but can't handle traffic spikes. The winning architecture is the leanest one that survives.

---

## Zones & Multi-Region

The simulation's topology is not a single flat graph. At iteration 9+, the player operates in multiple geographic zones — modeling Netflix's multi-region AWS deployment.

**Zone as a component property.** Each Component has a `zone` field (e.g., `"na-east"`, `"eu-west"`, `"ap-south"`), assigned at placement time. When a player "builds a data center" in a zone, this is a UI-level grouping action — every component placed inside that grouping gets the zone property automatically. The simulation engine doesn't model zones as entities; it reads the `zone` field on components and applies latency modifiers.

**Zone-pair latency table.** Game-level configuration that the engine consults when delivering requests across Connections between components in different zones:

```
zonePairLatency:
  "na-east|na-west": 30
  "na-east|eu-west": 80
  "na-east|ap-south": 150
  "eu-west|ap-south": 120
  "same-zone": 0   // no modifier for intra-zone connections
```

When the engine delivers a FORWARD result through a Connection, it checks the source and target component zones. If they differ, the engine adds the zone-pair latency on top of the Connection's base latency. This is the only place zones affect the simulation — everything else (processing, capability behavior, routing) works identically regardless of zone.

**How DNS/GTM integrates.** The DNS/GTM component sits at the system entry point with connections to each zone's local entry point (typically a LoadBalancer or API Gateway per zone). TrafficSource generates requests with an `originZone` field representing where the simulated user is located. GeoRoutingCapability on the DNS/GTM reads `request.originZone`, consults the zone-pair latency table and zone health, and selects the egress connection to the optimal zone.

**Zone-aware routing within zones.** RoutingCapability and EngineConsultable implementations automatically prefer same-zone connections when available. The ServiceRegistry (if present) tracks which zone each registered instance lives in, and provides zone-filtered instance lists to EngineConsultable callers.

**The teaching moment:** Going multi-region doesn't just add a component — it multiplies your entire topology. The player has to replicate their architecture per zone (servers in EU, servers in NA, databases in each region with cross-region replication). The cost scales linearly, but the resilience benefit is non-linear: a single-zone architecture has a single point of failure; a multi-zone architecture survives regional outages.

**Connection to data consistency:** Cross-zone ReplicationCapability introduces visible eventual consistency. A write in NA-East takes 80ms+ to replicate to EU-West. During that window, reads in EU-West return stale data. The player can observe this directly in the diagnostics screen — making the CAP theorem tangible rather than theoretical.

---

## Auto-Scaling & Instance Pools

The current model's "one component = one instance" simplification breaks at scale. At Netflix, a "Server" is a pool of N instances behind a load balancer, where N changes dynamically. Rather than forcing the player to place and manage individual instances (which would overwhelm the board and add no educational value), auto-scaling is modeled as an abstraction.

**`instanceCount` property on Component.** Every component has an `instanceCount` field, defaulting to 1. Throughput and upkeep scale linearly: a Server with `instanceCount: 3` has 3× the processing throughput (can handle 3× the requests per tick in the PROCESS phase) and 3× the upkeep cost. The player sees "Server (×3)" on the board — a single visual component with a multiplier badge.

**`AutoScaleCapability` (OBSERVE phase).** Monitors the component's load metrics (requests processed / capacity) over a sliding window. When load exceeds a high-water mark, it emits a `SCALE_UP` side effect. When load drops below a low-water mark, it emits a `SCALE_DOWN` side effect. The engine processes these during the tick and adjusts `instanceCount` within the capability's configured `minInstances` and `maxInstances` bounds.

**SCALE side effect type.** Added to the ProcessResult side effects alongside SPAWN:

```
SCALE: { targetInstanceCount: number }
```

The engine processes SCALE side effects during step 4 (DELIVER RESULTS). The ModeController is consulted to deduct the cost difference: scaling up costs `(newCount - oldCount) × component.getUpkeepCost()` per tick going forward, plus a one-time scaling fee (a fraction of placement cost). Scaling down reduces upkeep immediately. This models real cloud economics: scaling up is cheap and fast, scaling down saves money.

**Why this works for the game:** The player doesn't manage individual instances. They invest in AutoScaleCapability at a higher tier, configure min/max bounds during the build phase, and watch their architecture dynamically adjust during waves. The teaching moment: "auto-scaling adjusts capacity to match demand at proportional cost — but it's not free. Over-provisioned auto-scaling burns budget on idle instances. Under-provisioned auto-scaling can't react fast enough to traffic spikes."

**Unlock mechanism:** AutoScaleCapability follows the same pattern as all locked capabilities (e.g., ReplicationCapability on Database). It starts at tier 0 (locked/invisible). The ModeController gates when it becomes available — in TD mode, the TDModeController unlocks it at iteration 10+. The player then upgrades it from tier 0 → tier 1 (paying the upgrade cost), which activates it. In Sandbox mode, all tiers are unlocked and the player can enable it immediately.

**Cooldown and oscillation prevention.** AutoScaleCapability has a cooldown period (configurable per tier) between scale events to prevent rapid oscillation. Tier 1 has a long cooldown (5 ticks). Tier 2 has a shorter cooldown (2 ticks) and predictive scaling based on recent load trends.

---

## Request Types

The base Request model supports one-shot request/response. At scale, Netflix needs three additional request patterns. These extend the existing Request without changing the core model.

### Streaming Requests

A streaming request represents a sustained flow — video playback, long-lived SSE connections. Unlike a normal request that completes in one processing cycle, a streaming request occupies connection bandwidth for multiple ticks.

**Additional Request properties for streaming:**
- `streamDuration` — how many ticks this stream remains active after initial processing
- `streamBandwidth` — bandwidth consumed per tick on the connection (a fraction of the connection's total bandwidth)

**Engine behavior:** When a StreamingCapability returns RESPOND for a streaming request, the engine doesn't close the request immediately. Instead, it marks the request as `active_stream` and reserves `streamBandwidth` on the connection for `streamDuration` ticks. Each tick, the reserved bandwidth is deducted from the Connection's available bandwidth (reducing capacity for other requests). When the duration expires, the stream completes and bandwidth is released. If the Connection becomes overloaded, active streams can be degraded (reduced bandwidth) by an adaptive StreamingCapability rather than dropped.

**The teaching moment:** A few streaming requests can saturate a connection that handles hundreds of normal requests. The player learns that streaming infrastructure needs dedicated capacity planning — you can't just throw it on the same servers that handle API calls.

### Batch Requests

A batch request triggers processing of many items — transcode 100 video segments, process a day's analytics. This is already supported by the existing SPAWN mechanism.

**How it works:** A batch request arrives at a Worker. BatchProcessingCapability (PROCESS phase) examines the request's payload (which specifies the items to process) and returns a ProcessResult with the primary outcome RESPOND (acknowledging receipt) plus N SPAWN side effects — one child request per batch item. These are non-blocking spawns (from PROCESS phase, but explicitly marked non-blocking since the parent just acknowledges receipt). Each child request is processed independently.

**No new engine machinery needed.** Batch requests use parentId for tree tracking, non-blocking SPAWN for fan-out, and the existing RequestLog for per-item tracking. The only new element is that BatchProcessingCapability pulls items from a connected Queue rather than receiving them via push — this activation pattern is handled in simulation tick step 2 (RE-EMIT QUEUED).

### Pub/Sub Events

Event-driven messages that are not request/response — "user watched X" triggers "update recommendation model." These fan out to all subscribers.

**How it works:** An event request has `type: "event"` and arrives at a component with REPLICATE capabilities. The REPLICATE phase fans it out: ReplicationCapability creates a non-blocking SPAWN for each downstream subscriber connection. The primary outcome is RESPOND (event acknowledged). The spawned requests are fire-and-forget — if a subscriber is down, the event is lost (or queued if the subscriber has a QueueCapability in front of it).

**No new engine machinery needed.** The existing REPLICATE phase + non-blocking SPAWN semantics handle pub/sub natively. "Subscriptions" are just connections to downstream consumers. Adding a new subscriber means wiring a new connection from the event source to the subscriber's ingress port.

**The teaching moment:** "Not everything is request/response. Event-driven architectures decouple producers from consumers — the recommendation service doesn't need to be online when the user watches a video, as long as the event gets queued."

---

## Failure Injection (Chaos Engineering)

Netflix invented Chaos Monkey — deliberately injecting failures to test resilience. Rather than a separate component, this is a ModeController feature.

**TDModeController chaos mode:** At higher iterations (8+), the TDModeController can randomly trigger failure events during waves:

- **Component failure:** A random component's `condition` drops to 0.0 (critical). The player's architecture must route around it.
- **Zone outage:** All components in a zone simultaneously degrade to critical. Tests multi-region failover.
- **Connection severing:** A random Connection's bandwidth drops to 0 for N ticks, simulating a network partition.
- **Latency injection:** Random Connections gain temporary latency spikes, simulating network degradation.

These events are announced to the player (this isn't a surprise — it's a challenge). The player who invested in Circuit Breakers, multi-region, and auto-scaling survives. The player who built a brittle single-zone monolith doesn't. The post-wave assessment shows exactly which failures occurred and how the architecture handled (or didn't handle) each one.

**SandboxModeController chaos mode:** The player can manually trigger failure events to stress-test their architecture. This is the "chaos engineering sandbox" — the player designs an architecture, then deliberately breaks it to find weaknesses.

---

## The Simulation Tick

The simulation runs in discrete ticks. Each tick represents one unit of simulated time (the actual duration is irrelevant — the renderer interpolates visuals between ticks). The engine executes the following steps in order every tick during the simulate phase:

```
1. INJECT TRAFFIC
   The engine calls the current TrafficSource (provided by the ModeController)
   to generate this tick's new requests. Each new request gets a RequestLog
   with an ENTERED event. New requests are added to the pending queue.

2. RE-EMIT QUEUED REQUESTS
   Every QueueCapability on every component emits requests that are ready
   for re-entry. Proactive holds (awaiting_pipeline) go into the pending
   queue for their component. Backpressure holds (awaiting_delivery) go
   into a delivery-retry queue with their preserved ProcessResult.

3. PROCESS PENDING REQUESTS
   For each request in the pending queue (new + re-emitted):
     a. The engine calls Component.process(request) on the request's
        current component
     b. Component.process() runs the pipeline (INTERCEPT → PROCESS →
        REPLICATE → OBSERVE) and returns:
        - A ProcessResult (primary outcome + side effects + events)
     c. The engine appends all returned events to the request's RequestLog

4. DELIVER RESULTS
   For each ProcessResult from step 3 (and retries from step 2):
     a. If RESPOND: the engine resolves the request (see Response Transport).
        If the request has a parentId, the engine checks whether the parent
        can now resolve (all blocking children in terminal state).
        If the request has streamDuration > 0 (streaming request), the engine
        marks it as active_stream and reserves streamBandwidth on the connection
        for streamDuration ticks (see Streaming Requests under Request Types).
     b. If FORWARD: the engine consults RoutingCapability (or round-robin)
        to select an egress Connection, then attempts delivery.
        Connection.currentLoad is incremented. If currentLoad >= bandwidth
        (accounting for bandwidth reserved by active streams), the request is
        rejected → engine calls QueueCapability.enqueueForRetry() or drops.
        If source and target components have different zones, the engine adds
        the zone-pair latency from the latency table (see Zones section).
        A TRAVERSED or BACKPRESSURED event is appended.
     c. If QUEUE_HOLD: already handled — the request is inside QueueCapability.
     d. If DROP: a DROPPED event is appended.
     e. For each SPAWN side effect: the engine creates a child Request with
        parentId set and TTL = parent's remaining TTL. The child enters the
        pending queue for the target component. Blocking spawns (from PROCESS)
        register the parent as waiting. Non-blocking spawns (from REPLICATE)
        do not.
     f. For each SCALE side effect: the engine adjusts the component's
        instanceCount to the target value (clamped to min/max bounds).
        The ModeController is consulted for cost implications.

4b. UPDATE ACTIVE STREAMS
    The engine iterates all active_stream requests. For each:
      - Decrement remaining streamDuration by 1
      - If streamDuration reaches 0, complete the stream (release reserved
        bandwidth, append RESPONDED event)
      - If the connection is overloaded, StreamingCapability (if adaptive)
        may degrade the stream's bandwidth rather than dropping it

5. CHECK TTL
   The engine scans all in-flight requests (status != terminal). Any request
   whose createdAt + ttl <= currentTick is timed out: a TIMED_OUT event is
   appended, and if the request has blocking children, they are also timed out
   recursively.

6. UPDATE CONDITION
   For each component, the engine checks this tick's drop/backpressure count.
   If the component dropped or backpressured any requests, its consecutive
   failure counter increments. If it processed all requests cleanly, its
   consecutive success counter increments (and failure counter resets).
   Condition degrades or recovers based on the thresholds defined on the
   condition field.

6b. INJECT CHAOS (if enabled)
    The engine calls the ModeController to check for scheduled failure events
    this tick (see Failure Injection section). If a chaos event fires, the
    engine applies it: set component condition to 0, sever a connection,
    inject latency, etc. Chaos happens after condition update so that
    natural degradation and injected failures are both visible in metrics.

7. DEDUCT UPKEEP
   The engine calls Component.getUpkeepCost() on every placed component
   (accounting for instanceCount — upkeep scales linearly with instances)
   and sums the total. The ModeController deducts this from the budget.
   If the budget is negative, the ModeController flags affected components
   for accelerated condition degradation.

8. RECORD METRICS
   The engine aggregates tick-level metrics: requests processed, requests
   failed, revenue earned, total latency, system upkeep. These feed the
   post-wave assessment and the real-time HUD.

9. RESET PER-TICK STATE
   Connection.currentLoad is reset to 0 for all connections.

10. ADVANCE TICK
    currentTick++. If the ModeController determines the wave/simulation is
    over (TrafficSource duration expired and all in-flight requests resolved),
    the engine calls ModeController.advancePhase() to transition to the
    assess phase.
```

**Ordering matters for determinism.** Traffic injection happens before processing, so new requests don't get processed until the tick they arrive. Queue re-emission happens before processing, so re-emitted requests are treated identically to new arrivals within the same tick. TTL checks happen after processing and delivery, so a request that would time out this tick still gets one chance to complete. Upkeep deduction happens after processing, so revenue from this tick's successful requests is counted before upkeep is charged.

**Requests that span multiple components in one tick:** A request that enters Component A, gets FORWARD'd to Component B, and then FORWARD'd to Component C does NOT traverse all three in a single tick. Each FORWARD adds the request to the pending queue for the next component, but that component processes it in the same tick's step 3 (the pending queue is processed in topological order — upstream components first). Connection latency is still recorded but doesn't delay processing to the next tick. The latency is bookkeeping for the final score, not a real-time delay. This keeps the simulation fast: a full request path can resolve in a single tick, with latency tracked as a metric rather than a scheduling constraint.

---

## The Component Registry

The component registry is a declarative data structure that defines every component the game supports. Adding a new component means adding an entry here — not writing new simulation code.

Each entry specifies:
- `type` — unique identifier
- `name` — display name
- `description` — flavor text
- `capabilities` — ordered list of capability IDs with default tiers and max tiers. **Order matters** — it defines execution order within the same phase (see Execution Pipeline).
- `ports` — port configuration (how many ingress/egress, what data types)
- `placementCost` — base cost
- `upgradeCostCurve` — function or table mapping tier → cost for upgrades
- `visual` — rendering metadata: `{ icon, color, shape }`. This is what the renderer reads. Adding a new component's visual identity is a registry entry, not a renderer change.
- `conditionProfile` — degradation and recovery parameters for this component type: `{ degradedThreshold, criticalThreshold, decayRate, recoveryRate, triggerWindow, degradedEffect, criticalEffect }`. Defaults: `{ degradedThreshold: 0.7, criticalThreshold: 0.3, decayRate: 0.05, recoveryRate: 0.02, triggerWindow: 3, degradedEffect: "latency_bonus_50pct", criticalEffect: "random_drop_20pct" }`. This makes resilience a per-component-type property — a CDN with high placement cost might have a more resilient profile (slower decay, lower critical threshold) than a cheap cache.

**What is NOT in the registry:** Mode-specific behavior. There is no `tdConfig` or `sandboxConfig` here. The ModeController is the single authority for which capabilities are active, at what tier, and under what constraints. The registry describes what a component *can* do. The ModeController decides what it *does* do in the current session. This eliminates the dual-ownership problem where mode logic lives in two places.

**Example entry (conceptual, not code):**

```
Server:
  name: "Server"
  description: "Handles incoming requests. The workhorse of your architecture."
  capabilities:  # ordered — defines intra-phase execution order
    - RetryCapability (default tier: 0 [locked], max tier: 2, phase: INTERCEPT, implements: EngineBufferable)
    - ProcessingCapability (default tier: 1, max tier: 3, phase: PROCESS)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
    - AutoScaleCapability (default tier: 0 [locked], max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "http", capacity: 1 }
    - egress: { dataType: "data", capacity: 2 }
  placementCost: 100
  upgradeCostCurve: [100, 200, 400]
  visual: { icon: "server", color: "#4A90D9", shape: "rectangle" }
  notes: >
    Tier progression:
      Tier 1: Basic request processing. Synchronous request/response.
      Tier 2: Unlocks RetryCapability — automatic retry with exponential backoff
        for transient downstream failures. The player learns that servers in
        microservice architectures need built-in resilience.
      Tier 3: Unlocks AutoScaleCapability — the server can dynamically adjust
        its instanceCount based on load (see Auto-Scaling section).

Database:
  name: "Database"
  description: "Persists data so your servers don't have to remember everything."
  capabilities:
    - StorageCapability (default tier: 1, max tier: 3, phase: PROCESS)
    - SearchCapability (default tier: 0 [locked], max tier: 2, phase: PROCESS)
    - ReplicationCapability (default tier: 0 [locked], max tier: 3, phase: REPLICATE)
    - ShardingCapability (default tier: 0 [locked], max tier: 2, phase: REPLICATE)
    - QueryCapability (default tier: 0 [locked], max tier: 2, phase: PROCESS)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "data", capacity: 3 }
    - egress: { dataType: "data", capacity: 2 }  // for replication
  placementCost: 200
  upgradeCostCurve: [200, 400, 800]
  visual: { icon: "database", color: "#7B68EE", shape: "cylinder" }
  notes: >
    Which capabilities are active and when is controlled entirely by the
    ModeController. In TD mode, the TDModeController gates ReplicationCapability
    behind wave 4+ and ShardingCapability behind wave 7+. In Sandbox mode,
    all capabilities are unlocked. The registry only declares what's possible.
    
    SearchCapability is a tier upgrade, not a separate component. Unlocking it
    shifts the Database's cost profile: CPU-heavy and memory-heavy reads instead
    of storage-heavy. This teaches the real lesson — at scale, your database
    needs to support different access patterns (full-text, fuzzy, ranked results)
    and each pattern has different resource costs. The player sees upkeep spike
    when they enable search, which mirrors the real Elasticsearch cost tradeoff.

Cache:
  name: "Cache"
  description: "Remembers recent responses so your database doesn't get hammered twice."
  capabilities:
    - CachingCapability (default tier: 1, max tier: 3, phase: INTERCEPT)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "data", capacity: 2 }
    - egress: { dataType: "data", capacity: 1 }  // cache miss → forward to DB
  placementCost: 150
  upgradeCostCurve: [150, 300, 600]
  visual: { icon: "cache", color: "#F5A623", shape: "diamond" }
  notes: >
    Tier 1: fixed-size, simple key-value.
    Tier 2: larger, LRU eviction.
    Tier 3: configurable eviction (LRU/TTL/LFU). Can serve stale data under
    load (gameplay tradeoff: speed vs. correctness).

LoadBalancer:
  name: "Load Balancer"
  description: "Splits traffic across multiple servers so no single one gets overwhelmed."
  capabilities:
    - SSLTerminationCapability (default tier: 0 [locked], max tier: 2, phase: INTERCEPT)
    - CompressionCapability (default tier: 0 [locked], max tier: 2, phase: INTERCEPT)
    - FilterCapability (default tier: 0 [locked], max tier: 2, phase: INTERCEPT)
    - RateLimitCapability (default tier: 0 [locked], max tier: 3, phase: INTERCEPT)
    - RoutingCapability (default tier: 1, max tier: 3, implements: EngineConsultable)
    - HealthCheckCapability (default tier: 1, max tier: 2, phase: OBSERVE)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "http", capacity: 1 }
    - egress: { dataType: "http", capacity: 4 }  // fan-out to multiple servers
  placementCost: 175
  upgradeCostCurve: [175, 350, 700]
  visual: { icon: "load-balancer", color: "#50C878", shape: "hexagon" }
  notes: >
    The LoadBalancer absorbs Reverse Proxy and Firewall/WAF as tier upgrades rather
    than separate components. This teaches the real-world pattern: nginx and HAProxy
    blur the line between load balancer, reverse proxy, and edge security.
    
    Tier progression:
      Tier 1: Round-robin routing only. Basic load distribution.
      Tier 2: Least-connections routing. Unlocks SSLTerminationCapability (reverse
        proxy role) and CompressionCapability. The player's LB now handles TLS and
        response compression — the "reverse proxy upgrade."
      Tier 3: Weighted routing + condition-aware (routes away from degraded components).
        Unlocks FilterCapability and RateLimitCapability — the "WAF upgrade." The
        player's edge component now does IP-based rate limiting and request filtering.
    
    This creates a meaningful upgrade decision at tier 2-3: invest in the LB's
    security/edge capabilities, or save budget for an API Gateway (which routes by
    content, not load). Both are valid scaling strategies with different tradeoffs.

Queue:
  name: "Message Queue"
  description: "Buffers requests during traffic spikes. Trades speed for survival."
  capabilities:
    - QueueCapability (default tier: 1, max tier: 3, phase: INTERCEPT)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "any", capacity: 2 }
    - egress: { dataType: "any", capacity: 2 }
  placementCost: 125
  upgradeCostCurve: [125, 250, 500]
  visual: { icon: "queue", color: "#E74C3C", shape: "trapezoid" }
  notes: >
    Tier 1: simple FIFO, fixed buffer.
    Tier 2: larger buffer, priority queue option.
    Tier 3: dead letter queue (failed requests go here instead of being dropped),
    rate limiting. Key tradeoff: queues add latency to EVERY request that passes
    through them, even when the system isn't under pressure.

CDN:
  name: "CDN"
  description: "Serves static content from the edge. Keeps your servers free for real work."
  capabilities:
    - FilterCapability (default tier: 1, max tier: 1, phase: INTERCEPT)   // reject non-static — runs first
    - CachingCapability (default tier: 1, max tier: 2, phase: INTERCEPT)  // serve cached static — runs second
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "http", capacity: 1 }
    - egress: { dataType: "http", capacity: 1 }  // cache miss → forward to origin
  placementCost: 200
  upgradeCostCurve: [200, 400]
  visual: { icon: "cdn", color: "#1ABC9C", shape: "cloud" }
  notes: >
    Only processes static-asset request types. Dynamic requests pass through.
    High placement cost but very low upkeep — teaches that CDNs are a capital
    expense that reduces operational load. Capability order matters: FilterCapability
    runs before CachingCapability within the INTERCEPT phase, so non-static requests
    are rejected before the cache is even consulted.

APIGateway:
  name: "API Gateway"
  description: "The smart front door. Routes by content, handles auth, aggregates responses from multiple services."
  capabilities:
    - AuthCapability (default tier: 1, max tier: 2, phase: INTERCEPT)
    - RateLimitCapability (default tier: 1, max tier: 3, phase: INTERCEPT)
    - RoutingCapability (default tier: 1, max tier: 3, implements: EngineConsultable)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "http", capacity: 2 }
    - egress: { dataType: "http", capacity: 6 }  // fan-out to many microservices
  placementCost: 250
  upgradeCostCurve: [250, 500, 1000]
  visual: { icon: "gateway", color: "#9B59B6", shape: "pentagon" }
  notes: >
    Distinct from LoadBalancer: LB routes on load (which backend has capacity),
    API Gateway routes on content (path, headers, auth tokens). The Gateway also
    aggregates — one inbound request fans out to multiple services and the gateway
    reassembles the response. This fan-out/reassembly uses blocking SPAWNs from
    the PROCESS phase.
    
    Tier progression:
      Tier 1: Path-based routing + basic auth (API key). Per-user rate limiting.
      Tier 2: Header/content-based routing. OAuth/JWT auth. Response aggregation
        from multiple downstream services.
      Tier 3: Request transformation, canary routing (send X% of traffic to a
        new service version). Circuit-breaker-aware routing (integrates with
        downstream CircuitBreaker components via EngineConsultable).
    
    The player learns: "I need a smart front door, not just a traffic splitter."
    Placing an API Gateway is the architectural signal that you've moved from
    monolith to microservices.

ServiceRegistry:
  name: "Service Registry"
  description: "Service discovery. Without it, every new instance means manual rewiring."
  capabilities:
    - RegistrationCapability (default tier: 1, max tier: 2, phase: PROCESS)
    - HealthCheckCapability (default tier: 1, max tier: 2, phase: OBSERVE)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "data", capacity: 4 }  // many components register
    - egress: { dataType: "data", capacity: 1 }   // heartbeat/health probes
  placementCost: 150
  upgradeCostCurve: [150, 300]
  visual: { icon: "registry", color: "#3498DB", shape: "octagon" }
  notes: >
    A meta-component — it doesn't process user requests. Other components consult
    it to discover where to send traffic. Models Netflix's Eureka.
    
    Integration with the engine: when a component with EngineConsultable (e.g.,
    RoutingCapability on an API Gateway) needs to select a connection, the engine
    optionally checks whether a ServiceRegistry exists in the topology. If present,
    the registry provides the list of healthy, registered instances as context to
    the EngineConsultable.selectConnection() call. Without a registry, connections
    are static (player manually wires them). With a registry, new component instances
    auto-register and become available as routing targets.
    
    The teaching moment: "manual wiring doesn't scale. Service discovery is how
    Netflix handles thousands of microservice instances."
    
    Tier progression:
      Tier 1: Basic registration. Components register on placement, deregister on
        removal. HealthCheckCapability detects dead components.
      Tier 2: Zone-aware registration (see Zones section). Heartbeat intervals and
        stale-entry eviction. Self-preservation mode (stops evicting during network
        partitions — models Eureka's real behavior).

Worker:
  name: "Worker"
  description: "Async compute. Pulls from queues instead of waiting for requests."
  capabilities:
    - BatchProcessingCapability (default tier: 1, max tier: 3, phase: PROCESS)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
    - AutoScaleCapability (default tier: 0 [locked], max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "any", capacity: 2 }   // connected to Queue egress
    - egress: { dataType: "data", capacity: 1 }   // output to storage/other services
  placementCost: 125
  upgradeCostCurve: [125, 250, 500]
  visual: { icon: "worker", color: "#E67E22", shape: "gear" }
  notes: >
    Fundamentally different processing model from Server. Server is push (requests
    arrive via connections). Worker is pull (it pulls from a connected Queue during
    each tick). The engine handles this activation pattern: during step 2 of the
    simulation tick (RE-EMIT QUEUED), Workers with BatchProcessingCapability check
    their connected Queue and pull N items based on their tier's batch size.
    
    Tier progression:
      Tier 1: Pulls 1 item per tick. Simple sequential processing. Models basic
        background jobs (video transcoding, email sending).
      Tier 2: Pulls N items per tick (batch). Higher throughput, same latency per
        item. Models batch analytics (process 100 video segments at once).
      Tier 3: Unlocks AutoScaleCapability. Worker pool scales with queue depth.
        The teaching moment: "auto-scaling workers is how Netflix transcodes
        millions of video segments without maintaining an army of idle servers."

CircuitBreaker:
  name: "Circuit Breaker"
  description: "Stops cascading failures. When a downstream service dies, stop hammering it."
  capabilities:
    - CircuitBreakerCapability (default tier: 1, max tier: 3, phase: INTERCEPT, implements: EngineConsultable)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "any", capacity: 2 }
    - egress: { dataType: "any", capacity: 2 }
  placementCost: 100
  upgradeCostCurve: [100, 200, 400]
  visual: { icon: "circuit-breaker", color: "#E74C3C", shape: "shield" }
  notes: >
    Placed between a caller and a flaky downstream service. The player literally
    sees requests bouncing off the circuit breaker instead of cascading into a
    dead service. Models Netflix's Hystrix.
    
    CircuitBreakerCapability operates in three states:
      CLOSED (normal): requests pass through. Failure counter tracks consecutive
        failures on downstream connections.
      OPEN (tripped): after N failures, the circuit opens. All requests get an
        immediate RESPOND with a fallback/error — no traffic sent downstream.
        This prevents the "thundering herd hitting a dead service" anti-pattern.
      HALF-OPEN (probing): after a cooldown period, the circuit allows one probe
        request through. If it succeeds, circuit closes. If it fails, circuit
        reopens. This tests recovery without flooding a recovering service.
    
    The EngineConsultable implementation: when the engine consults for routing,
    CircuitBreakerCapability can veto connections to components whose circuits
    are OPEN — the engine skips those connections entirely.
    
    Tier progression:
      Tier 1: Fixed failure threshold (5 failures → open). Fixed cooldown (10 ticks).
      Tier 2: Configurable thresholds. Percentage-based tripping (50% failure rate
        over a sliding window). Fallback responses instead of errors.
      Tier 3: Per-connection circuit states. Bulkhead isolation (limits concurrent
        requests per downstream, preventing one slow service from consuming all
        connections). Models Hystrix's thread pool isolation.

DNSGlobalTrafficManager:
  name: "DNS / Global Traffic Manager"
  description: "Geographic routing. Sends users to the nearest healthy region."
  capabilities:
    - GeoRoutingCapability (default tier: 1, max tier: 2, implements: EngineConsultable)
    - HealthCheckCapability (default tier: 1, max tier: 2, phase: OBSERVE)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "http", capacity: 1 }      // from TrafficSource
    - egress: { dataType: "http", capacity: 4 }        // to per-zone entry points
  placementCost: 300
  upgradeCostCurve: [300, 600]
  visual: { icon: "globe", color: "#2ECC71", shape: "globe" }
  notes: >
    Sits above the per-zone topologies. This is the first component a request
    hits, and its only job is routing to the correct zone. The TrafficSource
    generates requests with an originZone field (where the simulated user is
    located). GeoRoutingCapability selects the egress connection to the nearest
    healthy zone based on the zone-pair latency table (see Zones section).
    
    Tier progression:
      Tier 1: Nearest-zone routing. If the nearest zone is unhealthy (all
        components in critical condition), falls back to next-nearest.
      Tier 2: Weighted geo-routing (send 70% to nearest, 30% to next-nearest
        for redundancy). Latency-based routing (considers current zone load,
        not just geographic proximity). Active-active failover — if one zone
        goes down, traffic seamlessly shifts to surviving zones.
    
    This component unlocks the multi-region gameplay at iteration 9. Without it,
    the player's architecture is "one really well-built datacenter." With it,
    they learn the core global scaling lesson: replicate your architecture
    across zones and route users to the nearest one.

BlobStorage:
  name: "Blob Storage"
  description: "Stores massive unstructured assets. Video files, images, binaries."
  capabilities:
    - BlobStorageCapability (default tier: 1, max tier: 3, phase: PROCESS)
    - ReplicationCapability (default tier: 0 [locked], max tier: 2, phase: REPLICATE)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "data", capacity: 2 }
    - egress: { dataType: "data", capacity: 2 }   // cross-region replication
  placementCost: 250
  upgradeCostCurve: [250, 500, 1000]
  visual: { icon: "storage", color: "#95A5A6", shape: "cube" }
  notes: >
    Architecturally distinct from Database. Database stores structured data with
    low-latency random access. BlobStorage stores petabytes of unstructured data
    with high-bandwidth sequential access. Different cost profile: very cheap
    storage per unit, but high bandwidth cost and higher base latency. Models
    Netflix's use of S3 for video assets.
    
    Tier progression:
      Tier 1: Basic blob storage. High latency, high bandwidth. Serves full
        objects in a single response.
      Tier 2: Tiered storage (hot/cold). Frequently accessed blobs served faster,
        cold blobs have higher latency. Unlocks cross-region ReplicationCapability.
      Tier 3: Intelligent caching integration — pre-warms CDN caches with popular
        content. Lifecycle policies (auto-archive cold data to reduce upkeep).
    
    The teaching moment: "you don't store video files in your PostgreSQL database."

StreamingMediaServer:
  name: "Streaming / Media Server"
  description: "Adaptive bitrate streaming. Delivers video as a sustained flow, not a single response."
  capabilities:
    - StreamingCapability (default tier: 1, max tier: 3, phase: PROCESS)
    - CachingCapability (default tier: 1, max tier: 2, phase: INTERCEPT)
    - MonitoringCapability (default tier: 1, max tier: 2, phase: OBSERVE)
  ports:
    - ingress: { dataType: "http", capacity: 2 }
    - egress: { dataType: "data", capacity: 2 }   // pulls from BlobStorage
  placementCost: 300
  upgradeCostCurve: [300, 600, 1200]
  visual: { icon: "stream", color: "#E91E63", shape: "play-button" }
  notes: >
    Fundamentally different from request/response components. A single streaming
    request is a sustained flow — it occupies connection bandwidth for multiple
    ticks (see Streaming Requests under Request Types). This means a few streaming
    requests can saturate a connection that handles hundreds of normal requests.
    
    Tier progression:
      Tier 1: Fixed bitrate streaming. One quality level. Each stream occupies
        a fixed bandwidth for its duration.
      Tier 2: Adaptive bitrate. StreamingCapability adjusts bandwidth per stream
        based on connection congestion — degrades quality instead of buffering.
        CachingCapability caches popular stream segments.
      Tier 3: Chunked delivery with prefetching. Reduces initial latency by
        serving the first chunk from cache while fetching subsequent chunks
        from BlobStorage. Models Netflix's Open Connect.
    
    The teaching moment: "streaming isn't just a fast download — it's a
    fundamentally different traffic pattern that needs its own infrastructure."
```

---

## Extensibility Patterns

### Adding a new component

1. Define the capability bundle (which existing capabilities does it use?)
2. If it needs a new capability, implement the Capability interface and register it
3. Add an entry to the component registry with ports, costs, flavor text, and `visual` metadata (icon, color, shape)
4. Done. No simulation code modified. No renderer code modified — the renderer reads `visual` from the registry.

### Adding a new capability

1. Implement the Capability interface: `canHandle()`, `process()`, `getUpkeepCost()`, `getStats()`, `configure()`
2. If the capability needs to influence delivery routing, also implement `EngineConsultable`. If it needs to buffer requests for the engine, also implement `EngineBufferable`. These are opt-in sub-interfaces — the engine discovers them automatically.
3. Register it in the CapabilityRegistry
4. Add it to any component registry entries that should have it
5. If it has Sandbox configuration, define the config schema
6. Done. No component code modified. No engine code modified — even engine-consulted capabilities are discovered through interfaces.

### Adding a new component type that combines existing capabilities in a novel way

This is the most common extensibility case. The 7 new components (API Gateway, Service Registry, Worker, Circuit Breaker, DNS/GTM, Blob Storage, Streaming/Media Server) were all added this way — each is a novel composition of new and existing capabilities with a registry entry. No simulation code was modified.

### Adding a new zone

1. Add the zone ID to the zone-pair latency table
2. Define latency values to all existing zones
3. Done. No component, capability, or engine code modified. The engine reads the table dynamically.

### Adding a new request type

1. Define the type string (e.g., `"stream"`, `"batch"`, `"event"`)
2. If the type has additional properties (e.g., `streamDuration`), add them to the Request schema
3. Implement or reuse capabilities that handle the new type via `canHandle()`
4. Add the type to TrafficSource's `requestTypes` distribution
5. Done. The engine doesn't know about specific request types — capabilities declare which types they handle.

### Adding a new mode

1. Implement the ModeController interface
2. Define which capabilities are active, what the traffic model is, what the win condition is
3. Optionally configure chaos events (failure injection timing and severity)
4. Register the mode
5. Done. No component or capability code modified.

---

## What This Architecture Prevents

- **The god class.** No single class knows about all component types. The simulation engine only knows about `Component`, `Capability`, `Connection`, and `Request`. All 13 component types are interchangeable from the engine's perspective.
- **The switch statement.** Nowhere in the simulation does anyone write `if (component.type === "database") { ... }`. All behavior is dispatched through capabilities. The engine's two special-case interactions (routing and buffering) go through sub-interfaces (`EngineConsultable`, `EngineBufferable`), not type checks on specific capability classes.
- **The refactor cascade.** Adding a component doesn't require modifying the simulation, the economy, the routing, or the rendering. It's a registry entry. This was validated by adding 7 new components and 13 new capabilities without touching the engine design.
- **Mode coupling.** Components don't know about modes. Modes don't know about specific components. The ModeController is the only bridge, and it operates on the generic Capability interface. Chaos engineering lives on the ModeController, not on components.
- **Rendering coupling.** The simulation produces state. The renderer reads state. Swapping from flat 2D to isometric requires zero simulation changes.
- **Zone coupling.** Zones are a property on Components and a latency table the engine reads. No capability, component, or mode knows about zone topology. Adding a new zone is a config change.

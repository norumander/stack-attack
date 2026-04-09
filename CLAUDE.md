# BrainLift: System Architecture Tower Defense Game

## What This Is

A tower defense game that teaches system architecture through gameplay. User traffic is the enemy, infrastructure components are the towers, and a live economy (revenue per request, operational costs, budget constraints) makes architecture decisions feel like business decisions.

The game must stand on its own as a strategy game first. The learning is the long-term payoff; the fun is what gets players there. Position as a strategy game, let the architecture depth be the surprise.

**KSP analogy:** KSP doesn't teach aerospace engineering, but after playing it every orbital mechanics concept has an experiential anchor. We do the same for system architecture. A player who finishes this game and later encounters caching, load balancing, or sharding in a tutorial already has the intuition. The game is a force multiplier for every system design resource that comes after it.

## Two Modes, One Engine

- **TD Mode** (ships first): Game-first. Components expose limited capabilities through placement, connection, and upgrades. Waves of traffic test the player's architecture under pressure. Build -> watch -> assess -> repeat. No mid-wave intervention.
- **Sandbox Mode** (designed-for from day one, built later): Full capability set unlocked. Player configures traffic patterns, triggers chaos events, explores architecture tradeoffs without economic pressure. The bridge from intuition to practice.

Both modes share the same component system. A Database in TD mode has `StorageCapability(tier=1)` and flavor text. The same Database in Sandbox mode exposes `SchemaCapability`, `ReplicationCapability`, and `QueryCapability`. The ModeController determines the aperture; components never know which mode they're in.

## Core Design Principles

### Fun First, Education as Byproduct
The moment a player perceives they are being taught, engagement drops. Learning objectives are embedded entirely within gameplay mechanics. Cache invalidation surfaces as a gameplay problem (stale data, performance drops), not a tooltip.

### Real Terminology from Day One
Use real industry terms (cache, load balancer, database shard) paired with clear one-liners and immediate behavioral confirmation. The Montessori principle: children learn the real word just as easily as a simplified one, and only the real word connects to knowledge outside the game. A cache called "cache" connects to every tutorial and job posting; a cache called "Memory" connects to nothing.

### Tradeoffs, Not Right Answers
The game's economy couples cost, performance, and reliability into a single feedback loop. Underspend -> performance drops -> fewer successful requests -> less revenue -> death spiral. Overspend -> upkeep drains budget -> can't scale for the next wave. The best architecture is the cheapest one that still performs under realistic worst-case load. Multi-axis scoring (cost, performance, reliability) means no single "best" solution -- only a Pareto frontier of valid tradeoffs.

### Build -> Watch -> Assess -> Repeat
No mid-wave intervention. The player commits to their architecture, launches the wave, and watches. This maps to how real engineering works (deploy, observe, diagnose, iterate), eliminates extraneous cognitive load (Sweller), and creates natural windows for reflection-on-action (Schon). The auto-battler model (TFT) proves this loop commercially viable.

### Guided Component Intros Before Each TD Round
Each level opens with a guided intro: same environment, same pieces as the TD round, but without budget pressure or waves. Clear name, one-liner, place it, watch it work. Then the TD round applies that component under real constraints. Fast, skippable on replay, under a minute.

### The Simulation Must Produce Wrong Intuitions on Purpose
Caches should not always help (cache invalidation is a real problem). Load balancers should not always matter (some bottlenecks are downstream). Queues solve one problem while creating another (latency vs. throughput). Open-ended levels with multiple valid architectures create both replayability and genuine learning.

## Architecture Overview

### Capability-Based Component System

**The core abstraction:** Components are named bundles of capabilities with visual identities, cost curves, and ports. The Component class is generic -- what makes a "Database" different from a "Server" is its capability bundle, port configuration, and flavor text.

**Key principles:**
1. **Composition over inheritance.** A Database is not a subclass of Component. It's a Component that *has* StorageCapability, ReplicationCapability, and QueryCapability.
2. **Open/Closed.** The simulation engine, routing, and economy are closed to modification. New components and capabilities are added by implementing interfaces and registering.
3. **Capabilities are the atomic unit of behavior.** Everything a component "does" is a capability.
4. **Mode controllers filter, they don't modify.** Same component object in TD and Sandbox. The ModeController determines which capabilities are visible and at what tier.
5. **Rendering-agnostic.** Simulation produces state. Renderer reads state. They never call each other.

### Seven Core Abstractions

1. **Request** -- Immutable creation snapshot (id, type, payload, origin, TTL, originZone, streamDuration, streamBandwidth). All state changes appended as events to the RequestLog. Deterministic, debuggable, replayable.

2. **Capability** -- Atomic unit of behavior. Declares a phase (INTERCEPT, PROCESS, REPLICATE, OBSERVE), implements `canHandle()`, `process()`, `getUpkeepCost()`. Stateless re: tier/activation (owned by Component and ModeController). Stateful re: operational data (cache entries, queue buffers).

3. **Component** -- Named bundle of capabilities. Generic pipeline runner. Owns `capabilityTiers` map. Methods: `process()` (runs pipeline), `getUpkeepCost()` (sums capabilities), `upgrade()`. No subclasses -- a Database is `new Component({ type: "database", capabilities: [...] })`.

4. **Port** -- Typed connection point (ingress/egress) with dataType and capacity. Enforces valid topologies at the type system level.

5. **Connection** -- Directional link between ports. Passive pipe with bandwidth limits and fixed latency. Does not buffer. Excess requests rejected with BACKPRESSURE.

6. **TrafficSource** -- Generates requests. In TD: wave system (pattern, requestTypes distribution, intensity, duration). In Sandbox: player-configurable traffic generator.

7. **ModeController** -- Sits above everything. Determines active capabilities, build constraints, traffic sources, outcome evaluation, budget/economy. TDModeController manages waves, economy, phases. SandboxModeController unlocks everything.

### Execution Pipeline (fixed order)

1. **INTERCEPT** -- Runs first. Can short-circuit (RESPOND, FORWARD, DROP, QUEUE_HOLD) or PASS. Caching, auth, rate limiting, circuit breaking live here.
2. **PROCESS** -- Main work. Only one PROCESS capability runs per request (first `canHandle()` match). Processing, storage, querying live here.
3. **REPLICATE** -- After PROCESS succeeds. Appends SPAWN side effects without overriding primary outcome. Replication, sharding live here.
4. **OBSERVE** -- Unconditional, read-only. Monitoring, health checks, auto-scaling live here.

### Engine Sub-Interfaces
- **EngineConsultable** -- `selectConnection()` for delivery routing decisions. RoutingCapability, CircuitBreakerCapability, GeoRoutingCapability implement this. Fallback: round-robin.
- **EngineBufferable** -- `enqueueForRetry()` / `emitReady()` for backpressure handling. QueueCapability implements this. Fallback: drop.

### Economy Model

- **Income:** Revenue per successfully resolved request (varies by type).
- **Upkeep (recurring):** Every active capability costs per tick, busy or idle. `Component.getUpkeepCost()` is the single source of truth.
- **Placement cost (one-time):** Defined in component registry.
- **Upgrade cost (one-time):** Escalates per tier (roughly doubling), forcing prioritization.
- **The tradeoff loop:** More components = more capacity = more revenue BUT more upkeep = tighter margins = less room to scale. The winning architecture is the leanest one that survives.

### Component Registry (13 components)

| Component | Key Capabilities | Role |
|---|---|---|
| Server | ProcessingCapability, RetryCapability, AutoScaleCapability | General-purpose compute workhorse |
| Database | StorageCapability, ReplicationCapability, ShardingCapability, QueryCapability, SearchCapability | Persistent structured data |
| Cache | CachingCapability | Intercepts repeated reads, reduces DB load |
| Load Balancer | RoutingCapability, HealthCheckCapability, FilterCapability, RateLimitCapability, SSLTermination, Compression | Distributes traffic, absorbs reverse proxy + WAF via tier upgrades |
| Queue | QueueCapability | Buffers traffic spikes, trades speed for survival |
| CDN | FilterCapability, CachingCapability | Serves static content from edge, frees servers |
| API Gateway | AuthCapability, RateLimitCapability, RoutingCapability | Smart front door: routes by content, handles auth, aggregates |
| Service Registry | RegistrationCapability, HealthCheckCapability | Service discovery, auto-registration |
| Worker | BatchProcessingCapability, AutoScaleCapability | Async compute, pulls from queues |
| Circuit Breaker | CircuitBreakerCapability | Prevents cascading failure (closed/open/half-open) |
| DNS/GTM | GeoRoutingCapability, HealthCheckCapability | Geographic routing to nearest healthy region |
| Blob Storage | BlobStorageCapability, ReplicationCapability | Massive unstructured assets (video, images) |
| Streaming/Media Server | StreamingCapability, CachingCapability | Adaptive bitrate streaming, sustained flows |

## Wave Progression (10 waves + boss waves)

Two axes of scaling that combine multiplicatively:
- **Quantitative (intensity):** Raw requests/tick increases each wave. Countered by horizontal scaling.
- **Qualitative (diversity):** New request types appear that existing architecture handles poorly. Countered by specialized components.

Request types never disappear. Wave 10 still has `api_read` from wave 1. Every solution must be forward-compatible.

### Request Types

| Type | Key Properties | Specialized Counter |
|---|---|---|
| `api_read` | processingCost: 1, baseline | Server (this IS the counter) |
| `api_write` | processingCost: 2, requiresStorage | Server + Database |
| `static_asset` | low compute, high bandwidth, cacheable | CDN (~10x efficiency) |
| `auth_required` | requiresAuth before processing | API Gateway (~2x efficiency) |
| `batch` | processingCost: 10, async, long TTL | Queue + Worker (~5x efficiency) |
| `stream` | sustained bandwidth for 20 ticks | Streaming/Media Server (~3x) |
| `event` | fanout to all subscribers | ReplicationCapability (can't be brute-forced) |

### Wave Summary

| Wave | Name | New Element | Architectural Lesson |
|---|---|---|---|
| 1 | Launch Day | `api_read` only, 10 rps | Request/response cycle, what a server does |
| 2 | Users Start Signing Up | `api_write`, 25 rps | Read/write asymmetry, separation of compute and storage |
| 3 | Traffic Spikes | Intensity 5x, 50 rps | Horizontal scaling + caching as complementary strategies |
| 4 | Marketing Adds Images | `static_asset`, 80 rps | Edge caching, CDN capital expense reduces operational load |
| 5 | The Authentication Wall | `auth_required`, 150 rps | API Gateway pattern, cross-cutting concerns at the edge |
| 6 | Async Workloads | `batch` + `event`, 250 rps | Async processing, event-driven architecture, queue decoupling |
| 7 | The Outage | Chaos event (component failure), 350 rps | Cascading failure, circuit breakers, resilience patterns |
| 8 | Video Launch | `stream`, 500 rps | Traffic isolation, streaming needs dedicated infrastructure |
| 9 | Going Global | Multi-zone + geo-routing, 800 rps | Multi-region architecture, CAP theorem, data consistency |
| 10 | The Viral Moment | 3000+ rps + multi-chaos | Auto-scaling, elastic infrastructure, everything tested together |

### Boss Waves (optional, high-risk/high-reward)
- **DDoS Attack** (after W5): Massive invalid `auth_required` spike. Tests rate limiting + auth rejection.
- **Recommendation Storm** (after W6): Event avalanche. Tests pub/sub + async pipeline.
- **Season Premiere** (after W8): 50x `stream` spike in one zone. Tests streaming capacity + CDN warm-up.
- **Chaos Monkey** (after W9): Continuous random failures across all zones. Tests entire resilience stack.

### Economic Pressure Curve

Brute-force with generic Servers becomes unsustainable as diversity increases:
- Waves 1-3: ~10% savings from specialization (brute force is fine)
- Waves 4-5: ~35% savings (CDN and Gateway pay for themselves)
- Waves 6-7: ~45% savings (async pipeline + Circuit Breaker)
- Waves 8-9: ~55% savings (streaming isolation + multi-zone)
- Wave 10: ~63% savings (auto-scaling vs. permanent over-provision)

## Simulation Engine

### The Simulation Tick (10 steps, fixed order for determinism)

1. INJECT TRAFFIC -- TrafficSource generates new requests
2. RE-EMIT QUEUED -- QueueCapabilities emit ready requests; Workers pull from Queues
3. PROCESS PENDING -- Engine runs Component.process() on each pending request (topological order)
4. DELIVER RESULTS -- FORWARD/SPAWN through connections, handle backpressure, process SCALE side effects
4b. UPDATE ACTIVE STREAMS -- Decrement stream durations, release bandwidth on completion
5. CHECK TTL -- Timeout expired requests (recursive for blocking children)
6. UPDATE CONDITION -- Component health degrades on failures, recovers on clean processing
6b. INJECT CHAOS -- ModeController fires scheduled failure events
7. DEDUCT UPKEEP -- Sum all component upkeep, deduct from budget
8. RECORD METRICS -- Aggregate tick-level metrics for HUD and post-wave assessment
9. RESET PER-TICK STATE -- Clear connection load counters
10. ADVANCE TICK -- Check if wave is over, transition to assess phase

### Key Engine Behaviors

- **Backpressure is a delivery concern, not a processing concern.** Pipeline decides outcome. Engine attempts delivery. QueueCapability is the only buffer.
- **Requests can traverse multiple components in one tick** (topological order). Connection latency is bookkeeping for scoring, not a scheduling delay.
- **Response transport uses a dedicated reply channel** (reconstructed from event log). Responses never fail. Bandwidth contention only applies on the forward path.
- **Sub-requests:** Blocking SPAWNs (from PROCESS) must complete before parent resolves. Non-blocking SPAWNs (from REPLICATE) are fire-and-forget.

### Zones & Multi-Region

- Zone is a property on Component, assigned at placement
- Zone-pair latency table adds latency to cross-zone connections
- DNS/GTM routes by `request.originZone` to nearest healthy zone
- Going multi-region multiplies the entire topology (cost scales linearly, resilience scales non-linearly)
- Cross-zone replication makes eventual consistency visible (CAP theorem through experience)

### Auto-Scaling

- `instanceCount` on Component (throughput and upkeep scale linearly)
- `AutoScaleCapability` (OBSERVE phase) monitors load, emits SCALE side effects
- Cooldown prevents oscillation; higher tiers = faster reaction + predictive scaling

## Extensibility Contract

The architecture is validated: adding 7 new components and 13 new capabilities required zero engine modifications.

- **New component:** Define capability bundle + registry entry (ports, costs, visual, conditionProfile). No simulation/renderer code modified.
- **New capability:** Implement Capability interface + optional EngineConsultable/EngineBufferable. Register. No engine code modified.
- **New request type:** Define type string + properties. Capabilities declare handling via `canHandle()`. Engine doesn't know about specific types.
- **New zone:** Add to zone-pair latency table. No code modified.
- **New mode:** Implement ModeController interface. No component/capability code modified.

## What the Architecture Prevents

- **The god class.** Engine only knows Component, Capability, Connection, Request. All 13 component types are interchangeable.
- **The switch statement.** No `if (component.type === "database")` anywhere. Behavior dispatched through capabilities. Engine uses sub-interfaces (EngineConsultable, EngineBufferable), not type checks.
- **The refactor cascade.** Adding a component is a registry entry, not a code change.
- **Mode coupling.** Components don't know about modes. Modes don't know about specific components.
- **Rendering coupling.** Simulation produces state. Renderer reads state. Swappable.

## Tech Stack

React + TypeScript + Pixi.js (or raw canvas). Chosen for:
- TypeScript's type system enforces the capability pattern at compile time
- AI agents operate most effectively in TypeScript (strongest language support, can run own tests, refactor confidently)
- If engine goes open-source, TypeScript has a much larger contributor base than GDScript
- Game needs (scene graph, UI, entity-component plumbing) are met by React's component model + thin canvas layer

**Simulation layer must be framework-agnostic** -- pure TypeScript that doesn't know about React. Rendered by React. Agents and humans can work on both independently.

## Document Lineage

This CLAUDE.md synthesizes and serves as the canonical reference for:
- `brainlift-system-architecture-game.md` -- Purpose, SPOVs, research insights, market analysis, design theory
- `component-architecture.md` -- Object model, execution pipeline, simulation tick, component registry, extensibility
- `wave-progression-strategy.md` -- Traffic scaling axes, request types, wave-by-wave progression, economic pressure model

All new documents, feature specs, and implementation work should be tethered to the concepts defined here. If a new doc contradicts this one, reconcile explicitly -- don't let silent drift accumulate.

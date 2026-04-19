# Stack Attack: System Architecture Tower Defense Game

> A tower defense game that teaches system architecture through gameplay. Traffic is the enemy, infrastructure is the towers, and a live economy makes architecture decisions feel like business decisions.

**Public URL:** *https://stackattack.app* (tentative -- not yet deployed)

**Repository:** https://github.com/norumander/g4-capstone

---

## Overview

Stack Attack is a strategy game where players build and connect infrastructure components (servers, caches, load balancers, databases, queues, CDNs, etc.) to handle waves of increasing user traffic. A live economy -- revenue per request, operational upkeep per component, placement and upgrade costs -- turns every architecture decision into a business decision.

**The KSP analogy:** Kerbal Space Program doesn't teach aerospace engineering, but after playing it every orbital mechanics concept has an experiential anchor. Stack Attack does the same for system architecture. A player who finishes this game and later encounters caching, load balancing, or sharding in a tutorial already has the intuition.

## Game Modes

| Mode | Description |
|---|---|
| **Tower Defense** | Wave-based gameplay. Build your architecture, launch the wave, watch it perform. No mid-wave intervention. Build -> Watch -> Assess -> Repeat. |
| **Sandbox** | Full capability set unlocked. Configure traffic patterns, trigger chaos events, explore tradeoffs without economic pressure. |

Both modes run on the same simulation engine and component system.

## Features

### Simulation Engine (Pure TypeScript, Framework-Agnostic)

- **Deterministic 10-step tick loop** -- seeded RNG, topological visit order, identical replays from the same seed
- **4-phase execution pipeline** -- INTERCEPT -> PROCESS -> REPLICATE -> OBSERVE
- **Fixed-point processing** with throughput gating and backpressure handling
- **Delivery outcomes** -- FORWARD, RESPOND, DROP, QUEUE_HOLD, SPAWN (blocking + non-blocking)
- **Strict cascade** -- parent/child request chains with sibling cancellation
- **TTL expiry** -- scans pending, blocked, and buffered requests with cascade propagation
- **Active stream tracking** -- streaming requests with duration, bandwidth allocation, and revenue crediting
- **Condition system** -- component health degrades on failures, recovers on clean processing
- **Chaos injection** -- component failure, zone outage, latency injection, connection severing
- **Economy loop** -- revenue crediting on RESPOND, per-tick upkeep deduction with insolvency rules
- **Multi-zone support** -- zone-pair latency tables, geo-routing, cross-zone replication

### Capability Library (23 Production Capabilities)

| Phase | Capabilities |
|---|---|
| **INTERCEPT** | Filter, SSL Termination, Compression, Rate Limit, Auth, Caching (LRU), Queue, Circuit Breaker, Retry |
| **PROCESS** | Processing, Forwarding, Storage, Search, Query, Registration, Blob Storage, Streaming, Batch Processing |
| **OBSERVE** | Monitoring, Health Check, Auto-Scale |
| **Engine-only** | Routing (EngineConsultable), Geo-Routing (EngineConsultable) |

### Component Registry (14 Components)

| Component | Role |
|---|---|
| Client | Entry point for external traffic |
| Server | General-purpose compute workhorse |
| Database | Persistent structured data with storage, replication, sharding |
| Cache | Intercepts repeated reads, reduces downstream load |
| Load Balancer | Distributes traffic with round-robin / least-load / condition-aware routing |
| Queue | Buffers traffic spikes, trades latency for survival |
| CDN | Serves static content from edge, frees servers |
| API Gateway | Smart front door: routes by content, handles auth, rate limits |
| Service Registry | Service discovery and auto-registration |
| Worker | Async compute, pulls from queues |
| Circuit Breaker | Prevents cascading failure (closed/open/half-open) |
| DNS/GTM | Geographic routing to nearest healthy region |
| Blob Storage | Massive unstructured assets (video, images) |
| Streaming Media Server | Adaptive bitrate streaming, sustained flows |

### Tower Defense Mode (Waves 1-3 Playable)

- **Wave 1 -- Launch Day:** `api_read` only, 10 rps. Teaches request/response cycle.
- **Wave 2 -- Users Start Signing Up:** `api_write` introduced, 25 rps. Teaches read/write asymmetry, compute vs. storage separation.
- **Wave 3 -- Traffic Spikes:** Intensity 5x, 50 rps. Teaches horizontal scaling, caching as a strategy. Lone server *loses*; cache or load balancer *rescues*.
- **SLA gate mechanic** -- wave pass/fail based on drop threshold
- **Budget and allowlist constraints** per wave
- **Waves 4-10 + boss waves** designed, not yet implemented — see [`docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md`](docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md) for the per-wave implementation roadmap and live status table

### Sandbox Dashboard (Vite)

- **5 topology presets:** Server Only, Cache -> Server, Load Balanced -> Server x2, Cache -> Server -> Database, API Gateway -> Server
- **Traffic controls** with configurable intensity and request types
- **Real-time Chart.js visualization** -- throughput and latency over time
- **Live stats panel** -- resolved, dropped, timed out, backpressured, reliability %, avg latency, revenue, upkeep
- **Component health bars** -- visual condition monitoring
- **Chaos panel** -- kill component, inject latency, zone outage, sever connection
- **Scenario save/load** -- export and import simulation state as JSON

### TD Dashboard

- **Component palette** with click-to-place on grid
- **SVG connection rendering** between placed components
- **Wave progression** with status banner and phase display
- **Loss modal** with retry/reset options

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) |
| Simulation | Pure TypeScript, framework-agnostic -- no React/framework imports |
| Dashboard | Vite + Chart.js |
| Testing | Vitest |
| Package Manager | pnpm |
| Future UI | React + Pixi.js (planned) |

## Getting Started

```bash
# Clone
git clone https://github.com/norumander/g4-capstone.git
cd g4-capstone

# Install dependencies
pnpm install

# Run the test suite (564 tests)
pnpm test

# Type checking
pnpm typecheck

# Launch the sandbox dashboard
pnpm dev
# Opens at http://localhost:5173 (or next available port)
```

## Development

```bash
pnpm test                              # full suite (~4s, 564 tests)
pnpm test tests/unit/<name>.test.ts    # single file
pnpm test tests/integration/           # integration tests only
pnpm test:watch                        # watch mode
pnpm typecheck                         # strict tsc --noEmit
```

### Project Structure

```
src/
  core/
    capability/      # Capability interface, engine sub-interfaces, predicates
    component/       # Component class, pipeline runner, effective tier
    engine/          # One file per tick step (29 files) + helpers
    mode/            # ModeController, EconomyStrategy, TrafficSource interfaces
    registry/        # Component and capability registries
    state/           # SimulationState, state reader
    types/           # All type definitions (ids, request, result, port, etc.)
  capabilities/      # 23 production capability implementations
  modes/
    sandbox/         # SandboxModeController, traffic presets, scenarios
    td/              # TDModeController, waves, economy, traffic source
  dashboard/         # Vite app: sandbox + TD dashboard UI
tests/
  unit/              # ~100 unit test files
  integration/       # ~16 integration test files (including TD wave tests)
  harness/           # Reusable test fixtures, capabilities, and stubs
docs/
  superpowers/
    specs/           # Design specifications per stage
    plans/           # Implementation plans per stage
```

## Implementation Progress

| Stage | Status | Description |
|---|---|---|
| Stage 1 | Done | Foundation types, Component, SimulationState, registries, ModeController interfaces |
| Stage 2a | Done | Full 12-step Engine.tick, fixed-point processing, delivery with backpressure, cascade/TTL, metrics |
| Stage 2b | Done | Condition effects, chaos injection, upkeep deduction, revenue crediting |
| Stage 2c | Done | Bufferable TTL scanning, SCALE side effects, RoutingCapability with tier progression |
| Stage 3a | Done | 23 production capabilities, 14-component registry, sandbox dashboard, Wave 1-3 TD mode |
| Stage 3b | Done | TD playable loop: tryPlace/tryConnect, multi-wave controller, TD dashboard with palette/grid/HUD |
| Stage 3c | Done | Playable polish -- Pixi renderer, teaching surfaces, expanded event metadata |
| Waves 4-10 | Planned | Per-wave roadmap with live status at [`docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md`](docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md) |

## Design Principles

- **Fun first** -- learning is a byproduct; anything that feels pedagogical gets cut
- **Real terminology** -- "cache" not "memory cache"; the real word connects to every tutorial and job posting
- **Tradeoffs, not right answers** -- multi-axis scoring (cost, performance, reliability), no single best solution
- **Build -> Watch -> Assess** -- no mid-wave intervention, maps to deploy/observe/diagnose/iterate
- **Wrong intuitions on purpose** -- caches don't always help, load balancers don't always matter, queues trade latency for throughput

## Architecture Highlights

- **Composition over inheritance** -- components are named bundles of capabilities, not subclasses
- **Open/Closed** -- new components and capabilities added by implementing interfaces and registering; zero engine modifications required
- **Rendering-agnostic** -- simulation produces state, renderer reads state, they never call each other
- **Mode controllers filter, they don't modify** -- same component object in TD and Sandbox; the ModeController determines the capability aperture

## License

Private -- not yet open-sourced.

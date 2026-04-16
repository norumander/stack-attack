# Wave Restructure Proposal: Pattern-Based Teaching

**Status:** Draft — awaiting partner feedback. If approved, this would replace the current 10-wave Netflix campaign with an 8-wave version where each wave teaches a pattern requiring 2-3 new components.

## Motivation

The current 10-wave structure has three thin spots where a wave is "place one component and win":
- Wave 3 (Cache) and Wave 4 (CDN) both add a single caching component
- Wave 5 (Gateway) adds a single auth handler
- The LB never has its own teaching moment — it's always incidental

Playtest results confirmed this: 6/10 waves could be won with minimal topology, and the "optimal" solutions often skipped components the wave was supposed to teach.

## Core principle

Each wave teaches a **pattern**, not a single component. Patterns require 2-3 components working together, creating richer architectural decisions and more compelling gameplay.

## Revised 8-wave structure

### Wave 1: "Launch Day" — Build a basic web stack
- **Traffic:** api_read + api_write, low intensity
- **Delta:** 3 components (Client → Server → Database) + wiring
- **Pattern:** Request-response + persistence

### Wave 2: "Growth Spike" — Caching + horizontal scale
- **Traffic:** Same types, 4× intensity
- **Delta:** Cache + LB + second Server + rewiring
- **Pattern:** Scaling — cache the hot path, spread the rest

### Wave 3: "Going Mainstream" — Edge infrastructure
- **Traffic:** + static_asset + auth_required
- **Delta:** CDN + API Gateway at the front of the pipeline
- **Pattern:** Edge offload — specialized handlers for specialized traffic

### Wave 4: "Async Operations" — Decouple batch from sync
- **Traffic:** + batch (20%), higher intensity
- **Delta:** Worker + Queue + pipeline restructuring
- **Pattern:** Async processing — dedicated path for background work

### Wave 5: "Things Break" — Design for failure
- **Traffic:** Same composition, multi-chaos events (cascading failures)
- **Delta:** Circuit Breaker + extra Servers + resilience rewiring
- **Pattern:** Resilience — isolate failure, absorb loss with redundancy

### Wave 6: "Video Launch" — Traffic isolation
- **Traffic:** + stream (30%), high intensity
- **Delta:** Streaming Server + Blob Storage + extra Servers + bandwidth tuning
- **Pattern:** Traffic isolation — different profiles need isolated infrastructure

### Wave 7: "Going Global" — Multi-region architecture
- **Traffic:** 3 zones, 800/tick, zone latency penalties
- **Delta:** DNS/GTM + replicate entire stack 3× (biggest build phase)
- **Pattern:** Global distribution — replicate close to users

### Wave 8: "The Viral Moment" — Elastic architecture (boss)
- **Traffic:** 3000/tick, multi-chaos, all types
- **Delta:** Enable AutoScale on existing Servers + Databases
- **Pattern:** Elasticity — compute and storage must both grow on demand

## Component delta summary

| Wave | New components          | Total placed | Build feel                      |
|------|-------------------------|--------------|---------------------------------|
| 1    | Client, Server, DB      | 3            | "Build from scratch"            |
| 2    | Cache, LB, Server       | 6            | "Scale up your stack"           |
| 3    | CDN, Gateway            | 8            | "Add edge layer"                |
| 4    | Worker, Queue           | 10           | "Add async pipeline"            |
| 5    | CB + extra Servers      | 13           | "Fortify against failure"       |
| 6    | StreamServer, BlobStore | 15           | "Isolate streaming"             |
| 7    | DNS/GTM + 3× zone stacks | 30+         | "Go global" (biggest build)     |
| 8    | Enable AutoScale        | Same         | "Make it elastic" (config)      |

## Mapping from current 10-wave to proposed 8-wave

| Current | Proposed     | Change                                                       |
|---------|--------------|--------------------------------------------------------------|
| W1      | W1 (merged with W2 content) | First wave now includes Database (reads+writes) |
| W2      | Merged into W1 | Combined                                                   |
| W3      | W2 (expanded with LB) | Scaling becomes Cache + LB + Server, not just Cache |
| W4      | W3 (merged with W5) | CDN + Gateway combined into "edge infrastructure"     |
| W5      | Merged into W3 | Combined                                                   |
| W6      | W4            | Async (Worker + Queue)                                      |
| W7      | W5            | Resilience (CB + multi-chaos)                               |
| W8      | W6            | Streaming                                                   |
| W9      | W7            | Multi-region                                                |
| W10     | W8            | Autoscale boss                                              |

## Implementation cost (if approved)

- New wave definitions (8 instead of 10)
- Tune intensities, composition, SLA for each wave to require the pattern
- Update integration tests (win/lose pairs per wave)
- Update loss diagnosis to hint at the pattern, not single components
- Update dashboard palette/briefing for combined-concept waves

## Decision pending

Awaiting partner feedback. If approved, we'd schedule this as a Phase 2 restructure after current tuning work on the 10-wave version lands.

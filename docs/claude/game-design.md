# Game design

## What this is

A tower defense game that teaches system architecture through gameplay. User traffic is the enemy, infrastructure components are the towers, and a live economy (revenue per request, operational costs, budget constraints) makes architecture decisions feel like business decisions.

The game must stand on its own as a strategy game first. The learning is the long-term payoff; the fun is what gets players there. Position as a strategy game, let the architecture depth be the surprise.

**KSP analogy:** KSP doesn't teach aerospace engineering, but after playing it every orbital mechanics concept has an experiential anchor. We do the same for system architecture. A player who finishes this game and later encounters caching, load balancing, or sharding in a tutorial already has the intuition.

## Modes

- **Physics TD (campaign)** — the shipping mode. Game-first. The player places components, connects them, watches a real-time sim run. 8-wave Netflix-themed campaign from Launch Day to Viral Moment, introducing reads/writes, async/batch, chaos, streaming, multi-zone, auto-scale.
- **Diagnose mode** — framework exists (`src/diagnose/`). Player inherits a pre-placed 15–20 component topology with subtle flaws and uses a smaller remediation budget (partial refund on delete) to fix the architecture under one revealing wave. No content levels shipped yet.

Classic TD / sandbox mode from an earlier iteration has been removed.

## Core design principles (one-liners)

- **Fun first** — learning is byproduct; anything that feels pedagogical gets cut.
- **Real terminology from day one** — "cache" not "memory cache." Montessori principle: the real word connects to every tutorial and job posting outside the game.
- **Tradeoffs, not right answers** — multi-axis scoring (cost, performance, reliability). The best architecture is the cheapest one that still performs under worst-case load.
- **Build → Watch → Assess** — no mid-wave intervention. Maps to how real engineering works (deploy, observe, diagnose, iterate). Auto-battler loop.
- **Wrong intuitions on purpose** — caches don't always help, load balancers don't always matter, queues trade latency for throughput. Open-ended levels with valid-tradeoff Pareto frontiers.
- **One source of truth for stress signals** — `component-metrics.ts` encodes stress thresholds (utilization, rolling drops); both the info panel and the sprite stress indicator read from it.

## Design docs (read on demand)

- **`component-architecture.md`** (repo root) — object model, capability pattern, component registry. Mixes current Physics TD design with historical tick-step engine notes; treat the tick-phase sections as historical.
- **`wave-progression-strategy.md`** (repo root) — two scaling axes (intensity + diversity), request types, wave progression, economic pressure curve.
- **`docs/research/stack-attack-concept.md`** — purpose, SPOVs, research insights, market analysis, design theory.

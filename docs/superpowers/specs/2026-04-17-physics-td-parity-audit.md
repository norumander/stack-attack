# Physics-TD vs Pre-Physics iso TD: Parity Audit

> Read-only audit produced 2026-04-17. Identifies gaps for porting work
> from the legacy iso TD (`/?renderer=iso#mode=td`, ~3,200 LOC across
> `src/dashboard/main.ts` + `src/modes/td/**` + `src/dashboard/td/**`)
> into the new physics-driven TD (`/physics-td/physics-td.html`,
> ~1,200 LOC across `src/dashboard/physics-td/**` + `src/sim/**`).

## Executive summary

- **Pre-physics iso TD surface**: 10 waves with chaos schedules, multi-zone
  topologies, stream configs, and SLA gates; full economy with rent at
  READY + insolvency; condition/decay model with degraded/critical
  effects; 12 component types backed by 14 capability classes; full
  Cyberpunk HUD with viability gauge, briefing panel + narrative,
  resources panel with NEXT BILL preview, info panel + dossier modal,
  diagnose-wave loss copy, dev wave-jump selector, NEW badges,
  multi-wave topology persistence with retry rewind.
- **Physics-td surface**: 4 waves (W1, W2, W3, W5 — W4/W6–W10 missing),
  no chaos, no condition, no upkeep/rent, 6 component types backed by 9
  thin sim capabilities (most without options), wave-by-wave teardown
  (no topology persistence, no economy carryover), generic loss modal
  ("SLA failed: …"), no dev wave-jump selector, no info panel, no
  dossier, no NEW badges. Visuals retain the cyberpunk renderer base
  (snake, two-lane edges, packets, flash FX) but no per-component
  utilization, no health ring, no auto-scale fan-out.
- **Effort estimate by area**:
  - **Small (≤ 1 day each)**: dev wave-jump selector, NEW palette
    badges, info panel wire-up, briefing narrative wiring (already
    threaded into the cyberpunk HUD — physics-td just needs to forward
    it consistently), per-wave SLA gate copy in loss modal.
  - **Medium (2–4 days each)**: missing waves (W4, W6, W7, W8, W9, W10
    each need a new physics WaveDef + sim capability extensions), full
    component palette backfill (CDN/Gateway already there but Queue,
    Worker, CircuitBreaker, StreamingServer, BlobStorage, DNS/GTM
    missing), diagnose-wave port to physics metrics, retry rewind to
    end-of-prior-wave snapshot.
  - **Large (1+ week)**: condition/decay model, chaos events, upkeep +
    rent + insolvency economy, auto-scale capability + fan-out
    visualization, multi-zone (zone topology + zone-aware traffic)
    overhaul.

---

## A. Game mechanics

| Feature | Pre-physics | Physics-td | Gap |
|---|---|---|---|
| Per-wave UPKEEP cost | Rent debited at build→simulate (`TDModeController.payRent`, `td-economy.ts:69-72`) | None | **MISSING** |
| Component condition / health / decay | `ConditionProfile` per registry entry (`td-component-entries.ts:5-30`); decay/recovery + degraded/critical effects | None | **MISSING** |
| Chaos events | 4 kinds (component_failure, zone_outage, connection_sever, latency_injection) wired via `chaosSchedule` (`td-waves.ts:43-54`) and `getScheduledChaos` (`td-mode-controller.ts:657-706`) | None | **MISSING** |
| Component upgrade (tier up) | Partial — `tryUpgrade` stubbed/throws (`td-mode-controller.ts:637-649`); `upgradeCostCurve` declared in entries but no UI | None | **MISSING** (no UI in either) |
| Component instance scaling (auto-scale) | `AutoScaleCapability` registered (`register-td-defaults.ts:198-201`); declared on Server/DB entries; required to win Wave 10 (`tests/integration/td/wave-10-*-autoscale-*.test.ts`) | None — `Sim.components` is a flat map; no scaling logic | **MISSING** |
| Multi-wave topology persistence | YES — controller carries `placedComponents` across waves; topology survives until insolvency or Reset | NO — `clearWaveWorld()` wipes everything between waves (`physics-td.ts:581-610`) | **MISSING** (regression vs pre-physics) |
| Inter-wave economy carryover | YES — budget accumulates across waves (revenue earned on W1 funds W2 placements). `cumulativeStartingBudget` (`main.ts:1235`) sums prior-wave starting bills. | NO — each wave resets budget to its `startBudget` (`campaign-controller.ts:141`) | **MISSING** (regression) |
| Per-wave starting budget / refill semantics | Per wave starting budget OR cumulative carryover (Stage 5b changed to single starting budget on W1, carryover thereafter) | Per-wave hard reset to `startBudget` on every `nextWave()` | **PARTIAL** — same field, different semantics; pre-physics is more forgiving |
| READY-time topology validation | YES — `validateTopology` (`validate-topology.ts`) traces every request type from entry to terminal handler; reports dead ends | NO — only checks "client has any forward egress" (`physics-td.ts:313-319`) | **MISSING** (large regression — no early feedback on dead-end topologies) |
| Insolvency / bankruptcy | `EconomyStrategy.resolveInsolvency` is a no-op in current TD (`td-economy.ts:74-78`), but the SLA gate's `minBudget` enforces solvency at wave end | None; budget can go negative silently | **MISSING** |

**Per-row notes:**

- *Upkeep:* Pre-physics charges a one-shot rent at READY, not per-tick.
  Replicating this needs (a) `rentPerWave` per component type, (b) a
  PRE-SIMULATE debit hook in the physics campaign controller, (c)
  HUD's `updateNextBill(bill)` plumbing (currently unused in physics-td).
- *Condition:* The `ConditionProfile` schema lives in `@core/types/condition.ts`
  with effect kinds `latency_multiplier` and `drop_probability`. The
  physics sim has no notion of per-component health.
- *Chaos:* The pre-physics 10-wave campaign relies on chaos for W7's
  "Outage" + W10's "Viral Moment"; without chaos those waves cannot
  teach Circuit Breaker rescue. Stub-port physics chaos as connection
  speed → 0 (sever) and capability `onArriveRequest` → drop (failure).
- *Topology persistence:* This is the single biggest design regression.
  In pre-physics the player feels their build history — they're laying
  down a system, not redoing the puzzle. Physics-td erases the board
  every wave, breaking the campaign-as-system narrative.

---

## B. Wave catalog

Pre-physics catalog: `src/modes/td/td-waves.ts`. Physics-td catalog:
`src/dashboard/physics-td/waves.ts:61-130`.

| # | Pre-physics ships | Physics-td ships | Pre-physics intent (intensity / duration / SLA / rescue) |
|---|---|---|---|
| W1 — Launch Day | YES (`td-waves.ts:69`) | YES (`waves.ts:62`) | 10/tick api_read, 30 ticks, avail 0.90 / lat ≤ 10. Lone Server suffices. |
| W2 — Users Sign Up | YES (`td-waves.ts:86`) | YES (`waves.ts:79`) | 25/tick (70% read / 30% write), 30 ticks, avail 0.92 / lat ≤ 8. Server + DB. |
| W3 — Traffic Spikes | YES (`td-waves.ts:103`) | YES (`waves.ts:96`) | 50/tick zipfian reads, 30 ticks, avail 0.95 / lat ≤ 5. Data Cache rescue. |
| W4 — Marketing Adds Images | YES (`td-waves.ts:120`) | **NO** | 80/tick with 40% static_asset, avail 0.92 / lat ≤ 6, intro CDN. Rescue topology: Client → CDN → Server → Data Cache → DB. |
| W5 — Auth Wall | YES (`td-waves.ts:150`) | YES (`waves.ts:113`) | 150/tick with 20% auth_required, avail 0.92 / lat ≤ 7, intro API Gateway. Pre-physics also adds 30% static_asset and uses CDN; physics-td version reduces to 60/tick reads + auth only. |
| W6 — Async Workloads | YES (`td-waves.ts:189`) | **NO** | 250/tick with 20% batch, intro Queue + Worker pair. SLA avail 0.93 / lat ≤ 7. |
| W7 — The Outage | YES (`td-waves.ts:227`) | **NO** | 350/tick, mid-wave chaos kills 3 servers in succession; intro Circuit Breaker. SLA avail 0.92 / lat ≤ 8 / minBudget −200. |
| W8 — Video Launch | YES (`td-waves.ts:285`) | **NO** | 500/tick with 30% stream, 40 ticks, intro Streaming Server + Blob Storage. `streamConfig: {duration: 20, bandwidth: 3}`. |
| W9 — Going Global | YES (`td-waves.ts:329`) | **NO** | 800/tick, multi-zone topology (`na-east`/`eu-west`/`ap-south` with cross-zone latency), intro DNS/GTM. SLA avail 0.90 / lat ≤ 5. |
| W10 — The Viral Moment | YES (`td-waves.ts:393`) | **NO** | 3000/tick, multi-zone + chaos (server kills + zone_outage), requires AutoScale to win (`tests/integration/td/wave-10-full-autoscale-wins.test.ts`). SLA avail 0.92 / lat ≤ 4 / minBudget −500. |

**Gap summary**: 6 of 10 waves missing. Each missing wave requires new
`WaveDef` (different `composition` schema than pre-physics) plus the
underlying sim capability for its hero rescue. Physics-td's W5 is also
weaker than pre-physics's W5 — drops static_asset entirely and reduces
intensity by 60%.

---

## C. Component palette

Pre-physics catalog: `src/modes/td/td-component-entries.ts` (13 entries
incl. CLIENT). Cyberpunk HUD palette: `src/dashboard/cyberpunk-hud.ts:28-35`.
Physics-td catalog: `src/dashboard/physics-td/component-factory.ts:28-30`.

| Type | Pre-physics | Physics-td | Notes / missing capabilities |
|---|---|---|---|
| client | YES | YES (renderer-only) | Both. |
| server | YES (`td-component-entries.ts:31`) | YES (forwarding only) | Pre-physics has Processing + Forwarding + Monitoring + AutoScale, 4 caps; physics-td server is Forwarding-only — cannot self-process reads (intentional under Data Cache redesign). Missing: Monitoring, AutoScale. |
| database | YES (`td-component-entries.ts:63`) | YES (Processing) | Pre-physics: Storage + Monitoring + AutoScale; physics-td: Processing only (no Storage cap, no AutoScale, no Monitoring). |
| data_cache | YES (`td-component-entries.ts:93`) | YES (Caching) | Pre-physics: Caching-api + Forwarding-pipe + Monitoring; physics-td: Caching only. Capacity hardcoded 32 in factory. |
| load_balancer | YES (`td-component-entries.ts:125`) | YES (LoadBalancer) | Pre-physics: Routing + Forwarding-pipe + Monitoring with condition-weighted target selection; physics-td: round-robin only. |
| cdn | YES (`td-component-entries.ts:182`) | YES (Caching) | Pre-physics dedicated `caching-static` cap that only handles static_asset; physics-td CDN uses general Caching with capacity 24 (handles all reads). Sim cap missing the `cacheableTypes` filter. |
| api_gateway | YES (`td-component-entries.ts:215`) | YES (Gateway) | Pre-physics: Auth + Forwarding-pipe + Monitoring with 1-tick auth latency vs 5 on Server; physics-td: Gateway terminates auth, no latency model. |
| queue | YES (`td-component-entries.ts:247`) | **NO** | Sim has `QueueCapability` (`sim/capabilities/queue.ts`) but it's not wired into `component-factory.ts`. Pre-physics Queue holds batch packets in a 32-slot FIFO. |
| worker | YES (`td-component-entries.ts:277`) | **NO** | Sim has `WorkerCapability` (`sim/capabilities/worker.ts`) — pulls from connected Queue at `pullRate`. Not wired into factory. |
| circuit_breaker | YES (`td-component-entries.ts:308`) | **NO** | No sim equivalent. Pre-physics has CLOSED/OPEN/HALF_OPEN states with 5-failure threshold and 10-tick cooldown. |
| streaming_media_server | YES (`td-component-entries.ts:340`) | **NO** | Sim has `StreamingCapability` (`sim/capabilities/streaming.ts`) but not wired into factory. |
| blob_storage | YES (`td-component-entries.ts:369`) | **NO** | No sim equivalent (no `BlobStorageCapability` in `src/sim/capabilities`). |
| dns_gtm | YES (`td-component-entries.ts:395`) | **NO** | Sim has `GeoRoutingCapability` (`sim/capabilities/geo-routing.ts`) but not wired into factory. Requires per-packet `originZone` and per-component `zone` plumbing — physics-td traffic source has no zone awareness. |

**Palette gaps in physics-td factory**: queue, worker, circuit_breaker,
streaming_media_server, blob_storage, dns_gtm. Three of these
(queue/worker/streaming/geo-routing) have sim-side capabilities ready to
wire; circuit_breaker and blob_storage need both sim cap + factory
entry.

---

## D. UI elements

Pre-physics HUD: `src/dashboard/cyberpunk-hud.ts` + `cyberpunk-hud.css`,
~612 lines. Pre-physics TD-specific UI: `src/dashboard/td/*.ts`,
~635 lines. Physics-td reuses the cyberpunk-hud chrome via mirror divs
(`physics-td.html:22-64`) but doesn't wire all of it.

| # | Element | Pre-physics | Physics-td | Status |
|---|---|---|---|---|
| 1 | Wave pill (current/total + progress bar) | YES (`cyberpunk-hud.ts:96-150`) | YES (mirrored via `td-status` "tick X/Y") | DONE |
| 2 | Resources panel (budget + NEXT BILL) | YES (`cyberpunk-hud.ts:155-183`) | PARTIAL — budget mirrored; **next bill never set** because no upkeep/rent | PARTIAL |
| 3 | Viability gauge | YES (`cyberpunk-hud.ts:187-206`) | NOT WIRED — `updateViability` exists but physics-td never calls it (no viability concept) | MISSING |
| 4 | Briefing panel (title + narrative + load + traffic + obj + reward) | YES (`cyberpunk-hud.ts:210-234`, full `BriefingDisplay`) | YES — physics-td calls `hudCtrl.updateBriefing(computeBriefingForCampaignWave(wave))` (`physics-td.ts:141, 616`) with full structured display incl. narrative | DONE |
| 5 | Palette strip with cost labels + NEW badges | YES (cost labels yes; NEW badges via `getPaletteButtons` + dossier "seen" tracking) | PARTIAL — cost labels mirrored from `physics-td.html:58-63`; **no NEW badge integration** | PARTIAL |
| 6 | READY button with disabled states | YES (`cyberpunk-hud.ts:375-388`) | YES (mirror to `td-ready-btn`) | DONE |
| 7 | Loss modal with diagnose-wave text | YES — calls `diagnoseWave` from `src/dashboard/td/diagnose-wave.ts` to produce headline + symptom + hint | PARTIAL — generic `"SLA failed: <reasons>"` from `evaluateSLA` (`physics-td.ts:425-426`); no diagnose-wave logic | PARTIAL |
| 8 | Win/wave-clear celebration | YES — modal with stats + INCOMING preview | YES — custom `showWinModal` with stats + INCOMING preview (`physics-td.ts:436-524`); arguably the best-implemented part of physics-td | DONE |
| 9 | Campaign-complete modal | YES | YES (`showCampaignCompleteModal`, `physics-td.ts:526-554`) | DONE |
| 10 | Component info panel (caps + live stats) | YES (`src/dashboard/td/component-info-panel.ts` — header, description, capability bullets, live stats from `metricsHistory`) | NOT WIRED — DOM elements exist in `physics-td.html:43-50` but no click handler or data plumbing | MISSING |
| 11 | Component dossier modal | YES (`src/dashboard/td/component-dossier.ts` — full descriptions + wire/handle hints + localStorage "seen" tracking) | MISSING entirely | MISSING |
| 12 | Toast notifications | YES (`cyberpunk-hud.ts:392-396, 503-511`); physics-td invokes via `hudCtrl.showToast` | DONE | DONE |
| 13 | Chaos events panel (sandbox-only originally) | Sandbox UI in `main.ts:86-90, 158-169` | Not applicable — physics-td has no chaos | N/A |
| 14 | Per-component health ring / condition indicator | Sandbox renders condition ring in `main.ts:277-281`; iso renderer queries condition for tinting | NONE — no condition concept; renderer base supports `flashOverload` etc. but physics-td doesn't drive it | MISSING |
| 15 | Connection load indicator | Renderer shows edge utilization color ramp; pre-physics computes per-edge load | PARTIAL — connection-layer renders edges, packets visibly travel them, but no static "% utilization" overlay | PARTIAL |
| 16 | Wave dev-jump selector ("Start at any wave") | YES — `td-dev-wave-select` populated from `TD_WAVES` (`main.ts:1491` etc.); reads URL hash for `wave=N` and seeds controller's `startingWaveIndex` (`main.ts:1233-1250`) | MISSING — the `<select id="td-dev-wave-select">` exists in DOM (`physics-td.html:53`) but is never populated or wired | MISSING |
| 17 | Tier upgrade UI per component | NEVER SHIPPED in either (stubbed in `td-mode-controller.ts:637-649`) | NEVER SHIPPED | OUT OF SCOPE |
| 18 | Per-zone visualization (Wave 9+ multi-zone) | Pre-physics renderer has zone tinting; W9/10 visible | MISSING (no multi-zone) | MISSING |
| 19 | Stream bandwidth indicator (Wave 8) | Sandbox renders bandwidth reservation on edges | MISSING | MISSING |

**Screenshots-impossible-to-take note**: visual element verification
(health ring color, NEW badge animation, drop flash hue, snake length)
requires running the dashboard. This audit infers from source.

---

## E. Visual / animation

Pre-physics renderer: `src/dashboard/render/cyberpunk-topology-renderer.ts`
+ 11 sub-modules (`cyberpunk/*.ts`). Both modes use the same renderer.

| Effect | Pre-physics | Physics-td | Status |
|---|---|---|---|
| Snake of upcoming packets behind client | YES (`cyberpunk/snake-layer.ts`) — sim-side `snake.ts` populates, renderer draws | YES (same renderer + same sim snake module) | DONE |
| Two-lane edges (request/response) | YES (`cyberpunk/connection-layer.ts:210` lines, twin-pair edges with parallel offset) | YES (controller mints `forwardId` + `backId` and renderer draws both — `physics-td.ts:110-111`) | DONE |
| Cache slot chips | Renderer shows cache slot occupancy chips above CachingCapability components | NOT WIRED in physics-td (no per-component capability snapshot pulled to renderer) | MISSING |
| Component utilization bar | YES — per-tick refresh from metrics | NOT WIRED (no metrics surface for utilization) | MISSING |
| Capacity / throughput indicator | YES — sandbox shows capacity ring | NOT WIRED | MISSING |
| Drop flash | `flashFx.flashDrop(id)` available; pre-physics calls on `drop` events | NOT CALLED in physics-td (`drop` events handled but not visualized) | MISSING |
| Revenue flash | `flashFx.flashResponded(id)` available | NOT CALLED in physics-td | MISSING |
| Component "killed by chaos" animation | Pre-physics tints + flashes | N/A (no chaos) | OUT OF SCOPE without chaos |
| Auto-scale instance fan-out | Renderer draws instance count badge | N/A (no auto-scale) | OUT OF SCOPE without AutoScale |
| Wave-end victory animation | None (modal-only celebration) | None (modal-only) | DONE (parity) |

**Renderer is mostly capable** — `flashOverload`, `flashDrop`,
`flashResponded`, `setSelected`, snake, two-lane edges all already
implemented in `cyberpunk-topology-renderer.ts`. The gap is that
physics-td's adapter (`SimToRendererAdapter` in `sim-demo/`) and
`physics-td.ts` frame loop don't dispatch flash calls when sim events
fire.

---

## F. Capability features (sim-side)

Pre-physics catalog: `src/capabilities/**` (24 directories — full set
including Auth, AutoScale, BlobStorage, CircuitBreaker, Compression,
Filter, GeoRouting, HealthCheck, Monitoring, Processing, Query, Queue,
RateLimit, Registration, Replication, Retry, Routing, Search, Sharding,
SSLTermination, Storage, Streaming + sub-types). Physics catalog:
`src/sim/capabilities/**` (9 files).

| Capability | Pre-physics | Physics-td | Notes |
|---|---|---|---|
| processing | YES (`@capabilities/processing`) | YES (`sim/capabilities/processing.ts`) — read/write/respond | DONE; thinner — no `typeLatencyPenalty`, no `handledTypes` filter |
| forwarding | YES + variants (`forwarding-pipe`) | YES (single thin variant) | PARTIAL — no `handledTypes` filter, no `throughputPerTier` budget |
| forwarding-pipe (high-throughput) | YES (200/tick variant) | NO — only one Forwarding | MISSING |
| caching | YES + `caching-api` + `caching-static` | YES (single cap, no type filter) | PARTIAL |
| caching-static | Specialized for static_asset only | NO | MISSING |
| caching-api | Specialized for api_read only | NO | MISSING |
| storage | YES (`StorageCapability`) | NO — physics DB uses `ProcessingCapability` instead | MISSING (functionally substituted) |
| routing (load balancer) | YES (condition-weighted) | YES (`load-balancer.ts`, round-robin/split) | PARTIAL — no condition-weighting |
| auth (gateway) | YES (`AuthCapability` with terminate option) | YES (`gateway.ts`) | PARTIAL — no `intercept` phase, no latency penalty |
| queue | YES (FIFO, holdTypes filter, EngineBufferable) | YES (`queue.ts`) but **not wired into factory** | PARTIAL |
| worker (batch-processing) | YES (`BatchProcessingCapability`, EnginePullable) | YES (`worker.ts` with `refillPull`/`tryPullOne`) but **not wired** | PARTIAL |
| streaming | YES (sustained sessions, bandwidth reservation) | YES (`streaming.ts`, bandwidth reservation) but **not wired** | PARTIAL |
| geo-routing | YES (`GeoRoutingCapability`, EngineConsultable) | YES (`geo-routing.ts`) but **not wired** | PARTIAL |
| circuit-breaker | YES (CLOSED/OPEN/HALF_OPEN, EngineConsultable) | **NO** | MISSING |
| auto-scale | YES (`AutoScaleCapability`) | **NO** | MISSING |
| monitoring | YES (`MonitoringCapability`) | **NO** | MISSING |
| health-check | YES (`HealthCheckCapability`) | NO | MISSING |
| rate-limit | YES (`RateLimitCapability`) | NO | MISSING |
| compression | YES (`CompressionCapability`) | NO | MISSING |
| ssl-termination | YES (`SSLTerminationCapability`) | NO | MISSING |
| filter | YES (`FilterCapability`) | NO | MISSING |
| blob-storage | YES (`BlobStorageCapability`) | NO | MISSING |
| query/search/sharding/replication/retry/registration | YES (sandbox-only, not in TD waves) | NO | OUT OF SCOPE for wave-10 parity |

**Critical wiring gap**: 4 capabilities (queue, worker, streaming,
geo-routing) are implemented in `src/sim/capabilities/` but not exposed
by `component-factory.ts`. Wiring these unblocks W6 (queue/worker), W8
(streaming), and W9 (geo-routing). Circuit-breaker, auto-scale, and
blob-storage need both sim cap implementation and factory wiring.

---

## G. Documentation

| Doc | Current state | Required action |
|---|---|---|
| `docs/claude/simulation-tick.md` | Documents the legacy 10-step engine tick (Stage 2a/2b/2c) | **Add** physics-tick reference: `Sim.step(dt)` (`sim/sim.ts:69`) — release reservations, refill buckets, populate snakes, launch packets, pull from workers, advance packets, collect arrivals, dispatch. Mark legacy tick as "classic mode only." |
| `docs/claude/td-stage-gotchas.md` | Stage 3a–3c gotchas referencing `TDModeController`/registry/Pixi renderer | **Add** physics-td section: `PhysicsCampaignController` semantics (`campaign-controller.ts`), `clearWaveWorld` regression (no carryover), client-must-have-egress check, drain-deadline math. |
| `docs/claude/implementation-status.md` | Says "Wave 10 shipped, 825 tests, typecheck clean" — refers to legacy stack | **Add** physics-td status row: 4 waves shipped, sim engine in `src/sim/`, parity gap docs at this audit's path. |
| `docs/claude/test-harness.md` | `tests/harness/` fixtures for legacy engine | **Add** physics test harness reference: `src/sim/test-harness.ts` |
| `CLAUDE.md` context hub | Current "Quickstart" lists `/`, `/#mode=td`, `/?renderer=iso#mode=td` URLs | **Add** `/physics-td/physics-td.html?renderer=iso` URL row. |

---

## Recommended priority order

The campaign should feel like a campaign first; everything else is
polish on top of that.

1. **Wire the 4 already-implemented sim capabilities into `component-factory.ts`**
   (queue, worker, streaming, geo-routing). Cheapest user-visible win
   — unblocks 3 missing waves (W6, W8, W9) at the topology level.
   Half a day.
2. **Port W4 (CDN + static_asset)** — small wave, exercises the Caching
   capability with type filter; biggest "feels like a real campaign"
   lift since it sits between the W3 you already ship and the W5 you
   ship inconsistently. ½ day once `caching-static` filter ships.
3. **Multi-wave topology persistence + economy carryover** — remove
   `clearWaveWorld()` from the wave-clear flow; let placed components
   survive into the next build phase. Add cumulative-budget semantics
   (W1 starting budget; later waves only refund/grant revenue, not
   reset). 1 day.
4. **Wave dev-jump selector** — populate `td-dev-wave-select` from
   `CAMPAIGN_WAVES`, parse `?wave=N` from URL on boot, seed
   `controller.currentWaveIndex`. Half a day. **Critical** for testing
   later waves without re-clearing W1–W3 every session.
5. **Diagnose-wave port** — adapt `diagnose-wave.ts` to read physics
   metrics (`Sim.lastStepEvents`, drop reasons). 1 day. Without this
   the loss modal is mostly useless.
6. **Component info panel + dossier wire-up** — DOM mirrors already
   exist. Just need a click-handler + data-binding pass. 1 day for
   info panel, +1 day for dossier modal.
7. **Port W6 (Queue/Worker), W8 (Streaming + BlobStorage), W9 (Multi-zone + DNS)** —
   each is a wave-def + topology-validation pass. 2 days each.
8. **Condition + chaos system** — needed for W7 + W10. Largest sim
   surgery: per-component health, decay/recovery profile, chaos kinds
   (component_failure, zone_outage, connection_sever,
   latency_injection), `chaosSchedule` execution in `Sim.step`. 1 week.
9. **CircuitBreakerCapability + W7 port** — sim cap (~150 lines) +
   factory entry + wave def. Depends on chaos for the teaching moment
   to land. 2 days after chaos ships.
10. **AutoScaleCapability + W10 port** — sim cap + factory entry +
    multi-instance rendering. 3 days. Depends on chaos and multi-zone.
11. **Upkeep / NEXT BILL HUD** — already plumbed in cyberpunk-hud
    (`updateNextBill`); needs `rentPerWave` per type + READY-time
    debit. 1 day.
12. **Visual polish**: drop/revenue flash on sim events, condition
    rings, NEW badges on palette. 2 days total.

---

## Out of scope / nice-to-have

- **Tier upgrades** — never shipped in pre-physics either. The schema
  exists (`upgradeCostCurve`) but no UI; `tryUpgrade` throws. Skip
  unless a wave needs it.
- **Sandbox-only capabilities** (Query, Search, Sharding, Replication,
  Retry, Registration, Compression, SSLTermination, Filter,
  HealthCheck, RateLimit) — pre-physics has them, but no TD wave uses
  them. Not part of campaign parity.
- **Sandbox chaos panel** — separate from TD chaos; the existing
  pre-physics chaos UI is a sandbox affordance, not a campaign feature.
- **Per-zone visual tinting** — only matters once W9/W10 are playable;
  defer until multi-zone ships.

---

## Code paths (for the next agent)

- Pre-physics campaign loop: `src/modes/td/td-mode-controller.ts:389-428`
- Pre-physics economy: `src/modes/td/td-economy.ts:69-72` (rent),
  `src/modes/td/td-mode-controller.ts:189-197` (`payRent`)
- Pre-physics chaos: `src/modes/td/td-mode-controller.ts:657-706`
- Pre-physics topology validation: `src/modes/td/validate-topology.ts:145`
- Pre-physics diagnostic: `src/dashboard/td/diagnose-wave.ts`
- Pre-physics dossier store: `src/dashboard/td/component-dossier.ts`
- Pre-physics dev-jump selector: `src/dashboard/main.ts:1233-1250, 1491`
- Physics campaign controller: `src/dashboard/physics-td/campaign-controller.ts`
- Physics frame loop: `src/dashboard/physics-td/physics-td.ts:362-432`
- Physics wave-clear (regression): `src/dashboard/physics-td/physics-td.ts:581-610`
- Physics component factory (gap source): `src/dashboard/physics-td/component-factory.ts:32-65`
- Physics waves (gap source): `src/dashboard/physics-td/waves.ts:61-130`

# Waves 4–10 Roadmap

**Purpose.** Seed a future brainstorming session for the next TD wave without re-reading the 377-line `wave-progression-strategy.md`. Each entry below is a delta — what's missing from the current codebase to ship that wave — not a full spec. When a session starts, open the next wave's entry, skim the shared-infra section, and invoke the brainstorming skill to turn the entry into a real spec.

**Narrative source of truth.** `wave-progression-strategy.md` (currently at repo root) is authoritative for traffic composition, intensity, and teaching arc. This doc only tracks *implementation gap*.

## Progress at a glance

Legend: ⬜ Planned · 🟡 In Progress · ✅ Shipped

| Wave | Name | Stage | Status | Shipped |
|---|---|---|---|---|
| 4 | Marketing Adds Images | 3d (paired w/ 5) | ✅ Shipped | 2026-04-14 |
| 5 | The Authentication Wall | 3d (paired w/ 4) | ✅ Shipped | 2026-04-14 |
| 6 | Async Workloads | 3e | ✅ Shipped | 2026-04-14 (augmented) |
| 7 | The Outage      | 3e | ✅ Shipped | 2026-04-14 (augmented) |
| 8 | Video Launch | 4a | ⬜ Planned | — |
| 9 | Going Global | 4b | ⬜ Planned | — |
| 10 | The Viral Moment | 4c | ⬜ Planned | — |

When a wave ships, update its row: status → ✅ Shipped, Shipped → the merge date. When a wave is actively in flight, status → 🟡 In Progress and add a link to the branch/PR in the Shipped column. One cell per wave, updated in the same PR that ships it.

**Wave cycle (unchanged).** Per-wave: worktree → brainstorm → spec → plan → implement → test → iterate → update `docs/claude/implementation-status.md` (plus a new entry in `docs/claude/td-stage-gotchas.md` if anything bit us) → **update the status table above** → finish worktree → merge → push. Then open this doc again for the next wave.

---

## Shared infrastructure (already in place)

Before brainstorming any wave, assume these are **type-level complete**. Each per-wave entry only flags what's *not* verified end-to-end.

- **Request shape is already forward-compatible.** `Request.originZone`, `streamDuration`, `streamBandwidth` are typed (`string | null` / `number | null`) in `src/core/types/request.ts` and set to `null` by `TDTrafficSource` today. Adding zones/streams to a wave does not require a Request migration.
- **Chaos event taxonomy is fully typed.** `src/core/types/chaos.ts` defines `ChaosEvent` with four variants: `component_failure`, `zone_outage`, `connection_sever`, `latency_injection`. `TDModeController.getScheduledChaos(currentTick)` is a live hook on the mode-controller interface (currently returns `[]`). Whatever the engine does with the returned array is already wired — we just never populate it from a wave config.
- **Zone topology is typed.** `src/core/types/zone.ts` exports `ZoneTopology`, `zonePairKey`, `getZonePairLatency`. `TDModeController.getInitialZoneTopology()` is a live hook (currently `{ zones: ["default"], pairLatency: new Map() }`). Wave 9 populates it; every earlier wave can ignore it.
- **Stream state is typed and tracked.** `state.activeStreams` is already read by `TDModeController.isWaveDrained`. `RequestEventType` includes `STREAM_STARTED` and `STREAM_COMPLETED`. Something is wired — Wave 8's first brainstorming question is "what's the depth of that wiring?"
- **Traffic composition is multi-type already.** `TDWaveDefinition.composition: ReadonlyMap<string, number>` and `TDTrafficSource` uses stratified one-type-per-tick scheduling with a deterministic shuffled schedule (`buildTypeSchedule`). Adding a new request type to a wave is just a composition-map entry — no engine change.
- **Per-type revenue is already in the wave table.** `TDWaveDefinition.revenuePerRequestType`.
- **SLA gates (availability + latency + budget) with mid-wave penalties work.** `evaluateSLA`, `evaluateOutcome`, and `onTick` are all live in `TDModeController`. Every new wave defines an `sla: { availabilityTarget, maxAvgLatency, minBudget, penaltyPerTick }` — no new controller code per wave.
- **Every component for Waves 4–10 exists in `src/core/registry/component-entries.ts`.** `cdn`, `api_gateway`, `service_registry`, `queue`, `worker`, `circuit_breaker`, `dns_gtm`, `blob_storage`, `streaming_media_server` are all registered with the right capabilities. **They are NOT in `src/modes/td/td-component-entries.ts`** — that file currently only defines Server / Database / Cache / Load Balancer / Client (the Wave 1–3 set). Every wave from 4 onward will expand the TD entry bundle with a TD-tuned variant of the sandbox entry.
- **Every capability for Waves 4–10 has a source file.** `caching`, `filter`, `auth`, `rate-limit`, `queue`, `batch-processing`, `circuit-breaker`, `retry`, `replication`, `geo-routing`, `health-check`, `streaming`, `blob-storage`, `auto-scale` all live under `src/capabilities/`. Some are production-ready (Caching was battle-tested in Wave 3). Others are stub-ish (Auth currently just adds latency to `auth_required`; it does not reject unauthenticated traffic). Per-wave entries flag which is which.

**What's NOT in place** and will surface as a real blocker sooner or later:

- **Dynamic `instanceCount`.** Components currently have fixed scale. Wave 10's AutoScale needs tick-mutable `instanceCount` with upkeep/throughput recomputed. Unknown whether the `auto-scale` capability file already mutates state or is a stub.
- **Multi-tick connection-bandwidth reservation.** `stream` requests need to reserve `streamBandwidth` on a connection for `streamDuration` ticks. `state.activeStreams` exists but end-to-end behavior — does the connection actually refuse new traffic while a stream holds it? — is unverified. Wave 8 first-brainstorm question.
- **Cross-zone latency applied to request completion time.** `zonePairLatency` is a typed helper but I don't know whether the engine consumes it during the tick loop. Wave 9 first-brainstorm question.
- **Mid-wave chaos event execution.** ✅ Verified in Stage 3e. `getScheduledChaos` populates from `wave.chaosSchedule`, `injectChaos` (step 6b) applies `component_failure` condition zeroing. Wave 7 tests confirm chaos fires at wave-relative ticks 15 and 22. **However:** `CircuitBreakerCapability.reportFailure()` is NOT auto-called by the engine — CB state machine requires external invocation.

These are *pre-brainstorm gotchas* — each needs a 15-minute source-dive at the start of the wave's brainstorming session to confirm whether we need an engine task in the plan or just a content task.

---

## Wave 4 — "Marketing Adds Images"

**Narrative.** Landing page redesign. 40% of traffic is now static assets that servers are wasting compute on.

**Traffic.** `api_read` 40% · `api_write` 20% · `static_asset` 40% · intensity 80/tick.

**New request type.** `static_asset` — high bandwidth, low revenue, `cacheable: true`. Cacheable today means nothing special in the engine (`CachingCapability` hashes by type+payload); Wave 4 validates that CDN placement in front of a Server measurably reduces Server load.

**New component.** **CDN**, wired into `td-component-entries.ts`. Tune from the sandbox entry: `filter` + `caching` + `forwarding` + `monitoring`; high placement cost (200–250), very low upkeep, Cache-hit rate target ≥85% for `static_asset`.

**Capability gaps.** None expected. `CachingCapability` shipped in Wave 3. Hit-rate teaching hinges on the cache's working-set sizing — use `readKeyPoolSize`-style mechanism to tune.

**Engine / state changes.** None.

**UI surfaces.**
- Palette gains CDN tile.
- Briefing card gets a `static_asset` icon + one-line description.
- Diagnosis panel: **cache hit rate** (already computed for Wave 3 Cache) needs to split by request type so the player sees "90% hit on static_asset, 40% on api_read" — this is the "aha" moment.

**Risks / open questions.**
- Does the per-type revenue table need a `static_asset: 0.3` entry or does the engine default? (Likely need to add.)
- Is there a "bandwidth consumed per request" concept that CDN short-circuits? Or is the lesson purely about offloading compute? Decide at brainstorm.

**Suggested stage.** Stage 3d. Pairs naturally with Wave 5 (see below).

---

## Wave 5 — "The Authentication Wall"

**Narrative.** User accounts. Every request now needs to validate auth. Servers are burning compute on token checks.

**Traffic.** `api_read` 30% · `api_write` 20% · `static_asset` 30% · `auth_required` 20% · intensity 150/tick.

**New request type.** `auth_required` — requires passing through a component with `AuthCapability` before `ProcessingCapability`. **Rejection semantics need a design decision.**

**New component.** **API Gateway**, wired into `td-component-entries.ts`. Sandbox entry has `auth` + `rate-limit` + `routing` + `forwarding` + `monitoring` — TD variant probably omits routing (over-scoped for Wave 5) and tunes `auth` tier 1 to have near-zero overhead when applied at the edge vs. brute-forcing through a Server.

**Capability gaps.** `AuthCapability` currently *does not reject* unauthenticated traffic — it returns `PASS` for non-`auth_required` types and adds latency to `auth_required` types. Wave 5 needs one of:
- **Option A — Structural check.** An `auth_required` request that reaches `ProcessingCapability` without an upstream `AuthCapability` in its travel log gets dropped in PROCESS. Simple, no new request field.
- **Option B — Request flag.** Add `authenticated: boolean` to Request, default `false`. `AuthCapability` flips it to `true` when its INTERCEPT phase runs. `ProcessingCapability` drops `auth_required` requests with `authenticated === false`.
- **Option C — Brute-force tax only.** Don't reject — just have Server's `ProcessingCapability` charge double processing cost for `auth_required` (simulating "server has to auth AND process"). Economic pressure alone forces API Gateway adoption.

My lean is **C** for Wave 5 — it's consistent with the "brute force tax" teaching philosophy in `wave-progression-strategy.md` and avoids request-schema changes. **A** if we want harder failure. **B** is over-engineered.

**Engine / state changes.** Depends on the option above. C = zero changes. A = ProcessingCapability reads travel log. B = Request migration.

**UI surfaces.**
- Palette gains API Gateway tile.
- Briefing card: `auth_required` icon, one-line "every request now needs to be authenticated."
- Diagnosis panel: per-type processing cost breakdown so "auth_required is costing 2× on your Servers" is visible.

**Risks / open questions.**
- Rejection semantics (Option A/B/C above). **Biggest spec decision for this wave.**
- Service Registry is narratively unlocked in this wave but not strictly required — defer.

**Suggested stage.** Stage 3d bundled with Wave 4. Rationale: both waves are pure content (no engine work) + both add edge components (CDN + API Gateway) + both exercise the "one more request type in the composition map" pattern. Two-wave stage is lower overhead than two single-wave stages.

---

## Wave 6 — "Async Workloads"

**Narrative.** Video thumbnails, email notifications, recommendation updates. Heavy async work that shouldn't block the API path.

**Traffic.** Cumulative + `batch` 15% · `event` 5% · intensity 250/tick.

**New request types.** `batch` (`async: true`, processingCost: 10, `batchSize: 10`) and `event` (`fanout: true`). Both are new mechanics beyond "another composition entry."

**New components.** **Queue** (existing sandbox entry has `queue` + `monitoring`) and **Worker** (existing: `batch-processing` + `monitoring` + `auto-scale`). Wire both into TD bundle.

**Capability gaps.**
- `QueueCapability` — first-brainstorm question: does the Queue actually buffer `batch` requests across ticks, or is it a no-op forwarder? Verify in source.
- `BatchProcessingCapability` — first-brainstorm question: does the Worker actually pull in batches and process N per tick? Verify.
- **REPLICATE-phase fan-out for `event`.** The engine has a REPLICATE phase in its 10-step tick, but no Wave 1–3 component used it. `event` is the first request type that exercises fan-out. Needs a source-dive to confirm the REPLICATE phase actually multi-dispatches a request to all downstream subscribers.

**Engine / state changes.** None expected *if* the three capabilities above are production-ready. If any is stub-level, this wave expands to include capability work.

**UI surfaces.**
- Palette gains Queue + Worker.
- Briefing card: two new request-type icons.
- Diagnosis panel: **queue depth over time** (new chart) and **worker batch throughput** (new metric). Fan-out visualization is TBD — per-request event trees are complex; start with a count.

**Risks / open questions.**
- The three "verify the capability is real" questions above. If any is a stub, wave scope doubles.
- `batch` requests have TTL 50 (vs. ~10 for reads). The wave duration needs to accommodate drain time or waves become unwinnable. Drain-time heuristic is in `docs/claude/development.md`.

**Suggested stage.** Stage 3e. Standalone — don't pair with neighbors. Queue + Worker + fan-out is three substantially different mechanics and the wave will generate its own test harness.

---

## Wave 7 — "The Outage"

**Narrative.** One downstream service goes sick mid-wave. Without a Circuit Breaker, failure cascades.

**Traffic.** Same composition as Wave 6, intensity 350/tick. **Mid-wave chaos event.**

**New request type.** None.

**New component.** **Circuit Breaker**, wired into TD bundle. Sandbox entry has `circuit-breaker` + `forwarding` + `monitoring`. Tune: low placement cost (it's the rescue component), fast trip threshold so the mechanic is visible in ~8 ticks.

**New mechanic — chaos injection.** `TDModeController.getScheduledChaos(currentTick)` currently returns `[]`. Wave 7 adds a `chaosEvents` field to `TDWaveDefinition` (e.g. `{ triggerTick: 15, event: { kind: "component_failure", componentId: <chosen at sim start> } }`) and has the controller return them at the right tick.

**"Chosen at sim start"** is subtle: wave configs are static, but the target component ID isn't known until the player builds the topology. Design decision: does the wave config specify a component *type* (`"database"`) and the controller resolves to the first-placed instance of that type? Or does the wave config specify an abstract target (`"a-random-downstream-of-gateway"`) and resolve topologically?

**Capability gaps.**
- `CircuitBreakerCapability` — verify it actually trips, opens, half-opens, and closes. Verify it emits a DROP (fallback) outcome.
- `RetryCapability` is also in the Server entry with `defaultTier: 0` — should Wave 7 teach retry+circuit-breaker together or only circuit-breaker? Brainstorm question.
- `HealthCheckCapability` on LB is supposed to route *away* from degraded components — per Wave 7's narrative. Verify.

**Engine / state changes.**
- **First-brainstorm source-dive.** Does the engine consume `getScheduledChaos` and actually apply the chaos event? If not, add a tick-loop step "apply pending chaos events" before the capability pipeline. This is the biggest unknown in Waves 4–10.
- `TDWaveDefinition` gains a `chaosEvents` field.

**UI surfaces.**
- Palette gains Circuit Breaker.
- Briefing card: first wave with a "warning: chaos event mid-wave" callout. Don't spoil which component — narrative tension.
- Diagnosis panel: **circuit state** (closed/open/half-open) as a timeline band per circuit-breaker instance. **Health of each component over time** so the player sees the sick one crashing.
- Replay / post-mortem: "at tick 15, component X degraded to critical" event in the diagnosis log.

**Risks / open questions.**
- Chaos event runtime wiring is the biggest unknown in Waves 4–10. Likely 2–4 hours of engine work if it's truly a no-op today.
- Deterministic chaos vs. random chaos: a wave config with a fixed `triggerTick: 15` is repeatable (good for learning); a random trigger is more narratively exciting but breaks replay-from-same-seed. Go deterministic for Wave 7, save random for Wave 10.

**Suggested stage.** Stage 3f. Standalone — engine work is likely.

---

## Wave 8 — "Video Launch"

**Narrative.** Streaming traffic introduces a sustained-flow pattern that breaks "one tick = one request" intuitions.

**Traffic.** Cumulative + `stream` 25%. Intensity 500/tick.

**New request type.** `stream` with `streamDuration: 20`, `streamBandwidth: 3`. **First request type with multi-tick lifetime.**

**New components.** **Streaming Media Server** + **Blob Storage**, wired into TD bundle. Streaming server exists in sandbox with `streaming` + `caching` + `monitoring`. Blob storage exists with `blob-storage` + `replication` + `monitoring`.

**Capability gaps.**
- `StreamingCapability` — verify what it actually does. "Adaptive bitrate" is narrative — in the sim it probably means something like "reduce `streamBandwidth` when connection is congested instead of dropping the stream." Verify source.
- `BlobStorageCapability` — verify vs. plain `StorageCapability`. May behave identically at Wave 8's level of abstraction.

**Engine / state changes.**
- **First-brainstorm source-dive.** `state.activeStreams` exists and is read by `isWaveDrained` — but what writes to it? Is the stream lifecycle (STREAM_STARTED event, per-tick bandwidth draw, STREAM_COMPLETED event) actually implemented? If yes, this wave is mostly content. If no, this wave is mostly engine.
- **Bandwidth reservation on connections.** Today, a connection has `bandwidth` and `currentLoad` fields (seen in `TDModeController.tryConnect`). Does the engine actually check `currentLoad < bandwidth` before admitting a new request? And does a stream reserve `streamBandwidth` for `streamDuration` ticks? Unknown — needs source-dive.

**UI surfaces.**
- Palette gains Streaming Media Server + Blob Storage.
- Briefing card: stream request icon + "sustained flows" one-liner.
- Diagnosis panel: **per-connection bandwidth utilization over time** as a stacked area chart (streams vs. API traffic). This is the "I can see my API being starved" visualization.
- Renderer: active streams need a visual distinction from one-shot requests — maybe a persistent line on the connection instead of a traveling dot. Deferred to brainstorm.

**Risks / open questions.**
- Stream lifecycle wiring is the second biggest unknown after chaos. Could be 1 hour (it's done) or 4+ hours (partial).
- Renderer work is the biggest *content* unknown — sustained visual state is new.
- Wave duration vs. stream duration: a 30-tick wave with `streamDuration: 20` means streams can survive to the end. Duration needs to accommodate worst-case drain.

**Suggested stage.** Stage 4a. Standalone — this is the first wave that might need genuine engine work outside the TD mode directory.

---

## Wave 9 — "Going Global"

**Narrative.** Single-datacenter hits a geographic wall. EU and AP users see unplayable latency.

**Traffic.** Cumulative, intensity 800/tick, requests gain `originZone`: 40% `na-east` / 35% `eu-west` / 25% `ap-south`.

**New request type.** None. This wave is about the zone model.

**New component.** **DNS / GTM**, wired into TD bundle. Sandbox entry has `geo-routing` + `forwarding` + `health-check` + `monitoring`.

**Capability gaps.**
- `GeoRoutingCapability` — verify it actually reads `request.originZone` and routes to a zone-matching downstream.
- `ReplicationCapability` on Database — verify cross-zone write replication actually works and has realistic latency.

**Engine / state changes.**
- **First-brainstorm source-dive.** The engine has zone types (`ZoneTopology`, `zonePairKey`, `getZonePairLatency`). Does the tick loop actually apply `getZonePairLatency(topology, request.originZone, component.zone)` as added latency when a request traverses a cross-zone connection? Unknown — the helper function exists but its consumer may not.
- `TDModeController.getInitialZoneTopology()` currently returns a single-zone default. Wave 9 populates it from wave config.
- Components gain `zoneId` (may already exist — `tryPlace` takes a `zone` parameter but Wave 1–3 pass `null`).
- `TDTrafficSource` must start emitting non-null `originZone` based on wave composition.

**UI surfaces.**
- Topology canvas gains **zone regions** — colored backgrounds grouping components by `zoneId`. Renderer change.
- Palette: DNS/GTM + a **zone selector** when placing a component (first time the player picks a zone).
- Briefing card: zone distribution chart.
- Diagnosis panel: **per-zone availability + latency** table.

**Risks / open questions.**
- Renderer work is substantial — zones visually change the topology.
- Database cross-zone replication latency is where the CAP theorem teaching lives. Needs a clear visualization of "your NA write isn't visible in EU for 80ms."
- Stage 4b is plausibly **two** waves of work (engine wiring + content). Break it up if the engine dive reveals major gaps.

**Suggested stage.** Stage 4b. Standalone. Largest of Waves 4–10 by a meaningful margin.

---

## Wave 10 — "The Viral Moment"

**Narrative.** 10× spike across every zone and every request type simultaneously. Ultimate stress test of everything built so far.

**Traffic.** All types active, weighted toward `stream` (40%) and `api_read` (25%). Intensity 3000+/tick across all zones. Multiple simultaneous chaos events.

**New request type.** None.

**New mechanic — AutoScale.** `AutoScaleCapability` file exists but behavior is unverified. Wave 10 requires it to mutate `instanceCount` during simulation based on load. Upkeep and throughput must scale with `instanceCount` each tick.

**New mechanic — multi-chaos.** Wave config specifies multiple `ChaosEvent`s: a `zone_outage`, a `connection_sever`, and `latency_injection`. `getScheduledChaos` returns them on schedule. Wave 7's chaos wiring must already be solid before Wave 10 exercises it at scale.

**Capability gaps.**
- `AutoScaleCapability` — biggest unknown. Either it already mutates state (cheap wave) or it's a stub (substantial engine work). Source-dive at brainstorm.

**Engine / state changes.**
- Dynamic `instanceCount`. Upkeep recalculation per tick. Throughput recalculation per tick. Almost certainly engine-internal changes beyond the TD directory.
- Possibly new metrics for "peak instances used" so the player sees elasticity in the diagnosis panel.

**UI surfaces.**
- Diagnosis panel: **instance-count-over-time** chart per auto-scaled component. This is the "look at my cluster react" moment.
- Palette: no new tiles (auto-scale is a capability upgrade on existing components).
- Multiple simultaneous chaos indicators in the diagnosis log.

**Risks / open questions.**
- Depends entirely on whether `AutoScaleCapability` is real or stub. If stub, this wave is ~80% engine work.
- Difficulty tuning — this is a boss wave. Needs playtesting iteration more than earlier waves.
- Ends Phase 1. Celebrate with a proper retrospective in `docs/claude/implementation-status.md`.

**Suggested stage.** Stage 4c. Standalone. Phase 1 finale.

---

## Stage grouping cheatsheet

| Stage | Waves | Why grouped / not |
|---|---|---|
| 3d | **4 + 5** | Both pure content, both edge components, shared "multi-type composition" pattern. Lowest-risk pair. |
| 3e | 6 | Three new mechanics (queue, worker, fan-out) — too much for a pair. |
| 3f | 7 | Engine work (chaos wiring) likely. Standalone. |
| 4a | 8 | Engine work (stream lifecycle) possibly. Standalone. Phase 2 opener. |
| 4b | 9 | Engine work (zone latency + renderer) definitely. Standalone. Largest. |
| 4c | 10 | Engine work (autoscale) possibly. Standalone. Finale. |

**If you want finer granularity,** split 3d into two stages — no hard dependency between Wave 4 and Wave 5 once the multi-type composition pattern is in place.

**If you want coarser grouping,** 3d–3f could theoretically be one "content" phase if Waves 4+5+6 all turn out to have zero engine work. But Wave 6's "verify three capabilities are real" risk makes this a bad bet — leave 6 separate.

---

## Cross-wave open questions

These are not wave-specific but need to be decided as future waves ship:

1. **Revenue-per-type table ownership.** Today `TDWaveDefinition.revenuePerRequestType` is per-wave. Do we duplicate `static_asset: 0.3` across every wave from 4 onward, or hoist to a default table and let waves override?
2. **Request-type registry.** Today request types are strings (`"api_read"`, `"api_write"`). Static metadata like `processingCost`, `cacheable`, `async`, `fanout` lives scattered in `wave-progression-strategy.md` narrative but nowhere in code. Wave 4 is the first place this hurts — decide at brainstorm whether to add a `RequestTypeDef` map in `src/core/types/request-types.ts` or keep it implicit via capability behavior.
3. **Palette grouping.** Five entries is fine in a row. Ten+ (Wave 8's state) probably needs categorization. Design decision deferred to the first wave that makes the palette ugly — probably Wave 6.
4. **Briefing card reuse.** Today the briefing card is a static panel. Waves 5–10 each introduce a new request type; the card needs to show "new for this wave" vs. "carried over from earlier waves" so the player isn't re-reading everything. Low-priority polish; defer until it's obviously needed.
5. **Drag-to-rearrange component positions.** Stage 3d added disconnect + delete affordances (commits TBD on the Stage 3d branch) so players can fix mis-wired topologies by removing and re-placing. Drag-to-move is the missing piece: `Component.position` is `readonly Position` today, set once at construction, and any "move" flow needs either (a) making position mutable on the `Component` contract or (b) storing position in a side-channel map on `SimulationState`. Plus Pixi drag interaction in `pixi-topology-renderer.ts`, plus an action-log `move` variant for retry replay. Scope: ~3-4 hours, mostly contract plumbing. Low-priority — delete+re-place covers the functional use case. Schedule for Stage 3e polish or later when topology size makes visual cleanup genuinely painful.

6. **Silent round-robin egress is a routing footgun.** `src/core/engine/egress-selection.ts` round-robins across all outgoing connections from a component when that component has no `EngineConsultable` capability (e.g. `RoutingCapability`). Stage 3d playtest showed this is invisible to players: they connect `Client → Server` AND `Client → Cache` thinking they're creating alternative paths, and the engine silently splits traffic 50/50 — half the reads never reach the cache, Server sees double the intended load, the rescue topology underperforms, and there is no visual or diagnostic signal to explain why. Real systems don't have clients load-balancing themselves — that's a Load Balancer's job. Three design options: **(A)** `tryConnect` rejects multi-egress on components without a routing cap (loud fail, but blocks legitimate fan-out like CDN → Server & CDN → Cache misses); **(B)** build-time warning badge on any component with ≥2 egress and no routing capability (non-blocking, teaches via UI); **(C)** add a `RoutingPolicy` field to `ComponentRegistryEntry` with values `single-path` (fail on 2nd egress), `round-robin` (current LB behavior), `routed` (requires a routing cap) — Client/Server default to single-path, LB to round-robin, explicit contract. Option C is the cleanest long-term but needs a spec pass. Medium scope. **Queue for the same Stage 3e brainstorm as the architecture rubric system** — both are about making topology correctness legible to the player.

7. **Per-dot count label visibility.** Stage 3d ships a version of this as a small renderer tweak (numeric label on aggregated request dots showing the count they represent). If that fix turns out to be insufficient — e.g. labels get cluttered at Wave 8+'s 500/tick intensities — revisit with a more structured visualization (heatmap on connections, thickness scaling, or a dedicated flow-monitor panel).

8. **Architecture rubric / grade system.** Stage 3d playtest surfaced that brute-force topologies (e.g. 4 Servers + 2 Databases on Wave 4) currently pass the SLA gate without any penalty, undermining the "specialized edge component beats brute-force Server" teaching intent. Rather than hard-punish brute-force (progressive pricing, upkeep taxes, `maxPlacements` caps), the better fit for "strategy game first, teaching is the surprise" is a rubric-based grading system: each wave defines a small list of weighted architectural criteria (`edge-cache-placed`, `server-count-leq-2`, `total-cost-leq-500`), `evaluateOutcome` grades the final topology against them, and the loss/win modal shows a letter grade + the first unmet criterion's hint ("For a higher grade, try: …"). Players still pass with ugly solutions; players who care about the grade get targeted, progressive hints on replay. Scope is larger than a tuning knob — new `TDWaveDefinition.architectureRubric` shape, a scoring evaluator, a grade badge UI surface, per-wave rubric authoring. Natural Stage 3e opener, bundled with the Wave 6 brainstorm since both will touch the wave-definition shape. **Don't bolt onto Stage 3d as an afterthought.** See Stage 3d retro for context on why this came up.

---

## How to use this doc (future sessions)

1. Open `docs/claude/implementation-status.md` — confirm the last-shipped wave.
2. Open this doc — scroll to the next wave's entry.
3. Re-read the shared-infra section (short).
4. Do the "first-brainstorm source-dive" for that wave's flagged unknowns. Keep it to 30 minutes max — if the dive is blowing up, that's a signal the wave is bigger than planned and needs decomposition.
5. Invoke the brainstorming skill. Use this entry as the seed, `wave-progression-strategy.md` as the narrative reference.
6. Normal cycle from there: spec → plan → implement → test → claude.md update → finish worktree → merge.
7. Come back and update **this file** with anything the session learned that contradicts what's written here. Roadmaps rot; keep it honest.

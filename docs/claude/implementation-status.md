# Implementation status

**Current stage:** Phase 1, Stage 3c complete. TD mode is playable end-to-end with Pixi v8 topology rendering, per-request dot visualization, pre-wave briefing card, component info panel, and post-wave diagnosis. 645 tests, typecheck clean.

## What ships (merged into `main`)

**Capability library (23 production capabilities)** — `register-all-capabilities.ts` wires the full set for sandbox/dashboard use. PROCESS: `ProcessingCapability`, `ForwardingCapability`, `StorageCapability`, `SearchCapability`, `QueryCapability`, `RegistrationCapability`, `BlobStorageCapability`, `StreamingCapability`, `BatchProcessingCapability`. INTERCEPT: `FilterCapability`, `SSLTerminationCapability`, `CompressionCapability`, `RateLimitCapability`, `AuthCapability`, `CachingCapability`, `QueueCapability`, `CircuitBreakerCapability`, `RetryCapability`. OBSERVE: `MonitoringCapability`, `HealthCheckCapability`, `AutoScaleCapability`. No phase (EngineConsultable only): `RoutingCapability`, `GeoRoutingCapability`.

**Component registry (14 entries)** — `src/core/registry/component-entries.ts` + `register-all.ts` (`bootstrapRegistries()` factory). Client, Server, Database, Cache, Load Balancer, Queue, CDN, API Gateway, Service Registry, Worker, Circuit Breaker, DNS/GTM, Blob Storage, Streaming Media Server. Used by the Vite dashboard and the `stage3-smoke.test.ts` integration test for sandbox play.

**TD mode stack (Wave 1–3 learning arc)** — `src/modes/td/` contains `TDEconomy`, `TDTrafficSource`, `TDModeController`, wave definitions (`WAVE_1` trivial reads, `WAVE_2` mixed R/W, `WAVE_3` traffic spike at TTL 8), `td-component-entries.ts` (Server/Database/Cache/LoadBalancer bundles tuned for the arc), and `registerTDDefaults()`. `tests/integration/td/` has four wave tests: Wave 1 trivial Server, Wave 2 Server+Database with write-routing verified, Wave 3 lone-server **loses**, Wave 3 Cache-rescue and LB-rescue both **win** (learning arc validated end-to-end). After Batch 3, `helpers.ts:buildServer/buildDatabase/buildCache` mint their components via `compRegistry.create(...)`, so these three test helpers and `registerTDDefaults` share a single source of truth. `buildLoadBalancer` remains a one-off (fixed port config with variable egress count); unifying it is deferred to Stage 3c.

**Unified capability options model** — after merge, the five capabilities that both tracks touched are a single class each with optional behavior flags:
- `ProcessingCapability`: default is `canHandle: true` + `RESPOND` + tier*25 throughput + no events (sandbox/dashboard usage). TD mode constructs with `{handledTypes: ["api_read"], throughputPerTier: 20, emitProcessedEvent: true}` for read-only Server with tuned cap and event emission. (Stage-1-legacy `outcomeKind` option was deleted in the post-3b cleanup pass — no production consumers, only its own tests.)
- `ForwardingCapability`: default is unconditional forwarder, unbounded throughput, no events (intermediary use — LB, Gateway, CDN, etc.). TD mode constructs with `{handledTypes, throughputPerTier, emitForwardedEvent}` for tuned instances. `getThroughputPerTick` is defined **only** when `throughputPerTier` is passed.
- `StorageCapability`: default is `tier * 5` throughput + no events (sandbox). TD mode uses `{throughputPerTier: 25, emitProcessedEvent: true}` via `buildDatabase` so Database is not the Wave 3 bottleneck.
- `CachingCapability`: accepted teammate's version as-is (LRU with type-slot hashing, per-type key pools). My Wave 3 cache-rescue test assertions pass trivially with it.
- `MonitoringCapability`: accepted teammate's version (per-tick stats, `resetPerTickState`).

**Sandbox dashboard** — `src/dashboard/` is a Vite app with topology presets, traffic controls, chaos panel, and Chart.js metrics visualization. Wired to the real `bootstrapRegistries()` capability instances. Run via `pnpm dev` (script wired in `package.json`).

**Stage 3b: Interactive playable loop** — `TDModeController` accepts a multi-wave campaign, exposes `getCurrentWaveIndex` / `getCurrentWave` / `isCampaignComplete` / `isWaveDrained` / `getCurrentWaveMetrics` / `getWaveCount` / `setEconomy`, and has real `tryPlace` / `tryConnect` methods that mutate state via the registry path (`ComponentRegistry.tryCreate`, `state.placeComponent`, `state.addConnection`). `TDTrafficSource` is self-counting via `ticksGenerated` (decoupled from `state.currentTick`). `registerTDDefaults` produces TD-tuned capability factories; after Batch 3 the Server/Database/Cache harness helpers build their components through the same registry, eliminating the byte-for-byte duplication. New `forwarding-pipe` capability id (Cache/LB/Client variant at 55/tick). `CLIENT_ENTRY` added to the TD bundle. Dashboard has a TD-mode toggle (URL hash persisted), palette, click-to-place + click-to-connect, READY button, wave HUD, and per-wave economy + condition reset. New tests: `tests/unit/td-mode-controller-{place,connect,phase}.test.ts`, `tests/unit/td-traffic-source-self-counting.test.ts`, `tests/unit/component-registry-try-create.test.ts`, `tests/integration/td/campaign-headless.test.ts`. Stage 3a's four wave tests remain pinned via the back-compat single-wave `TDModeControllerOptions` shape.

## Next: Stage 3c+ candidates (no spec yet)

- **New waves with new mechanics.** Wave 4 (Auth-required edge handler), Wave 5 (RateLimit burst protection), Wave 6 (CircuitBreaker / chaos integration). Auth wave needs a new capability primitive that *rejects* unauthenticated requests — `AuthCapability` is currently a no-op pass-through. RateLimit is the most buildable since `RateLimitCapability` already DROPs on token exhaustion.
- **Cross-wave budget carry-over and condition persistence.** Stage 3b resets economy and condition between waves. Stage 3c can add carry-over once a "repair" / "maintenance" mechanic exists.
- **Tier upgrades.** Spend budget to upgrade an existing component in place. Needs a new UI surface and a `tryUpgrade` real impl beyond the Stage 3a stub.
- **Multi-port disambiguation in `tryConnect`.** Components with multiple in-ports of different roles need explicit port selection in the click flow. Server's `p-in` capacity is 1, which forced Wave 3 cache-rescue topologies to use a second Server in Stage 3b.
- **Helper-vs-registry construction unification.** Stage 3b's tuning made the two paths produce the same runtime, but `tests/integration/td/helpers.ts:buildServer` etc. still construct components directly. Stage 3c could move the helpers to consume the registry.
- **`Engine` visitOrder refresh on placement.** The `Engine` constructor is currently the only place `visitOrder` is computed. Stage 3b's dashboard reconstructs the engine on every `build → simulate` transition to refresh visitOrder. A cleaner long-term fix is to update visitOrder inside `state.placeComponent` (or expose a `state.recomputeVisitOrder()` helper).
- **Intra-wave satisfaction pressure.** Mid-wave loss condition / lives. Now designable because the dashboard shows live wave feedback.

## History

Stage-by-stage detail lives in `docs/superpowers/specs/` and `docs/superpowers/plans/`:

- **`docs/superpowers/specs/2026-04-10-tower-defense-foundation-design.md`** — Stage 1 foundation type contracts.
- **`docs/superpowers/plans/2026-04-10-tower-defense-foundation-stage-1.md`** — Stage 1 implementation plan.
- **`docs/superpowers/specs/2026-04-10-stage-2a-tick-loop-core-design.md`** — Stage 2a engine contracts (1344 lines, authoritative for the implemented tick loop).
- **`docs/superpowers/plans/2026-04-10-stage-2a-tick-loop-core.md`** — Stage 2a implementation plan.
- **`docs/superpowers/specs/2026-04-11-stage-2b-condition-chaos-upkeep-design.md`** — Stage 2b condition/chaos/upkeep contracts.
- **`docs/superpowers/plans/2026-04-11-stage-2b-condition-chaos-upkeep.md`** — Stage 2b implementation plan (16 TDD tasks).
- **`docs/superpowers/specs/2026-04-12-stage-2c-ttl-scale-routing-design.md`** — Stage 2c bufferable TTL, SCALE processing, RoutingCapability contracts.
- **`docs/superpowers/plans/2026-04-12-stage-2c-ttl-scale-routing.md`** — Stage 2c implementation plan (13 TDD tasks).
- **`docs/superpowers/specs/2026-04-12-stage-3a-wave-1-3-playable-slice-design.md`** — Stage 3a playable slice contracts (ProcessingCapability rewrite, ForwardingCapability, Wave 1–3 learning arc). Revised twice post cold audit.
- **`docs/superpowers/plans/2026-04-12-stage-3a-wave-1-3-playable-slice.md`** — Stage 3a 28-task implementation plan across three slices.
- **`docs/superpowers/specs/2026-04-12-stage-3b-td-playable-loop-design.md`** — Stage 3b playable loop contracts (TDModeController multi-wave, real tryPlace/tryConnect, registry tuning, dashboard TD mode). Revised across 4 cold-audit rounds.
- **`docs/superpowers/plans/2026-04-12-stage-3b-td-playable-loop.md`** — Stage 3b implementation plan (16 TDD tasks across slice A controller + slice B dashboard).
- **`docs/superpowers/specs/2026-04-13-stage-3c-playable-polish-design.md`** — Stage 3c playable polish contracts (Pixi renderer, teaching surfaces, SERVER p-in capacity bump, extended registry entry). Revised across 3 cold-audit rounds.
- **`docs/superpowers/plans/2026-04-13-stage-3c-playable-polish.md`** — Stage 3c implementation plan (~20 tasks across 7 slices).

# Cache → Data Cache Redesign Design

## Problem

Cache and CDN are both client-facing reverse-proxy caches in the current TD mode. Cache handles `api_read`, CDN handles `static_asset`. To a player learning system architecture, they feel like the same component in different clothes. The distinction does not teach a meaningful architectural concept.

## Goal

Reposition Cache as a **data-layer cache** (Redis/Memcached pattern) sitting between Server and Database, absorbing repeated DB queries. CDN remains client-facing for static traffic. The two components then teach two genuinely different caching strategies:

- **CDN** — edge cache in front of servers, absorbs static asset requests before they hit the server. Already implemented; unchanged.
- **Data Cache** — query cache behind the server, absorbs repeated data reads before they hit the database.

Rename the component type from `cache` to `data_cache` throughout the codebase. No backwards-compatibility shims; there is no save/load system to honor.

## Non-Goals

- Cache invalidation mechanic (write-around eviction signal flowing back from DB to Data Cache). Captured under "Future Considerations" for a later phase.
- Load Balancer tuning. Wave 3's LB-rescue path may need adjustment (Server now forwards reads, so horizontal Server scaling does not relieve DB pressure on its own), but LB tuning is its own task and is out of scope here. The LB-rescue test will be patched minimally to keep it passing.
- New phases, capability classes, or engine changes. The redesign reuses existing INTERCEPT/PROCESS/FORWARD mechanics unchanged.
- Write-through, write-back, or TTL-based caching variants.

## Architectural Approach

**Topology-only change. No engine or capability-class changes.**

- Server's `ProcessingCapability` drops `api_read` from its `handledTypes`. Reads no longer RESPOND at the Server.
- Server's `ForwardingCapability` ("forwarding", the per-Server tuned variant — not "forwarding-pipe") adds `api_read` to its `handledTypes`. Reads now FORWARD downstream.
- A new `DATA_CACHE_ENTRY` (renamed from `CACHE_ENTRY`) is wired into the topology between Server and Database. It carries the existing `CachingCapability` (INTERCEPT phase) plus `forwarding-pipe` (PROCESS phase) plus `monitoring` (OBSERVE phase) — same composition as the old Cache.
- Player wires `Client → Server → Data Cache → Database`. Reads flow Server → Data Cache: hit returns RESPOND; miss falls through to forwarding-pipe → Database. Writes pass transparently through Data Cache (`api_write` is not in CachingCapability's cacheable set, so INTERCEPT returns PASS, forwarding-pipe forwards to Database).
- `CachingCapability` is topology-agnostic. It does not know or care whether a request arrived from a Client or a Server. Its LRU, hit-rate tracking, and per-type stats all work identically in the new position.

### Why this approach

The engine routes purely by connection topology: a `FORWARD` outcome triggers `selectEgressConnection()` which delivers the request to the connected target's pending queue. Whatever that target is — Database, Cache, or anything else — its INTERCEPT phase fires when the request is processed. There is no "transparent proxy" mechanism that intercepts traffic between two arbitrary components; routing is connection-based. This means Data Cache must be the *target* of Server's FORWARD, not a sidecar. That is exactly what the redesign accomplishes by changing where the player wires it.

Two alternative approaches were considered and rejected:

- **New `DataCachingCapability` class.** Would duplicate ~90% of `CachingCapability`'s LRU logic for no behavioral benefit. The existing class already filters by request type — CDN caches `static_asset`, Data Cache caches `api_read`, both via the same code path.
- **PROCESS-phase cache.** PROCESS uses first-match-wins semantics, so a single component cannot have both caching and forwarding-pipe in PROCESS without engine changes to support intra-phase chaining. Significant complexity for no user-visible benefit.

## Server Capability Reconfiguration

**Current `register-td-defaults.ts`:**

```ts
new ProcessingCapability("processing", {
  handledTypes: ["api_read", "static_asset", "auth_required"],
  throughputPerTier: 15,
  emitProcessedEvent: true,
  typeLatencyPenalty: { auth_required: 4 },
})

new ForwardingCapability("forwarding", {
  handledTypes: ["api_write"],
  throughputPerTier: 15,
  emitForwardedEvent: true,
})
```

**New:**

```ts
new ProcessingCapability("processing", {
  handledTypes: ["static_asset", "auth_required"],
  throughputPerTier: 15,
  emitProcessedEvent: true,
  typeLatencyPenalty: { auth_required: 4 },
})

new ForwardingCapability("forwarding", {
  handledTypes: ["api_read", "api_write"],
  throughputPerTier: 15,
  emitForwardedEvent: true,
})
```

`api_read` moves from Processing to Forwarding. `static_asset` and `auth_required` stay on Processing for fallback behavior in topologies that do not use CDN/Gateway.

**Throughput budget:** unchanged. The engine pools throughput across all capabilities on a component (`componentThroughputPerTick`), so total Server budget stays at `15 + 15 = 30` per-tier. The redesign only changes which capability the budget *attributes* a read to (Forwarding instead of Processing). No retuning needed.

**Comment block update:** the existing inline note in `register-td-defaults.ts` references "Server has Processing + Forwarding totalling 30/tier; Wave 3 (50/tick) blows through it → needs horizontal scale." This stays accurate but the rationale is now "Server forwards reads downstream → Database is the new bottleneck → needs Data Cache or LB+Data Cache." Update the comment to reflect the new teaching moment.

## Component Type Rename

Rename `cache` → `data_cache` everywhere as a mechanical sweep. No back-compat alias.

**Production code touch points:**
- `src/modes/td/td-component-entries.ts`: rename `CACHE_ENTRY` → `DATA_CACHE_ENTRY`. Update `type`, `name`, `description`, `longDescription`, `capabilitiesHuman` per Section "Dossier and dashboard copy" below.
- `src/modes/td/register-td-defaults.ts`: update import and `compRegistry.register(...)` call.
- `src/modes/td/td-waves.ts`: replace `"cache"` with `"data_cache"` in every `availableComponents` array (Wave 3 through Wave 10).
- `src/dashboard/td/briefing-card.ts`: `ENTRY_BY_TYPE.cache` → `ENTRY_BY_TYPE.data_cache`.
- `src/dashboard/cyberpunk-hud.ts`: PALETTE entry `{ type: "cache", label: "Cache" }` → `{ type: "data_cache", label: "Data Cache" }`.
- `src/dashboard/cyberpunk-hud.css`: selector `.cp-palette-icon[data-type="cache"]` → `.cp-palette-icon[data-type="data_cache"]`.
- `src/dashboard/assets/cache.png` → `data-cache.png` (rename file; update CSS reference).

**Test code touch points:**
- `tests/integration/td/helpers.ts`: `buildCache` → `buildDataCache`. Internal call becomes `compRegistry.create("data_cache", ...)`.
- All test files referencing the old `"cache"` string or `CACHE_ENTRY` import.

**Capability composition unchanged:** Data Cache still combines `caching` + `forwarding-pipe` + `monitoring`, with the same default tier, max tier, and port shape (1 ingress, 1 egress, both `http` dataType, capacity 2 in / 1 out). Economics unchanged: `placementCost: 0`, `rentPerWave: 120`, `upgradeCostCurve: [150, 300, 600]`.

## CachingCapability — No Code Changes

The existing `src/capabilities/caching/caching-capability.ts` works in the new position without modification:

- Phase: `INTERCEPT` — fires whenever a request arrives at the component, regardless of source. This is the key invariant that makes the topology-only approach work.
- Cacheable types: `api_read` and `static_asset` — Data Cache only ever sees `api_read` traffic forwarded from Server (and `api_write`, which is not cacheable and PASSes), so the type filter naturally selects only reads. CDN only sees `static_asset` (and other client-bound traffic that PASSes).
- LRU internals, hit-rate tracking, per-type stats: unchanged.

**Engine flow with Data Cache in place:**

1. Server processes `api_read` → `ForwardingCapability` outcome `FORWARD`.
2. `selectEgressConnection()` picks the Server → Data Cache connection.
3. Request enqueued to Data Cache's pending queue.
4. Next tick (or later in the same fixed-point iteration), Data Cache's INTERCEPT phase runs.
   - **Hit:** `RESPOND` → request completes; latency credit flows back via the engine's existing latency-attribution path.
   - **Miss:** `PASS` → falls through to PROCESS phase. `forwarding-pipe` runs → outcome `FORWARD`. `selectEgressConnection()` picks the Data Cache → Database connection. Request enqueued to Database.
5. Database's `StorageCapability` handles the read → `RESPOND`.

Writes follow the same path but always miss INTERCEPT (PASS) and forward through to Database, where Storage handles the write and RESPONDs.

## Wave Definition Changes

**Wave 1 ("First Users"):**
- Definition: no code changes. `availableComponents` already includes `["server", "database"]`.
- Behavioral shift: lone Server can no longer win because reads have no egress target. Player must place Server + Database and wire them. Budget ($500 starting, Server $100 rent, Database $80 rent) accommodates this trivially.
- Lesson reframe (no copy change required): "your app needs both compute and storage."

**Wave 2 ("Mixed Traffic"):**
- Definition: no code changes.
- Already required Server + Database for writes. Reads now also flow to DB, but Database's tier-1 capacity (25/tick `StorageCapability` with `emitProcessedEvent`) handles Wave 2's 25/tick total comfortably.

**Wave 3 ("Traffic Spikes") — primary redesign target:**
- `availableComponents`: `["server", "database", "cache", "load_balancer"]` → `["server", "database", "data_cache", "load_balancer"]`.
- All other params unchanged: `intensity: 50`, `keyPoolSize: 10`, `duration: 30`, `ttl: 8`, composition `[api_read 0.7, api_write 0.3]`, SLA `availabilityTarget: 0.95`.
- New win paths:
  - **Data Cache rescue:** `Client → Server → Data Cache → Database`. Data Cache absorbs repeated `api_read` traffic before it hits the Database. With `keyPoolSize: 10` ≤ tier-1 cache capacity (10), hit rate approaches 100% after warmup.
  - **LB rescue:** `Client → LB → [Server1, Server2] → Database`. Patched minimally — see "LB rescue test patch" below.
- Loss path: lone `Server → Database` loses because Database is the bottleneck at 50 reads/tick (DB tier-1 cap 25/tick). This is the new teaching moment.

**Waves 4–10:**
- Mechanical sweep: `"cache"` → `"data_cache"` in `availableComponents`.
- No semantic changes. Data Cache remains an optional optimization for any wave whose Database becomes a read bottleneck.

**No Database retuning.** The existing `throughputPerTier: 25` happens to land in the right teaching range — Wave 2 fits, Wave 3 saturates.

## Wave 3 Integration Test Rewiring

`tests/integration/td/wave-3-traffic-spike.test.ts` (lone-server-loses):
- Old: `Client → Server` (no DB) lost because Server self-served reads but couldn't keep up.
- New: `Client → Server → Database` loses because Database saturates at 50/tick (cap 25/tick).
- Same assertion shape (drop rate ≥ 5%, wave fails), different bottleneck cause.

`tests/integration/td/wave-3-learning-arc.test.ts` (cache-rescue + LB-rescue):
- **Cache-rescue test rewired:**
  - Old: `Client → Cache → Server → Database`.
  - New: `Client → Server → Data Cache → Database`.
  - `buildCache()` → `buildDataCache()`.
  - Wire order: `wire(client, server)`, `wire(server, dataCache)`, `wire(dataCache, database)`.
  - Existing `CACHED_HIT > 10%` assertion stays; still measures Data Cache effectiveness.
- **LB-rescue test patch:**
  - Old: `Client → LB → [Server1, Server2] → Database`. Worked because Servers self-served reads.
  - With reads now forwarding to Database, two Servers fan into a single Database which saturates at 25/tick. The pure LB-rescue path no longer wins on its own.
  - **Minimal patch:** add a Data Cache to the topology — `Client → LB → [Server1, Server2] → Data Cache → Database`. Both Servers fan in to a shared Data Cache, which absorbs the read pressure from both. The LB still demonstrates load distribution (assertion: both Servers > 20% of total processed) and Data Cache demonstrates DB protection. This keeps the test passing without expanding scope into LB redesign.
  - Test name and copy updated to reflect "LB + Data Cache rescue" as the new label.
  - Full LB rebalancing (so a pure LB-rescue without Data Cache wins) is captured under "Future Considerations."

## Wave 1/2 Test Sweep

Any pre-existing test that placed a lone Server and asserted reads RESPOND will fail under the new Server config. Sweep tests for `buildServer` calls without an accompanying `buildDatabase` + `wire(server, database)` and patch where needed. This is mechanical.

## New Test: lone-DB-saturation in Wave 3

Add a new integration test in `tests/integration/td/wave-3-*.test.ts` (or extend `wave-3-traffic-spike.test.ts`) asserting that `Client → Server → Database` (no Data Cache, no LB) loses Wave 3 because Database saturates. The diagnostic should point to Database throughput. This pins the new teaching moment.

## Optional New Test: pin Server capability config

A unit test asserting that `register-td-defaults.ts` registers Server's Processing without `api_read` and Server's Forwarding with `api_read`. Pins the redesign against accidental regressions. Low cost.

## Dossier and Dashboard Copy

`src/dashboard/td/component-dossier.ts` — add a new `data_cache` dossier entry (Cache currently has none; it was on the Slice C roadmap). Suggested copy:

- **Title:** "Data Cache"
- **Role:** "Sits between your Server and Database to absorb repeated read queries — like Redis or Memcached in a real backend."
- **Wire:** `Server → Data Cache → Database`
- **Tip:** "When your Database is the bottleneck and reads repeat, drop a Data Cache in front of it to absorb the duplicates."
- **Capabilities (player-facing):**
  - "Responds directly on cache hit (skips Database)"
  - "Forwards misses through to Database"
  - "Best when reads have hot keys"
  - "Doesn't accelerate writes"

`src/modes/td/td-component-entries.ts` `DATA_CACHE_ENTRY`:
- `description`: "Caches repeated reads between Server and Database, so your Database doesn't get hammered twice for the same query."
- `longDescription`: "A Data Cache sits between your Server and Database, intercepting forwarded reads. On a hit it responds directly, sparing the Database; on a miss it forwards to the Database and remembers the result for next time. Acts like Redis or Memcached in a real backend."
- `capabilitiesHuman`: as above.

`src/dashboard/td/diagnose-wave.ts` — update the loss diagnostic copy. Old: "no cache in the read path." New (when DB saturates with no Data Cache present): "Your Database is saturated. Put a Data Cache between your Server and Database to absorb repeated reads, or scale horizontally."

`src/dashboard/cyberpunk-hud.ts` — PALETTE entry: `{ type: "data_cache", label: "Data Cache" }`.

`src/dashboard/cyberpunk-hud.css` — selector and asset path updated.

`src/dashboard/td/briefing-card.ts` — `ENTRY_BY_TYPE.data_cache: DATA_CACHE_ENTRY`. If the briefing card has a label registry mapping types to display names, ensure `data_cache` → "Data Cache" is present.

## Touch-Point Summary

**Production code:**
- `src/modes/td/td-component-entries.ts` — rename `CACHE_ENTRY` → `DATA_CACHE_ENTRY`, update copy.
- `src/modes/td/register-td-defaults.ts` — Server `handledTypes` swap; register renamed entry.
- `src/modes/td/td-waves.ts` — `availableComponents` sweep.
- `src/dashboard/td/component-dossier.ts` — add `data_cache` dossier.
- `src/dashboard/td/briefing-card.ts` — `ENTRY_BY_TYPE` key.
- `src/dashboard/td/diagnose-wave.ts` — loss diagnostic copy.
- `src/dashboard/cyberpunk-hud.ts` — PALETTE entry.
- `src/dashboard/cyberpunk-hud.css` — selector + asset path.
- `src/dashboard/assets/cache.png` → `data-cache.png` — file rename.

**Tests:**
- `tests/integration/td/helpers.ts` — `buildCache` → `buildDataCache`.
- `tests/integration/td/wave-3-traffic-spike.test.ts` — topology update.
- `tests/integration/td/wave-3-learning-arc.test.ts` — cache-rescue + LB-rescue rewiring.
- `tests/integration/td/campaign-headless.test.ts` — sweep `"cache"` references.
- `tests/unit/td-component-entries-edge.test.ts` — rename.
- Wave 1/2 tests — sweep for missing `buildDatabase` + `wire(server, database)`.
- New test: lone-DB-saturation in Wave 3.
- Optional new test: pin Server capability config.

**No changes:**
- `src/capabilities/caching/caching-capability.ts` — works topology-agnostically as-is.
- `src/core/engine/*` and `src/core/component/component.ts` — no engine changes.
- CDN code — unaffected.

**Test count estimate:** currently 762; expect roughly ~770 after redesign (~+2 new, ~6–10 modified).

## Implementation Slicing

The plan-writing skill will own the detailed task breakdown. As an outline for sequencing:

- **Slice A (foundational, breaks tests by design):** Server capability config swap. Component entry rename. Wave `availableComponents` sweep. `buildCache` → `buildDataCache` helper rename. Asset rename. After this slice the test suite is broken in the expected places.
- **Slice B (test rewiring):** Wave 1/2 fixups. Wave 3 topology updates (lone-server-loses, cache-rescue, LB-rescue with Data Cache). New lone-DB-saturation test. Optional Server capability pin. After this slice the test suite is green again.
- **Slice C (dashboard polish):** Palette entry. CSS selector and asset path. Dossier addition. Briefing card. Diagnostic copy. Visual smoke test in the dashboard.

## Future Considerations

Captured for later phases; not in scope here.

1. **Cache invalidation mechanic.** Real-world write-around pattern: writes flow `Client → Server → Database → Data Cache (evict)`. The "evict" signal could be a synthetic `cache_invalidate` request type that the Database emits as a side effect of processing `api_write`, flowing back upstream via the connection topology to Data Cache, which removes the matching key from its LRU. Teaches write-around invalidation cleanly without breaking the abstraction. Worth prototyping in a Phase 2 spec.
2. **Load Balancer tuning.** Wave 3's pure LB-rescue (without Data Cache) currently cannot win because horizontal Server scaling does not relieve DB pressure. A future LB redesign could revisit forwarding throughput, fan-out semantics, or introduce DB-side scaling so the LB-rescue path stands on its own again.
3. **Write-through and write-back patterns.** Capability variants if we want to teach the full caching strategy spectrum.
4. **TTL-based cache expiry.** Currently CachingCapability's LRU only evicts under capacity pressure. Adding time-based eviction would enable "stale data" teaching moments and support more realistic cache invalidation scenarios.

## Open Questions

None. All design decisions are pinned above.

# Stage 3d Design — Waves 4 + 5: Edge Components

**Status.** Design approved 2026-04-14. Awaiting implementation plan.

**Branch.** `feature/stage-3d-waves-4-5`.

**Scope.** Ship Waves 4 and 5 of the TD campaign as a single stage. Both waves teach the same architectural pattern — *a specialized edge component beats brute-force Server* — applied to two different bottlenecks (static asset volume in Wave 4, auth latency in Wave 5). The waves share enough structure (one new request type each, one new edge component each, one Server `handledTypes` extension each) to ship under one spec, plan, and PR.

## Goal

Make the TD campaign playable through Wave 5. After this stage, a player who has cleared Waves 1–3 can:

1. Face Wave 4's static-asset volume problem and learn that adding a CDN drops Server load and unlocks the SLA.
2. Face Wave 5's auth-latency problem and learn that an API Gateway upstream of the Server cuts auth latency from 5 ticks to 1.

Both lessons land via the existing wave-loss/wave-rescue scaffold proven in Wave 3.

## Architectural context

Source-dive findings that shaped the design:

- **`AuthCapability` is a near-no-op today.** It returns `PASS` on `auth_required` with `+1` latency at tier 1 (`+0` at tier 2). It does not reject. To make the Gateway *actually rescue*, we add an opt-in `terminateAuthRequired` option that switches the behavior to `RESPOND` (mirroring `CachingCapability`'s cache-hit short-circuit). TD's Gateway sets the option; the sandbox flow that currently generates `auth_required` traffic stays on the existing `PASS` path. Without this, every `auth_required` request that traverses Gateway still ends up at Server and pays the latency tax — defeating the rescue.
- **`CachingCapability` already accepts `static_asset`.** `CACHEABLE_TYPES = {api_read, static_asset}`, `BASE_KEYS_PER_TYPE.static_asset = 15`, slots are already keyed `${type}:${slot}`. Per-type counters are missing — `getStats()` only returns aggregate `hitRate`. We add a `hitRateByType` field for the diagnosis-panel "aha" moment.
- **TD's Server only handles `api_read`.** `td-component-entries.ts` builds `ProcessingCapability` with `handledTypes: ["api_read"]`. Without extending this list, both new request types silently fall through Server's PROCESS phase, which makes the wave impossible to reason about. Both waves require extending `handledTypes` so Server *can* serve the new types — just inefficiently.
- **`TDTrafficSource` is composition-driven and type-agnostic.** Adding a new request type to a wave is a `composition` map entry. Zero source changes.
- **`TDEconomy.creditRevenue` falls back to `0`** for unknown types. Adding `static_asset: 0.3` and `auth_required: 1.5` entries to each wave's `revenuePerRequestType` is sufficient.
- **Existing `CDN` and `API Gateway` registry entries** in `src/core/registry/component-entries.ts` are sandbox-tuned — they exist but are not in the TD bundle. We add TD-tuned exports to `src/modes/td/td-component-entries.ts`.

The roadmap's "Stage 3d is pure content" framing turned out to be *almost* right. Two small capability extensions (one stat field on Caching, one option on Processing) plus two new TD bundle exports is the actual delta — no engine work.

## Slices

**Slice A — Wave 4 content.** New `static_asset` request type via wave composition; `TD_CDN_ENTRY` added to TD bundle; Server `handledTypes` extended to include `static_asset`; per-type cache stats on `CachingCapability`; `WAVE_4` definition; unit + integration tests.

**Slice B — Wave 5 content.** New `auth_required` request type via wave composition; `TD_API_GATEWAY_ENTRY` added to TD bundle; Server `handledTypes` extended to include `auth_required` plus `typeLatencyPenalty` option on `ProcessingCapability`; `WAVE_5` definition; unit + integration tests.

**Slice C — Dashboard polish.** Briefing-card icon registry entries for `static_asset` and `auth_required`; diagnosis-panel per-type cache hit rate row.

Slices A and B can ship in either order in the implementation plan. Slice C depends on both.

## Capability changes

### `CachingCapability` — per-type stats

Add per-type counters and expose them via `getStats()`.

**New stat field.**

```ts
hitRateByType: Record<string, { hits: number; misses: number; hitRate: number }>
```

**Implementation.** Add two private maps (`hitsByType`, `missesByType`) alongside the existing `hits` / `misses` counters. Increment per-type and aggregate counters together inside `process()`. `getStats()` derives `hitRateByType[type] = { hits, misses, hitRate: hits / (hits + misses) }` for every type seen since construction.

**No behavior change.** Existing `hits`, `misses`, and `hitRate` fields stay. Slot-keying logic unchanged. Existing CachingCapability tests must remain passing.

### `AuthCapability` — `terminateAuthRequired` option

Add an opt-in option that switches `auth_required` handling from `PASS` to `RESPOND`.

**New option.**

```ts
interface AuthCapabilityOptions {
  /**
   * When true, auth_required requests are RESPONDed (terminated) at this
   * capability instead of PASSed downstream. Mirrors how CachingCapability
   * terminates cache hits. TD mode's API Gateway sets this so auth_required
   * never reaches Server, which is the entire mechanism by which the Gateway
   * rescues Wave 5. Default: false (sandbox flow keeps existing PASS behavior).
   */
  terminateAuthRequired?: boolean;
}
```

**Implementation.** Constructor accepts the option. In `process()`, when `request.type === "auth_required"` and `terminateAuthRequired` is true, return `RESPOND` instead of `PASS`. The latency event (`+1` at tier 1, `+0` at tier 2) is unchanged. Non-`auth_required` types still `PASS`.

**Why an option, not a behavior flip.** `src/modes/sandbox/sandbox-traffic-presets.ts` already generates `auth_required` traffic and the sandbox's generic Server (with default `ProcessingCapability` accepting all types) currently serves it. Flipping `AuthCapability` globally would change sandbox behavior with no test coverage to catch regressions. The opt-in pattern matches the TD-options approach used in `ProcessingCapability`, `StorageCapability`, etc. — it's the established mechanism for "TD mode wants different behavior than sandbox."

### `ProcessingCapability` — `typeLatencyPenalty` option

Add an optional per-type latency penalty that adds to the base `latencyAdded: 1` when emitting `PROCESSED` events.

**New option.**

```ts
interface ProcessingCapabilityOptions {
  // ...existing fields...
  /**
   * Per-type latency penalty in ticks, added on top of the base
   * latency 1 when emitting PROCESSED events. Used by TD mode's
   * Server to make `auth_required` expensive: the player feels
   * "Server can serve auth, but it's so slow my SLA fails."
   * Default: empty (no penalties).
   */
  typeLatencyPenalty?: Record<string, number>;
}
```

**Implementation.** Store the table in the constructor. In `process()`, look up `typeLatencyPenalty[request.type] ?? 0` and add it to the existing `latencyAdded: 1` value when constructing the PROCESSED event. No throughput effect, no schema change.

**Why latency, not throughput.** A throughput tax (e.g. "auth_required eats 2 slots") would also work, but it requires a richer change to `getThroughputPerTick` / the engine's tick-budget bookkeeping. Latency is strictly additive, exercises the existing SLA `maxAvgLatency` gate, and produces a player-legible failure mode (`avg latency: 8.2 (max: 7) — FAILED SLA`).

**When this fires.** With `AuthCapability.terminateAuthRequired: true` upstream, `auth_required` requests never reach Server's PROCESS phase — the Gateway short-circuits them. The penalty only fires in the *Server-only* topology (Wave 5 without an API Gateway). That's the wave-loss state we want to be visibly bad.

## TD bundle changes — `src/modes/td/td-component-entries.ts`

### `SERVER_ENTRY` — extend handled types and add penalty

```ts
capabilities: [
  { id: "processing" as CapabilityId, defaultTier: 1, maxTier: 3 },
  // ...rest unchanged
],
```

The capability is unchanged at the registry level; the *factory* in `registerTDDefaults` constructs `ProcessingCapability` with:

```ts
new ProcessingCapability(id, {
  handledTypes: ["api_read", "static_asset", "auth_required"],
  throughputPerTier: 20,
  emitProcessedEvent: true,
  typeLatencyPenalty: { auth_required: 4 },
})
```

`capabilitiesHuman` and `longDescription` updated to reflect that Server now serves all three types but charges +4 latency on `auth_required`.

### `TD_CDN_ENTRY` (new export)

```ts
export const CDN_ENTRY: ComponentRegistryEntry = {
  type: "cdn",
  name: "CDN",
  description: "Edge cache for static assets. Absorbs static_asset volume so Servers can focus on API work.",
  longDescription:
    "A CDN sits at the edge and caches static_asset responses. The first request " +
    "for an asset misses and forwards downstream; every subsequent request for the " +
    "same asset is served from the CDN's cache without ever touching your Servers. " +
    "CDNs help most when traffic has hot static assets; they help least when every " +
    "static request is unique.",
  capabilitiesHuman: [
    "Caches static_asset responses at the edge",
    "Serves cache hits directly (fast path, no Server load)",
    "Forwards misses downstream to populate the cache",
    "Low upkeep — runs cheap once placed",
  ],
  capabilities: [
    { id: "caching" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 2, connections: [] },
  ],
  placementCost: 200,
  upgradeCostCurve: [200, 400],
  visual: { icon: "cdn", color: "#10b981", shape: "hexagon" },
  conditionProfile: RESILIENT_CONDITION_PROFILE,
};
```

`RESILIENT_CONDITION_PROFILE` is a new constant in the same file with the same shape as the existing `DEFAULT_CONDITION_PROFILE` but `degradedThreshold: 0.5`, `criticalThreshold: 0.2`, `decayRate: 0.03`, `recoveryRate: 0.03` — matching the sandbox `resilientProfile` so CDN reads as "robust edge component."

The sandbox CDN entry has a `filter` capability, which we drop for the TD variant — the wave-progression narrative says "FilterCapability intercepts," but `CachingCapability` already short-circuits on `static_asset` because the type is in `CACHEABLE_TYPES`. Adding `filter` would be ceremony with no behavior contribution.

### `TD_API_GATEWAY_ENTRY` (new export)

```ts
export const API_GATEWAY_ENTRY: ComponentRegistryEntry = {
  type: "api_gateway",
  name: "API Gateway",
  description: "Edge auth handler. Validates auth_required requests upstream so Servers don't have to.",
  longDescription:
    "An API Gateway sits in front of your Servers and handles authentication for " +
    "auth_required requests at the edge. AuthCapability runs in the INTERCEPT phase " +
    "and adds only 1 tick of latency, vs. 5 ticks if a Server has to handle it. " +
    "Once authenticated, the request is forwarded downstream just like any other.",
  capabilitiesHuman: [
    "Validates auth_required requests at the edge",
    "Adds only 1 tick of auth latency (vs. 5 on a Server)",
    "Forwards authenticated requests downstream",
    "Other request types pass through unchanged",
  ],
  capabilities: [
    { id: "auth" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 2, connections: [] },
  ],
  placementCost: 250,
  upgradeCostCurve: [250, 500],
  visual: { icon: "api-gateway", color: "#ec4899", shape: "rectangle" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};
```

The sandbox API Gateway entry has `rate-limit` and `routing` capabilities, which we drop for the TD variant. Rate limiting is a Wave 7 concept; routing is a Wave 9 concept. The TD Gateway is auth + forwarding + monitoring only.

`AuthCapability` for this entry is constructed in `registerTDDefaults` with `terminateAuthRequired: true` so it short-circuits `auth_required` at the Gateway and prevents the request from reaching Server.

### `registerTDDefaults` updates

Wire CDN and API Gateway into the bundle. Three factory updates:

- Server's `ProcessingCapability` factory passes `handledTypes: ["api_read", "static_asset", "auth_required"]` and `typeLatencyPenalty: { auth_required: 4 }`.
- CDN's `CachingCapability` factory uses defaults — the existing `CACHEABLE_TYPES` already accepts `static_asset`.
- API Gateway's `AuthCapability` factory passes `terminateAuthRequired: true`.

## Wave definitions — `src/modes/td/td-waves.ts`

### `WAVE_4 — "Marketing Adds Images"`

```ts
export const WAVE_4: TDWaveDefinition = {
  id: 4,
  name: "Marketing Adds Images",
  startingBudget: 700,
  intensity: 80,
  composition: new Map([
    ["api_read", 0.4],
    ["api_write", 0.2],
    ["static_asset", 0.4],
  ]),
  duration: 30,
  ttl: 8,
  availableComponents: ["server", "database", "cache", "load_balancer", "cdn"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
  ]),
  readKeyPoolSize: 15,
  sla: {
    availabilityTarget: 0.92,
    maxAvgLatency: 6,
    minBudget: 0,
    penaltyPerTick: 5,
  },
};
```

### `WAVE_5 — "The Authentication Wall"`

```ts
export const WAVE_5: TDWaveDefinition = {
  id: 5,
  name: "The Authentication Wall",
  startingBudget: 800,
  intensity: 150,
  composition: new Map([
    ["api_read", 0.3],
    ["api_write", 0.2],
    ["static_asset", 0.3],
    ["auth_required", 0.2],
  ]),
  duration: 30,
  ttl: 8,
  availableComponents: [
    "server",
    "database",
    "cache",
    "load_balancer",
    "cdn",
    "api_gateway",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
  ]),
  readKeyPoolSize: 15,
  sla: {
    availabilityTarget: 0.92,
    maxAvgLatency: 7,
    minBudget: 0,
    penaltyPerTick: 5,
  },
};
```

`TDTrafficSource` and `TDEconomy` need zero changes to handle either wave.

**Topology persistence assumption.** Wave 5's `startingBudget: 800` is sized for *adding* an API Gateway (~$250) and possibly scaling, not for rebuilding from scratch. `TDModeController.advancePhase` does not reset placed components between waves — it resets the per-wave economy via `setEconomy`. The player carries their Wave 4 rescue topology (Client → CDN → Cache → Server → Database, ≈$650) into Wave 5 and only needs to fund the Gateway. If implementation work reveals that the dashboard's wave-transition flow *does* tear down the topology, that's an unrelated bug we'd need to fix as part of this stage — note it in the plan.

## Tests

### Unit tests

1. **`tests/unit/caching-per-type-stats.test.ts`** — Drive a `CachingCapability` instance with a mixed `api_read` + `static_asset` workload. Assert `getStats().hitRateByType.api_read` and `.static_asset` carry the expected `hits`, `misses`, and `hitRate` values. Verify aggregate `hitRate` is unchanged.

2. **`tests/unit/processing-type-latency-penalty.test.ts`** — Construct a `ProcessingCapability` with `typeLatencyPenalty: { auth_required: 4 }` and `emitProcessedEvent: true`. Drive an `auth_required` request; assert the emitted PROCESSED event has `latencyAdded: 5`. Drive an `api_read` request; assert `latencyAdded: 1`. Verify a default-config processor still emits `latencyAdded: 1` for both.

3. **`tests/unit/auth-capability-terminate.test.ts`** — Construct an `AuthCapability` with `terminateAuthRequired: true`. Drive an `auth_required` request; assert outcome is `RESPOND` (not `PASS`) with `latencyAdded: 1` at tier 1. Drive an `api_read` request; assert outcome is still `PASS` with no events. Construct a default `AuthCapability` (no option); assert it still `PASS`es `auth_required` (preserves the existing four assertions in `auth-capability.test.ts`).

4. **`tests/unit/td-component-entries-edge.test.ts`** — Assert `TD_CDN_ENTRY` has `caching` + `forwarding-pipe` + `monitoring` capabilities, cost 200, two ports of capacity 2. Assert `TD_API_GATEWAY_ENTRY` has `auth` + `forwarding-pipe` + `monitoring` capabilities, cost 250, two ports of capacity 2. Assert `registerTDDefaults` registers both.

### Integration tests — `tests/integration/td/`

5. **`wave-4-server-only-loses.test.ts`** — Topology: Client → Server → Database. Run `WAVE_4` to completion. Assert SLA verdict is `lose`: static_asset volume blows the 20/tick processing cap, the SLA `availability` gate trips. Confirms the wave is meaningfully hard without CDN.

6. **`wave-4-cdn-rescue-wins.test.ts`** — Topology: Client → CDN → Server → Database. Run `WAVE_4` to completion. Assert SLA verdict is `win`. Assert the CDN's `CachingCapability.getStats().hitRateByType.static_asset.hitRate >= 0.8`. Confirms the CDN is the rescue and the per-type stat is the diagnostic signal.

7. **`wave-5-server-only-loses.test.ts`** — Topology: Client → CDN → Server → Database (carrying forward Wave 4's solution). Run `WAVE_5` to completion. Assert SLA verdict is `lose` because `latency.actual > 7`. Confirms the latency tax is the real bite — availability alone might still pass.

8. **`wave-5-gateway-rescue-wins.test.ts`** — Topology: Client → CDN → API Gateway → Server → Database. Run `WAVE_5` to completion. Assert SLA verdict is `win`. Assert that Server's `ProcessingCapability` processed-count for `auth_required` is `0` — the Gateway's `terminateAuthRequired: true` short-circuits the request, so Server never sees auth_required at all. Confirms the rescue mechanism, not just the verdict.

### Test scaffolding

The four integration tests reuse the existing `tests/integration/td/helpers.ts` builders (`buildServer`, `buildDatabase`, `buildCache`, `buildLoadBalancer`). New helpers `buildCDN` and `buildAPIGateway` are added in the same file, mirroring the existing pattern: mint via `compRegistry.create(...)` so the helper and `registerTDDefaults` share the same source of truth. The unification work deferred in Stage 3a/3b is in scope here for the two new helpers; existing helpers stay as-is.

### Dashboard

- **Palette.** No code change. Tiles auto-show via `availableComponents`, which Slice A and Slice B add to.
- **Briefing card.** The icon registry (currently keyed on `api_read` / `api_write`) gains `static_asset` and `auth_required` entries with one-line descriptions. Briefing card layout already loops over `composition` keys.
- **Diagnosis panel.** When the active topology contains a `Cache` or `CDN`, the diagnosis panel renders a new "cache hit rate by type" mini-table. Pulls from `CachingCapability.getStats().hitRateByType`. Hidden when no caching component exists.

## Risk register

1. **Front-loaded static_asset clusters in Wave 4.** `TDTrafficSource.buildTypeSchedule` shuffles tick types deterministically. With a fixed seed it is reproducible, but a pathological seed could cluster all 12 static_asset ticks at the start of the wave before the player has placed a CDN. **Mitigation.** Playtest before merge with the dashboard's seeded RNG. If the cluster is unwinnable from `startingBudget: 700`, bump duration to 35 ticks or budget to 750. Note in `td-stage-gotchas.md` if it bites.

2. **Wave 5 latency-tax magnitude.** With 20% of traffic getting `+4` latency on Server, weighted contribution to avg latency is `0.2 × 4 = 0.8` ticks. Combined with the Wave 4 baseline (likely ~5 ticks healthy), avg latency lands around `5.8`. With `maxAvgLatency: 7`, that's *not* a guaranteed fail. **Mitigation.** Playtest. If Wave 5 server-only doesn't reliably trip the latency gate, raise the penalty from `+4` to `+6` and re-test. If that doesn't trip either, lower `maxAvgLatency` to `6.5`. Tune until the server-only and gateway-rescue topologies are clearly separated.

3. **CDN narrative drift.** The wave-progression doc says "FilterCapability intercepts" — our TD CDN drops `filter` and uses `CachingCapability` directly. Briefing card copy must talk about caching, not filtering, or the dashboard will contradict the narrative doc. **Mitigation.** The `description` and `longDescription` strings in `TD_CDN_ENTRY` above are already cache-framed.

4. **Dashboard "no caching component" state for the new diagnosis row.** If a player wins Wave 5 with a topology that has no Cache or CDN (unlikely but possible if Server-only with a pure auth-Gateway play somehow squeaks past — depends on tuning), the diagnosis panel must hide the cache-hit-rate row gracefully, not render an empty table or NaN. **Mitigation.** Render the row only if at least one component in the topology has a `caching` capability and `hitRateByType` is non-empty.

5. **Topology-persistence assumption could be wrong.** I'm assuming the dashboard's assess→build flow keeps placed components alive across waves. If it doesn't, the Wave 5 startingBudget of $800 is grossly under-funded for a from-scratch build. **Mitigation.** First plan task is a 5-minute dashboard read to confirm. If false, either fix the dashboard or bump `startingBudget: 800 → 1500`.

6. **No engine work expected.** The source-dive ruled out chaos events, stream lifecycle, and zone latency — all Wave 7+ concerns. If anything bites us during implementation, log it in `docs/claude/td-stage-gotchas.md` during finishing-a-development-branch.

## Out of scope (deferred)

- **Service Registry.** Wave 5 narrative mentions it as a "structural unlock" — defer until a later wave's topology size makes manual wiring tedious. Probably Wave 6 or 7.
- **Cross-wave budget carry-over.** Listed in `docs/claude/implementation-status.md` as a future direction. Wave 4→Wave 5 still does a clean per-wave economy reset for now.
- **Tier upgrades.** Still deferred from Stage 3c+. CDN and API Gateway both have `maxTier: 2` for forward compatibility, but no tier-upgrade UI exists.
- **Briefing card "new this wave" badge.** Polish item from the cross-wave open questions in the roadmap. Defer until the palette gets crowded enough to confuse players — Wave 6+.
- **Hoisted default `revenuePerRequestType` table.** Cross-wave open question #1 from the roadmap. Today, each wave duplicates `api_read: 1, api_write: 2`. Continuing the duplication is fine until a wave needs to *override* a default — defer until then.
- **Request-type registry (`RequestTypeDef` map).** Cross-wave open question #2. Type metadata lives in capability code (e.g. `CACHEABLE_TYPES` in `CachingCapability`). Hoisting to a registry is a refactor with no behavior payoff in Stage 3d. Defer.

## Update checklist (post-merge)

When this branch ships, the following docs need updating in the same PR:

- `docs/claude/implementation-status.md` — bump "Current stage" to 3d, add Wave 4 + 5 to the list of merged-into-main entries, update the test count.
- `docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md` — flip Waves 4 and 5 from `⬜ Planned` to `✅ Shipped` in the status table, fill in the merge date.
- `docs/claude/td-stage-gotchas.md` — add Stage 3d section if anything bit us during implementation (likely candidates: a tuning surprise, a test-helper pattern that would have been good to know).

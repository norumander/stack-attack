# Stage 4b — Wave 9: Going Global (Multi-Zone Latency)

**Status:** Design approved 2026-04-14. Simulation layer only — dashboard zone visualization deferred.

## 1. Goal

Wave 9 ("Going Global") teaches **geographic latency**. Requests arrive from 3 zones (NA-East 40%, EU-West 35%, AP-South 25%). Cross-zone connections add latency penalties: NA↔EU +3 ticks, NA↔AP +5 ticks, EU↔AP +4 ticks. A single-datacenter topology forces all non-local requests through high-latency cross-zone hops, failing the latency SLA. The player learns to replicate infrastructure across zones and add **DNS/GTM** to route requests to the nearest zone.

This is the first wave with multi-zone topology. Waves 1–8 use a single `"default"` zone with no cross-zone latency. Wave 9 introduces geographic reality: the speed of light is a constraint.

## 2. Architectural context (source-dive findings)

### Zone type infrastructure — complete, not wired

1. **`ZoneTopology` is fully typed.** `src/core/types/zone.ts` defines `ZoneTopology` (`zones: string[]`, `pairLatency: Map<string, number>`), `zonePairKey(a, b)` for canonical pair ordering, and `getZonePairLatency(topology, a, b)` which returns 0 for same-zone or null zones.

2. **`Request.originZone` is typed.** `string | null`, currently always `null`. TDTrafficSource sets it in `generate()` at line 75.

3. **`Component.zone` is typed.** `string | null`, passed as the third parameter to `compRegistry.create(type, position, zone)`. Currently always `null` in TD mode.

4. **`SimulationState.zoneTopology` is stored.** Constructor takes `ZoneTopology`, stored as readonly field. Accessible throughout the engine as `state.zoneTopology`.

5. **`TDWaveDefinition` has zone fields.** `zoneTopology?: { zones: string[], pairLatency: Map<string, number> }` (line 47) and `zoneDistribution?: Map<string, number>` (line 51). No wave currently uses them.

### Critical gap: engine does NOT apply zone latency

6. **`getEffectiveLatency()` ignores zones.** In `src/core/engine/effective-bandwidth.ts` (lines 28-56), latency is computed as `conn.latency` + chaos injection + condition multiplier. There is **no call to `getZonePairLatency()`**. Cross-zone connections have the same latency as same-zone connections. This is the single engine change needed.

7. **`TDModeController.getInitialZoneTopology()` returns hardcoded single-zone.** Line 363-365: `{ zones: ["default"], pairLatency: new Map() }`. Must read `wave.zoneTopology` instead.

8. **`TDTrafficSource` doesn't assign zones to requests.** `originZone: null` at line 75. Must populate from `wave.zoneDistribution`.

### Existing capabilities — ready

9. **GeoRoutingCapability is production-ready.** `src/capabilities/geo-routing/geo-routing-capability.ts` implements `EngineConsultable.selectConnection()`. Reads `request.originZone`, iterates egress connections, checks each target component's zone, and routes to the lowest-latency zone via `getZonePairLatency()`. Same-zone connections are returned immediately.

10. **DNS/GTM component entry exists in sandbox registry.** `src/core/registry/component-entries.ts` lines 209-224: `dns_gtm` with `geo-routing + forwarding + health-check + monitoring`. Not in TD bundle yet.

## 3. Scope: what changes

| Change                                                          | Slice  |
|-----------------------------------------------------------------|--------|
| `getEffectiveLatency()`: add zone-pair latency                  | A (engine) |
| Unit test: zone latency applied to cross-zone connections       | A (engine) |
| `TDModeController.getInitialZoneTopology()`: read wave config   | A (engine) |
| `TDTrafficSource.generate()`: populate originZone               | B (TD)  |
| Unit test: zone assignment from zoneDistribution                | B (TD)  |
| TD_DNS_GTM_ENTRY + registerTDDefaults wiring                   | B (TD)  |
| `buildServer`/`buildDatabase`/etc: accept optional zone param   | B (TD)  |
| `buildDNSGTM` test helper                                       | B (TD)  |
| WAVE_9 definition + unit test                                   | B (TD)  |
| wave-9-single-zone-loses.test.ts                                | C (test) |
| wave-9-multi-zone-dns-wins.test.ts                              | C (test) |
| Handoff docs: implementation-status, gotchas, CLAUDE.md         | D (docs) |

## 4. Slice A — Engine: zone-aware latency

### 4a. Modify getEffectiveLatency()

In `src/core/engine/effective-bandwidth.ts`, after the chaos injection block (line 47) and before the condition multiplier (line 51), add zone-pair latency:

```ts
  // Zone-pair latency: cross-zone connections pay a geographic penalty.
  const toComp = state.components.get(conn.target.componentId);
  if (fromComp && toComp) {
    latency += getZonePairLatency(
      state.zoneTopology,
      fromComp.zone,
      toComp.zone,
    );
  }
```

Import `getZonePairLatency` from `@core/types/zone.js` at the top of the file.

**Placement:** After chaos (additive penalty) but before condition multiplier (multiplicative). Zone latency is a fixed geographic penalty — it doesn't get amplified by degraded condition. The condition multiplier should apply only to base latency + chaos, not zone latency. So the actual code should be:

```ts
  let latency = conn.latency;
  // ... chaos injection ...
  
  // Condition multiplier applies to base + chaos only (not zone penalty)
  const fromComp = state.components.get(conn.source.componentId);
  if (fromComp) {
    latency *= getLatencyMultiplier(fromComp);
  }
  
  // Zone-pair latency is additive, not affected by condition
  const toComp = state.components.get(conn.target.componentId);
  if (fromComp && toComp) {
    latency += getZonePairLatency(state.zoneTopology, fromComp.zone, toComp.zone);
  }
  
  return latency;
```

This preserves the existing behavior for single-zone topologies (both zones null → 0 added).

### 4b. Unit test for zone latency

New test: `tests/unit/effective-latency-zone.test.ts`. Verifies:
- Same-zone connection: 0 added latency
- Cross-zone connection: zone-pair penalty added
- Null zones: 0 added (backward compat)
- Zone latency not multiplied by condition

### 4c. TDModeController zone topology hookup

In `src/modes/td/td-mode-controller.ts`, replace line 363-365:

```ts
getInitialZoneTopology(): ZoneTopology {
  return this.currentWave.zoneTopology
    ? { zones: [...this.currentWave.zoneTopology.zones], pairLatency: this.currentWave.zoneTopology.pairLatency }
    : { zones: ["default"], pairLatency: new Map() };
}
```

Waves 1–8 have no `zoneTopology` → returns the existing default. Wave 9+ returns the wave's topology.

## 5. Slice B — TD content: zones, DNS/GTM, wave definition

### 5a. TDTrafficSource zone assignment

In `src/modes/td/td-traffic-source.ts`, populate `originZone` at line 75. Build a zone schedule using the same stratified approach as `buildTypeSchedule`:

```ts
// In constructor:
this.zoneSchedule = wave.zoneDistribution
  ? buildZoneSchedule(wave, rng)
  : null;

// In generate(), per request:
originZone: this.zoneSchedule
  ? this.zoneSchedule[Math.floor(rng() * this.zoneSchedule.length)]
  : null,
```

**Use weighted random per request (not a schedule).** All requests in a tick have the same type but should have varied zones. A per-request `pickZone(distribution, rng)` does weighted random selection from the distribution map. This is simpler than building a zone schedule and gives natural zone mixing within each tick:

```ts
originZone: this.wave.zoneDistribution
  ? pickZone(this.wave.zoneDistribution, this.rng)
  : null,
```

### 5b. TD_DNS_GTM_ENTRY

New entry in `src/modes/td/td-component-entries.ts`:

- **type:** `"dns_gtm"`
- **capabilities:** geo-routing + forwarding-pipe + monitoring
- **ports:** 1 ingress (capacity 4), 1 egress (capacity 4) — needs multiple egress connections for multi-zone routing
- **placementCost:** $300
- **visual:** `{ icon: "dns", color: "#14b8a6", shape: "globe" }`
- **conditionProfile:** RESILIENT

The TD entry replaces the sandbox's `forwarding` capability with `forwarding-pipe` (high-throughput variant) and drops `health-check` (not needed for Wave 9). GeoRoutingCapability is an `EngineConsultable` — it influences connection selection, not traffic processing.

**Note:** GeoRoutingCapability has no `phase` property (it's not INTERCEPT or PROCESS — it's consultable only). The engine calls `selectConnection()` on it during delivery. It needs to be registered in the capability registry but doesn't participate in the normal process pipeline.

### 5c. registerTDDefaults wiring

Register:
- `geo-routing` capability factory: `new GeoRoutingCapability("geo-routing" as CapabilityId)`
- `DNS_GTM_ENTRY` component entry
- Import GeoRoutingCapability from `@capabilities/geo-routing/geo-routing-capability.js`

### 5d. Extend test helpers for zone support

Modify `buildServer`, `buildDatabase`, `buildCache`, and other registry-backed builders to accept an optional `zone` parameter:

```ts
export function buildServer(
  compRegistry: ComponentRegistry,
  zone?: string,
): { component: Component; ingressPortId: PortId; egressPortId: PortId } {
  const component = compRegistry.create("server", { x: 0, y: 0 }, zone ?? null);
  return { component, ...singlePortIds(component) };
}
```

Same pattern for buildDatabase, buildCache, buildCDN, buildAPIGateway, buildQueue, buildWorker, buildCircuitBreaker, buildStreamingServer, buildBlobStorage. The `zone` parameter defaults to `null` (backward compatible — all existing tests pass unchanged).

Add `buildDNSGTM(compRegistry)` helper (no zone param — DNS/GTM sits at the entry point, zone-agnostic).

### 5e. WAVE_9 definition

```ts
export const WAVE_9: TDWaveDefinition = {
  id: 9,
  name: "Going Global",
  startingBudget: 2500,
  intensity: 800,
  composition: new Map([
    ["api_read", 0.25],
    ["api_write", 0.10],
    ["static_asset", 0.15],
    ["auth_required", 0.10],
    ["batch", 0.10],
    ["stream", 0.30],
  ]),
  duration: 40,
  ttl: 15,
  availableComponents: [
    "server", "database", "cache", "load_balancer", "cdn", "api_gateway",
    "queue", "worker", "circuit_breaker", "streaming_media_server", "blob_storage",
    "dns_gtm",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
    ["batch", 5],
    ["stream", 8],
  ]),
  keyPoolSize: 15,
  connectionBandwidth: 800,
  streamConfig: {
    duration: 20,
    bandwidth: 3,
  },
  zoneTopology: {
    zones: ["na-east", "eu-west", "ap-south"],
    pairLatency: new Map([
      ["ap-south|na-east", 5],
      ["eu-west|na-east", 3],
      ["ap-south|eu-west", 4],
    ]),
  },
  zoneDistribution: new Map([
    ["na-east", 0.40],
    ["eu-west", 0.35],
    ["ap-south", 0.25],
  ]),
  sla: {
    availabilityTarget: 0.90,
    maxAvgLatency: 4,
    minBudget: 0,
    penaltyPerTick: 8,
  },
};
```

**Tuning rationale:**
- **intensity 800/tick:** 60% jump from Wave 8's 500. Teaches that global scale requires horizontal capacity.
- **maxAvgLatency 4:** Tight latency target. With single-zone NA, EU requests add +3/tick and AP requests add +5/tick to every connection hop. Average latency across all traffic ≈ base(1) + zone_penalty(0.4×0 + 0.35×3 + 0.25×5) = 1 + 2.3 = 3.3 for first hop alone, exceeding 4 with multiple hops. This forces multi-zone deployment.
- **startingBudget $2500:** Player needs to replicate servers/databases across 3 zones ($300-500 per zone) plus DNS/GTM ($300). Previous topology costs ~$1500+.
- **pairLatency values in ticks (not ms):** The engine treats latency as abstract tick-units. NA↔EU = 3 ticks, NA↔AP = 5 ticks, EU↔AP = 4 ticks. These are the `zonePairKey`-ordered keys per the `zonePairKey()` canonical ordering.
- **connectionBandwidth 800:** High intensity needs headroom.

## 6. Slice C — Integration tests

### 6a. wave-9-single-zone-loses.test.ts

**Topology:** All infrastructure in `na-east`. DNS/GTM not used. Standard Wave 8 topology with zone="na-east" on all components.

**What happens:** EU requests (35%) add +3 ticks latency per connection hop. AP requests (25%) add +5 ticks. With a 6-hop topology (Client→CDN→Gateway→Cache→...→Server→DB), EU requests accumulate 6×3 = 18 ticks latency. Average latency explodes past the SLA max of 4.

**Assertions:**
1. `result.outcome.verdict === "lose"`
2. Latency SLA fails: `result.outcome.slaResults?.latency.passed === false`

### 6b. wave-9-multi-zone-dns-wins.test.ts

**Rescue topology:**
```
DNS/GTM → [NA zone: CDN → Cache → StreamServer → Queue → Worker → LB → Server×2 → DB]
        → [EU zone: CDN → Cache → StreamServer → Queue → Worker → LB → Server×2 → DB]
        → [AP zone: CDN → Cache → Server×2 → DB]
```

DNS/GTM at entry point routes requests to the nearest zone via GeoRoutingCapability. Each zone has its own infrastructure stack. NA and EU get full stacks (streaming + batch). AP gets a lighter stack (basic servers only — budget constraint).

**Assertions:**
1. `result.outcome.verdict === "win"`
2. `result.outcome.slaResults?.latency.passed === true`
3. `result.outcome.slaResults?.availability.passed === true`
4. DNS/GTM diagnostic: forwarded count > 0 (proves it routed traffic)

**Tuning considerations:**
- **AP zone may be undersized.** 25% of 800 = 200 req/tick to AP with fewer servers. Budget may not support full AP stack. Accept lower AP throughput — overall availability stays above 90% if NA and EU handle their shares.
- **DNS/GTM needs enough egress connections.** One per zone = 3 egress. The TD entry should have egress capacity ≥ 3.
- **GeoRoutingCapability needs `context.state` access.** Verify ProcessContext includes state reference for zone lookups.

## 7. Risk register

| #  | Risk                                                                              | Mitigation                                                                                         |
|----|-----------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| R1 | Zone latency values may make single-zone completely unplayable (too harsh)        | Start with 3/5/4 ticks; tune down if loss test fails too hard (no diagnostic value)                |
| R2 | GeoRoutingCapability may not receive state in ProcessContext                      | Source-dive confirmed: `context.state` is available in selectConnection                             |
| R3 | DNS/GTM TD entry needs high egress capacity for 3 zones                          | Set egress capacity to 4 (room for 3 zones + spare)                                                |
| R4 | 3-zone full topology is expensive ($2500 may not cover it)                       | AP zone gets lighter stack; budget tuning in test                                                   |
| R5 | `buildServer(compRegistry, "na-east")` changes function signature                | Optional param with null default — all existing callers unaffected                                  |
| R6 | Zone schedule in TDTrafficSource may not distribute evenly                       | Use weighted random per request (not per-tick schedule) for smooth distribution                     |
| R7 | Condition multiplier now applies before zone penalty — latency math differs       | Intentional: zone penalty is fixed physics, not affected by component health                        |

## 8. Out of scope (deferred)

- Dashboard zone visualization (zone regions on renderer)
- Cross-zone replication mechanics (CAP theorem teaching)
- Connection latency display in dashboard
- Adaptive zone routing based on load
- Zone-aware chaos events (`zone_outage` targets entire zones)

## 9. Update checklist (post-merge)

1. `docs/claude/implementation-status.md` — stage line, test count, Stage 4b paragraph
2. `docs/claude/td-stage-gotchas.md` — Stage 4b section (zone latency, DNS/GTM, builder zone params)
3. `CLAUDE.md` — current stage line + test count
4. `docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md` — mark Wave 9 as shipped

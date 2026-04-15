# Stage 4c — Wave 10: The Viral Moment (AutoScale Boss Wave)

**Status:** Design approved 2026-04-14. Simulation layer only — dashboard deferred.

## 1. Goal

Wave 10 is the **boss wave** — a 3000/tick stress test across all 3 zones with simultaneous chaos events. The player learns **elastic architecture**: auto-scaling Servers alone isn't enough — the Database becomes the bottleneck. Both compute and storage layers must be elastic. Teaching arc:

1. Without AutoScale → overwhelmed at 3000/tick → lose
2. AutoScale on Servers only → Servers scale out, Database chokes → still lose
3. AutoScale on Servers + Database → whole pipeline scales elastically → win despite chaos

## 2. Architectural context (source-dive findings)

### Infrastructure — mostly production-ready

1. **`Component.instanceCount` is real and mutable.** Field at line 43 of component.ts. Constructor defaults to 1, supports `minInstances` and `maxInstances`. `state.setInstanceCount()` mutates it.

2. **Throughput scales linearly with instanceCount.** `component.getThroughputPerTick()` (line 116): `sum * this.instanceCount`. `componentThroughputPerTick()` in throughput.ts (line 15): `total * c.instanceCount`. Upkeep also scales: `sum * this.instanceCount` (line 129).

3. **SCALE side effects are fully handled.** `deliver-staged.ts` (lines 30-50) clamps `targetInstanceCount` to `[minInstances, maxInstances]`, calls `state.setInstanceCount()`, emits `SCALED` event with `{ from, to }` metadata. 4 unit tests cover basic scale, clamp up, clamp down, no-op.

4. **MonitoringCapability tracks per-tick stats.** `processedThisTick`, `droppedThisTick`, `latencyAdded`. These reset via `resetPerTickState()`. AutoScale can read `processedThisTick` from the same component's MonitoringCapability.

5. **All 4 chaos types are handled by the engine.** `inject-chaos.ts` handles `component_failure` (condition→0), `zone_outage` (all zone components condition→0), `connection_sever` (bandwidth→0 via `getEffectiveBandwidth`), `latency_injection` (extra latency via `getEffectiveLatency`).

### Gap: AutoScaleCapability is a stub

6. **AutoScaleCapability has skeleton but no decision logic.** `auto-scale-capability.ts` (57 lines) has OBSERVE phase, cooldown logic (tier 1: 5 ticks, tier 2: 2 ticks), reads `component.instanceCount`, defines `SCALE_UP_THRESHOLD = 0.8` and `SCALE_DOWN_THRESHOLD = 0.3` constants — but **never emits SCALE side effects**. The `sideEffects` array is always empty.

### Gap: chaosSchedule type only supports 2 of 4 kinds

7. **`TDWaveDefinition.chaosSchedule`** (td-waves.ts lines 35-42) restricts `chaosKind` to `"component_failure" | "zone_outage"`. Wave 10 needs `"connection_sever"` and `"latency_injection"` too. The engine handles all 4; just the TD type and controller mapping are limited.

8. **`getScheduledChaos()`** (td-mode-controller.ts lines 576-601) only maps `component_failure` and `zone_outage` to `ChaosEvent` objects. Needs extension for `connection_sever` and `latency_injection`.

## 3. Scope: what changes

| Change                                                        | Slice  |
|---------------------------------------------------------------|--------|
| AutoScaleCapability: implement utilization-based scaling logic | A      |
| Unit test: AutoScale emits SCALE side effects                 | A      |
| Extend chaosSchedule type for all 4 chaos kinds               | B      |
| Extend getScheduledChaos mapping for connection_sever + latency_injection | B |
| Add auto-scale to Server + Database TD entries                | B      |
| Wire auto-scale factory in registerTDDefaults                 | B      |
| WAVE_10 definition + unit test                                | B      |
| wave-10-no-autoscale-loses.test.ts                            | C      |
| wave-10-server-only-autoscale-loses.test.ts                   | C      |
| wave-10-full-autoscale-wins.test.ts                           | C      |
| Handoff docs + roadmap                                        | D      |

## 4. Slice A — AutoScaleCapability implementation

### 4a. Implement utilization-based scaling logic

Replace the stub body of `process()` in `src/capabilities/auto-scale/auto-scale-capability.ts`. The algorithm:

1. **Read utilization.** Get the component's MonitoringCapability stats (`processedThisTick`) and throughput capacity (`componentThroughputPerTick`). Utilization = processed / capacity.
2. **Scale-up:** If utilization > 0.8 for 2+ consecutive ticks, emit `{ kind: "SCALE", targetInstanceCount: current + 1 }`.
3. **Scale-down:** If utilization < 0.3 for 5+ consecutive ticks, emit `{ kind: "SCALE", targetInstanceCount: current - 1 }`.
4. **Cooldown:** After emitting SCALE, set `lastScaleTick = currentTick`. Don't emit again until cooldown expires (tier 1: 5 ticks, tier 2: 2 ticks).
5. **Clamping:** Not needed here — `deliver-staged.ts` already clamps to [minInstances, maxInstances].

**Implementation detail:** AutoScale is in the OBSERVE phase and runs for every request that reaches the component. But scaling decisions should be made once per tick, not once per request. Track `lastDecisionTick` to ensure the utilization check runs only on the first request each tick.

**How to read utilization:** The capability receives `context.state` and `context.componentId`. It can:
- Read `state.perComponentThisTick.get(componentId)?.processed` for processed count
- Call `componentThroughputPerTick(component)` for capacity
- Or use the simpler approach: read MonitoringCapability from the same component's capabilities map via `component.capabilities.get("monitoring")` and call `.getStats().processedThisTick`

The simplest approach: use `state.perComponentThisTick` counters directly. These are the engine's authoritative processed/dropped counts, already computed.

**State tracking fields to add:**
- `private highUtilTicks = 0` — consecutive ticks above threshold
- `private lowUtilTicks = 0` — consecutive ticks below threshold
- `private lastDecisionTick = -1` — prevent multi-decision per tick

### 4b. Unit tests for AutoScale

New test file `tests/unit/auto-scale-capability.test.ts` (or extend existing). Tests:
- High utilization for 2 ticks → emits SCALE(current + 1)
- Low utilization for 5 ticks → emits SCALE(current - 1)
- Within cooldown → no SCALE emitted
- Moderate utilization (30-80%) → no SCALE emitted
- Scale-up resets lowUtilTicks counter (and vice versa)

## 5. Slice B — TD content: chaos extension, entries, WAVE_10

### 5a. Extend chaosSchedule type

In `src/modes/td/td-waves.ts`, replace line 37:
```ts
readonly chaosKind: "component_failure" | "zone_outage";
```
With:
```ts
readonly chaosKind: "component_failure" | "zone_outage" | "connection_sever" | "latency_injection";
```

Add optional fields for connection-based chaos:
```ts
readonly connectionId?: string;
readonly extraLatency?: number;
```

### 5b. Extend getScheduledChaos mapping

In `src/modes/td/td-mode-controller.ts`, extend the `getScheduledChaos()` method to handle `connection_sever` and `latency_injection`:

```ts
if (entry.chaosKind === "connection_sever") {
  return {
    kind: "connection_sever",
    connectionId: entry.connectionId! as ConnectionId,
    durationTicks: entry.durationTicks ?? 3,
  };
}
if (entry.chaosKind === "latency_injection") {
  return {
    kind: "latency_injection",
    connectionId: entry.connectionId! as ConnectionId,
    extraLatency: entry.extraLatency ?? 10,
    durationTicks: entry.durationTicks ?? 5,
  };
}
```

### 5c. Add auto-scale to Server + Database TD entries

In `src/modes/td/td-component-entries.ts`, add to SERVER_ENTRY's capabilities array:
```ts
{ id: "auto-scale" as CapabilityId, defaultTier: 0, maxTier: 2 },
```

Same for DATABASE_ENTRY. Default tier 0 = disabled. Player must "enable" auto-scale by having the entry available. In the TD mode, the entry defines tier 0 as the default; the integration tests can construct components with tier set appropriately.

**Alternative:** Use `defaultTier: 1` so auto-scale is active when the component is placed. This is simpler for testing — the player places a Server, auto-scale is on. The teaching is whether to place AutoScale-enabled components at all.

**Decision:** `defaultTier: 1, maxTier: 2` for both. Auto-scale is active by default when placed.

### 5d. Wire auto-scale factory in registerTDDefaults

```ts
import { AutoScaleCapability } from "@capabilities/auto-scale/auto-scale-capability.js";

capRegistry.register({
  id: "auto-scale" as CapabilityId,
  factory: () => new AutoScaleCapability("auto-scale" as CapabilityId),
});
```

### 5e. WAVE_10 definition

```ts
export const WAVE_10: TDWaveDefinition = {
  id: 10,
  name: "The Viral Moment",
  startingBudget: 5000,
  intensity: 3000,
  composition: new Map([
    ["api_read", 0.25],
    ["api_write", 0.05],
    ["static_asset", 0.10],
    ["auth_required", 0.10],
    ["batch", 0.15],
    ["stream", 0.35],
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
  connectionBandwidth: 3000,
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
  chaosSchedule: [
    { tick: 10, chaosKind: "component_failure", targetType: "server", targetIndex: 0 },
    { tick: 20, chaosKind: "component_failure", targetType: "server", targetIndex: 1 },
    { tick: 25, chaosKind: "zone_outage", zone: "ap-south", durationTicks: 5 },
  ],
  sla: {
    availabilityTarget: 0.85,
    maxAvgLatency: 5,
    minBudget: -500,
    penaltyPerTick: 10,
  },
};
```

**Tuning rationale:**
- **intensity 3000/tick:** 3.75× Wave 9. The viral spike.
- **stream 35%:** 1050 stream req/tick. Massive bandwidth pressure.
- **SLA 85% availability:** Most relaxed of all waves — chaos + extreme load means perfection is impossible. The teaching is survival, not perfection.
- **minBudget -500:** Can run deeply in red. Upkeep with auto-scaled instances is expensive.
- **startingBudget $5000:** Player needs massive multi-zone infrastructure with auto-scale enabled.
- **connectionBandwidth 3000:** Must handle the intensity.
- **Chaos:** Latency injection at tick 10, server failure at tick 20, zone outage at tick 25. Spaced to create escalating pressure.

## 6. Slice C — Integration tests

### 6a. wave-10-no-autoscale-loses.test.ts

**Topology:** Wave 9 multi-zone DNS rescue topology (static servers, no auto-scale). At 3000/tick, the static topology is overwhelmed.

**Assertions:** verdict = "lose"

### 6b. wave-10-server-only-autoscale-loses.test.ts

**Topology:** Same as above but Servers have auto-scale enabled (maxInstances: 10). Servers scale out, but Database stays at instanceCount 1 with 50/tick throughput. As Servers grow to handle 3000/tick, Database becomes the bottleneck — writes back up, availability drops.

**Assertions:** verdict = "lose"

### 6c. wave-10-full-autoscale-wins.test.ts

**Topology:** Both Servers (maxInstances: 10) and Databases (maxInstances: 5) have auto-scale. The whole pipeline scales elastically. Chaos events fire but auto-scale recovers.

**Assertions:**
1. verdict = "win"
2. availability ≥ 85%
3. At least one Server scaled (instanceCount > initial) — proves auto-scale worked
4. At least one Database scaled — proves pipeline-wide elasticity

## 7. Risk register

| #  | Risk                                                                              | Mitigation                                                                                         |
|----|-----------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| R1 | AutoScale utilization measurement from state.perComponentThisTick may not exist for OBSERVE-phase caps | Verify the counter is populated before OBSERVE runs; if not, read MonitoringCapability stats instead |
| R2 | Auto-scale cooldown (5 ticks at tier 1) too slow — need 10+ scale events to reach target | Tier 2 cooldown (2 ticks) scales faster; or emit SCALE with larger jumps (current + 2) |
| R3 | 3000/tick with 3 zones = 1000/zone; forwarding-pipe 500/tick is a bottleneck | Forwarding-pipe scales with instanceCount? No — it's per-component, not per-instance. May need higher throughputPerTier or multiple intermediaries |
| R4 | Database auto-scale teaching: Database at 50/tick × 5 instances = 250/tick. Sufficient? | 3000/tick with 5% writes = 150 write/tick. 250 >> 150. Should be fine. |
| R5 | Chaos connectionId in wave definition is test-topology-specific | Use symbolic targeting like component_failure, or hardcode connection IDs in test |
| R6 | Server-only-autoscale loss test may accidentally win if static DB throughput is sufficient | Tune write % or DB throughput to ensure the bottleneck is real |

## 8. Out of scope (deferred)

- Dashboard auto-scale visualization (instance count animation, scaling events)
- Tier upgrades (scaling UP)
- Cross-zone replication mechanics
- All dashboard/renderer work
- Health-check capability integration

## 9. Update checklist (post-merge)

1. `docs/claude/implementation-status.md` — stage line, test count, Stage 4c paragraph
2. `docs/claude/td-stage-gotchas.md` — Stage 4c section
3. `CLAUDE.md` — current stage line + test count
4. `docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md` — mark Wave 10 as shipped, mark dynamic instanceCount as verified

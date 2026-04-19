# SLA & Revenue Accounting Fix — Design

**Date:** 2026-04-19
**Branch:** `fix/sla-and-revenue-accounting`
**Status:** Approved for implementation

## Problem

Two bugs surface together in the wave-4 end-of-wave modal: SLA 208.2%, earnings well above the briefing's promised payout.

**Bug A — SLA denominator mismatch.** `metrics.totalPackets` counts fresh top-level packets (one per client spawn). `metrics.responded` increments on every `respond-delivered` event. `CachingCapability` legitimately splits one packet into hits (respond locally) + misses (forward to DB, which responds separately) — two response events for one packet. The caching unit test at [tests/unit/sim/caching-capability.test.ts:81-101](../../../tests/unit/sim/caching-capability.test.ts:81) validates this split behavior as intended. Units mismatch → availability reads > 100% whenever the cache is on the path.

**Bug B — Wave revenue config is cosmetic; real revenue is hardcoded per component.** `describeWaveReward` in [src/physics-td/waves.ts:44](../../../src/physics-td/waves.ts:44) reads `wave.revenue` to build the briefing string ("$1/read · $2/auth"). The sim ignores `wave.revenue` entirely — revenue is hardcoded in `buildSimComponent` ([component-factory.ts:52-88](../../../src/physics-td/component-factory.ts:52)) where Database pays `$2/read`, Cache pays `$2/read`, CDN pays `$1/read`, Gateway pays `$4/auth`. The player sees a lie.

## Solution

### Bug A — SLA operates on requests, not packets

Rename `WaveMetrics.totalPackets → totalRequests`. Count requests everywhere events are emitted.

- **Spawn:** at [physics-td.ts:364](../../../src/physics-td/physics-td.ts:364), `totalRequests += packet.requests.length` for fresh top-level packets.
- **Event shape:** add `count: number` to `respond-delivered` and `terminate` event variants in [src/sim/types.ts:73](../../../src/sim/types.ts:73). (Drop events already carry `count`.)
- **Event emission:** all four `respond-delivered` emission sites in [src/sim/sim.ts](../../../src/sim/sim.ts) (lines 145, 175, 188, 250) set `count` from the local request-count context. `terminate` sites ([processing.ts:28](../../../src/sim/capabilities/processing.ts:28)) set `count`.
- **Event consumption:** [physics-td.ts:381-394](../../../src/physics-td/physics-td.ts:381) `metrics.responded += ev.count`, `metrics.terminated += ev.count`.
- **Merge/split tracking:** [sim.ts:140-164](../../../src/sim/sim.ts:140) `MergeState` already tracks `accumulatedRevenue`; add `accumulatedCount` parallel. Merged response event uses the accumulated count.

Availability formula unchanged: `(responded + terminated) / totalRequests`. Both sides now in the same unit.

**Invariant after fix:** for any topology that never drops, `responded + terminated === totalRequests`. New test asserts this.

### Bug B — Wave revenue is the single source of truth

Thread wave revenue into `buildSimComponent`. Delete the hardcoded per-component revenue constants.

- **Type change:** `WaveRevenue` in [src/sim/wave.ts](../../../src/sim/wave.ts) gains `perAsync: number`. Existing wave configs in [waves.ts:72,89,106,123,140](../../../src/physics-td/waves.ts:72) all get `perAsync: 1` appended (arbitrary but sane default; no wave currently uses `asyncRatio > 0`, so untested path).
- **Factory signature:** `buildSimComponent(type: string, id: ComponentId, revenue: WaveRevenue): SimComponent | null`.
- **Factory body:** each case constructs its capability with revenue fields pulled from `revenue`:
  - Database: `{ revenuePerRead: revenue.perRead, revenuePerWrite: revenue.perWrite }`
  - Data Cache, CDN: `{ revenuePerRead: revenue.perRead, largeOnly: ... }`
  - Gateway: `{ revenuePerAuth: revenue.perAuth }`
  - Worker: `{ revenuePerItem: revenue.perAsync, pullRate: ... }`
  - Streaming Server: `{ revenuePerStream: revenue.perStream }`
- **Caller:** [placement-ux.ts:85](../../../src/physics-td/placement-ux.ts:85) calls `buildSimComponent(type, componentId, controller.currentWaveRevenue())`.
- **New getter on controller:** `PhysicsCampaignController.currentWaveRevenue(): WaveRevenue`. Returns `this.opts.waves[this.currentWaveIndex].revenue`. Requires extending `CampaignOptions.waves` items to include `revenue` (currently only `id` + `startBudget`).

**Locked-at-placement:** a component placed in wave N keeps wave-N revenue even if it survives into wave N+1. Current waves all use `perRead: 1`, so no behavioral difference today. Matches the "infrastructure is a durable investment" feel.

### Wave 5 auth reward

[waves.ts:140](../../../src/physics-td/waves.ts:140) is authoritative: `perAuth: 2`. After the fix, Gateway pays $2/auth (not the hardcoded $4). Briefing already displays $2 — players will get what they're promised.

## Change Scope

### Sources
- `src/sim/types.ts` — add `count` to `respond-delivered` and `terminate` event variants.
- `src/sim/wave.ts` — add `perAsync: number` to `WaveRevenue`.
- `src/sim/sla.ts` — rename `totalPackets → totalRequests` in `WaveMetrics`.
- `src/sim/sim.ts` — 4 `respond-delivered` emission sites set `count`; `MergeState` gains `accumulatedCount`.
- `src/sim/capabilities/processing.ts` — terminate outcome includes `count`.
- `src/sim/test-harness.ts` — rename metric; increment by request count.
- `src/physics-td/component-factory.ts` — `buildSimComponent` takes `revenue`; delete hardcoded literals.
- `src/physics-td/campaign-controller.ts` — add `currentWaveRevenue()`; extend `CampaignOptions` wave items with `revenue`.
- `src/physics-td/physics-td.ts` — pass `revenue` to campaign waves; rename `totalPackets → totalRequests`; update event-handling to use `count`.
- `src/physics-td/placement-ux.ts` — pass `controller.currentWaveRevenue()` into `buildSimComponent`.
- `src/physics-td/wave-penalty.ts` — rename metric field.
- `src/physics-td/waves.ts` — add `perAsync: 1` to every wave's `revenue`.

### Tests
- `tests/unit/sim/sla.test.ts` (if exists) — field rename.
- `tests/unit/game/physics-td/wave-penalty.test.ts` — field rename.
- `tests/unit/sim/wave1-end-to-end.test.ts` — field rename.
- `tests/unit/sim/test-harness.test.ts` — field rename; may need adjustment.
- `tests/integration/sim/waves/*.test.ts` — update revenue construction to come from wave config where tests build components directly.
- `tests/unit/game/physics-td/campaign-controller.test.ts` — test fixture waves need `revenue` field in their options.
- **New:** `tests/unit/game/physics-td/sla-accounting.test.ts` — assert `responded + terminated === totalRequests` after a simulated cache-partial-hit scenario. Also assert revenue-per-request matches wave config.

Unit tests for individual capabilities (`processing-capability.test.ts`, `caching-capability.test.ts`, `gateway-capability.test.ts`, `revenue-crediting.test.ts`) keep their explicit numbers — they construct capabilities directly and test the capability's own math. No changes needed.

## Non-Goals

- Re-tuning the economy (`perRead`, `perWrite`, etc. stay at current wave-config values).
- Wave-4 dollar amounts — after the fix the numbers will naturally change; we observe and re-tune in a later pass if needed.
- Changing the split-response semantics of CachingCapability.
- Adding a `perLarge` or staleness-tier revenue concept.

## Acceptance

- With Client → CDN → Server → Data Cache → DB on wave 4: SLA reports ≤ 100%, earnings match `(served_requests × wave.revenue.perRead) + (served_writes × wave.revenue.perWrite)` within rounding.
- Briefing text for every wave matches realized revenue for every served request on that wave.
- Invariant test: in a clean-pass scenario, `metrics.responded + metrics.terminated === metrics.totalRequests`.
- Full test suite green; typecheck clean (modulo the two pre-existing noise errors called out in CLAUDE.md).

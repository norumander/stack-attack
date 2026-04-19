# Per-Wave Budget Grants — Design

**Date:** 2026-04-18
**Status:** Approved for implementation

## Problem

A player who reaches wave 3 with only a Server ($100) + Database ($200) has roughly **$29** of budget, but the Data Cache — which wave 3's briefing explicitly prescribes for the Zipf hot-key traffic — costs **$150**. The player is stuck watching the DB saturate with no path to correct it.

Root cause: `CampaignWave.startBudget` values are authored per-wave in [src/physics-td/waves.ts](../../../src/physics-td/waves.ts) (300, 400, 250, 350, 350), but the live campaign only uses `waves[0].startBudget` as the initial seed. At wave transitions, [`PhysicsCampaignController.nextWave()`](../../../src/physics-td/campaign-controller.ts) carries budget forward with no grant ("No refill grant" comment). The per-wave `startBudget` fields for waves 2–5 are only read by `jumpToWave()` (dev tool).

Either the authoring drifted from the controller, or per-packet revenue was intended to be much higher than it is. The budgeted values in `waves.ts` are designer-tuned and reasonable — the fix is to honor them.

## Solution

Treat each wave's `startBudget` as an **additive grant** applied on wave transition, stacked on top of the budget carried forward from the prior wave.

### Cumulative budget (server+db only, revenue assumes clean serve)

| Wave | Grant | +Revenue earned in prior wave | Budget at wave start |
|------|-------|-------------------------------|----------------------|
| 1    | +$300 | —                              | $300                 |
| 2    | +$400 | +$8 (8 reads)                 | $408                 |
| 3    | +$250 | +$21 (11 reads + 5 writes)    | $279                 |
| 4    | +$350 | +$24                          | $653                 |
| 5    | +$350 | +$48                          | $1003                |

Wave 3 at $279 affords Data Cache ($150) with $129 left. Later waves afford the prescribed additions with increasing comfort. Numbers stay as-authored; retuning is deferred — ship the mechanic first, tune after playtest.

## Change Scope

### `src/physics-td/campaign-controller.ts`

**`nextWave()` (currently lines 140–152):**
- After `this.currentWaveIndex += 1` and the end-of-campaign guard, add:
  - `this.budget += this.opts.waves[this.currentWaveIndex]!.startBudget;`
  - `this.opts.callbacks.onBudgetChange(this.budget);`
- Update the comment from "Budget carries forward from prior wave end. No refill grant." to reflect the additive grant behavior.

**`jumpToWave()` (lines 159–169):** Unchanged. Dev tool retains replace-semantics (sets budget directly to that wave's `startBudget`).

**Constructor (line 56):** Unchanged. Wave 0's `startBudget` remains the initial seed.

### Data

`src/physics-td/waves.ts` — no changes. The existing `startBudget` values (300, 400, 250, 350, 350) now function as the designer intended.

## Tests

### `tests/unit/game/physics-td/campaign-controller.test.ts`

**Rewrite (line 77 area):** The existing test asserts "Budget should carry forward, NOT reset to wave-2's startBudget (700)." That intent changes. Update it to: budget at start of wave 2 = (budget at end of wave 1) + waves[1].startBudget. Adjust the fixture expectations.

**Add:** A test that walks through 3 fixture waves with a known wave-end budget, asserts cumulative budget = wave[0].startBudget + revenues + wave[1].startBudget + wave[2].startBudget.

**Add:** A test that asserts `onBudgetChange` fires on wave transition with the new total.

### `tests/unit/game/physics-td/waves.test.ts`

Check line 21 (`expect(w1!.startBudget).toBeGreaterThanOrEqual(300)`) and surrounding assertions — keep if still valid, adjust if they assume the old semantics.

## Edge Cases

- **Negative budget carrying into a wave:** SLA penalty can push budget below zero ([campaign-controller.ts:136](../../../src/physics-td/campaign-controller.ts:136)). The grant adds on top, which is the intended forgiveness curve. No special handling.
- **End of campaign:** `nextWave()` already returns early when past the final wave. Grant logic runs only when entering a valid wave.

## Non-Goals

- Retuning `startBudget` values for waves 4–5 (may feel flush at $1000+).
- Adding an end-of-wave SLA completion bonus.
- Rebalancing per-packet revenue.

These are deferred until the core mechanic is playtested.

## Acceptance

- A player building only Server + Database through wave 2 starts wave 3 with ≥ $150 available and can purchase a Data Cache.
- Existing passing tests either pass unchanged or are updated with clear intent preserving wave-0 semantics.
- Typecheck clean, test suite green.

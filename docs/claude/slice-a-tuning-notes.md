# Slice A tuning notes

Handoff notes from the Wave 1 UX pass Slice A implementation (feature branch `feature/wave1-ux-economy-spec`). Read this before starting Slice B's playtest pass or any viability-tuning follow-up.

## What shipped in Slice A

- `TDViability` class (`src/modes/td/td-viability.ts`) — campaign-wide health pool, starts at 100, damaged by `damage()`, never refilled.
- `TDModeController` gained `getViability()`, `getRentBill(state)`, `payRent(state)`, `getTerminalState(state?)`, and a rewritten `onTick` that applies per-tick viability damage plus a rolling-3-tick ramp penalty.
- `TDEconomy.debitUpkeep` is a no-op; per-tick upkeep no longer drains the budget in TD mode. New `debitRent(amount)` method is the real debit path, called from `payRent`.
- `ComponentRegistryEntry` gained an additive optional `rentPerWave?: number` field. TD entries set it; sandbox entries leave it undefined. `placementCost` is 0 on every TD entry (placement is now free).
- All 10 wave definitions gained required `viabilityPerFailure` and `viabilityRampPenalty` fields and optional `startingBudget`. Wave 1's starting budget is $600 (was $500). `dropThreshold` values were retuned per Slice A's table.
- `runWave` helper (`tests/integration/td/helpers.ts`) exposes `terminalState`, `finalViability`, `finalBudget` on the result. A large `100_000` starting budget bypass prevents tests from hitting rent-insufficient errors — integration tests validate request routing, not budget arithmetic.
- Wave integration test assertions were migrated to `terminalState === "wave_passed"` on winning paths. Losing paths kept their existing `outcome.verdict === "lose"` assertions with a `TODO(T16)` marker — see below for why.

## Critical gotcha — `runWave` does NOT call `mode.onTick`

The engine (`engine.tick(mode)`) does not invoke `ModeController.onTick` internally. Only the dashboard's `SimLoop` calls `mode.onTick` per tick. The `runWave` test helper deliberately does NOT add this call either — the comment at the top of `runWave` explains why.

**Consequence:** viability damage (the new `onTick` path) is NOT exercised by wave integration tests. `finalViability` stays at 100 for every wave test — even on "losing" topologies. The damage math is validated by unit tests in `tests/unit/td-mode-controller-viability-and-rent.test.ts`, not by the `tests/integration/td/wave-*.test.ts` suite.

This is acceptable because:
- Integration tests validate request-routing and SLA-verdict contracts (what drops, what forwards, what gets served).
- Unit tests validate the viability damage math directly with synthetic metric histories.
- Slice B's `tdOnTick` dashboard callback calls `controller.onTick(state)` at the start of each tick callback, so the player feels the damage during real play. Integration tests via `runWave` still bypass this path — see the paragraph above.

**If a future task wants integration tests to exercise onTick damage**, they should either:
1. Add `mode.onTick(state)` to the `runWave` tick loop AND retune `viabilityPerFailure` values downward (current values are too aggressive for high-volume waves — see below).
2. Or make the engine call `mc.onTick?.(state)` internally, making viability damage fire for all callers. This is an engine change (not a test-helper change) and should be scoped carefully.

## Known-untuned items

### 9 wave-integration "lose" tests with `TODO(T16)` markers

Each losing-path test in `tests/integration/td/wave-*.test.ts` (wave-3-traffic-spike, wave-4-server-only-loses, wave-5-server-only-loses, wave-6-server-only-loses, wave-7-no-breaker-loses, wave-8-no-streaming-server-loses, wave-9-single-zone-loses, wave-10-no-autoscale-loses, wave-10-server-autoscale-loses) keeps its old `outcome.verdict === "lose"` assertion with a commented-out `finalViability < 100` below it. The commented assertion is the target state once viability damage is wired into integration tests AND the per-wave tuning is correct.

### Wave 7, 8, 10 viability overshoot

During a brief experiment where `mode.onTick` was wired into `runWave`, three winning waves flipped to failing because their viability dropped below 0 during the wave even when SLA passed. The numbers:

- **Wave 7 (breaker rescue wins)** — `viabilityPerFailure: 0.25`, chaos-induced drops drain viability to 0 before drain.
- **Wave 8 (streaming rescue wins)** — `viabilityPerFailure: 0.28`, 306 drops + 101 timeouts × 0.28 ≈ 114 damage.
- **Wave 10 (full autoscale wins)** — `viabilityPerFailure: 0.40`, ~5,239 drops × 0.40 ≈ 2,095 damage (catastrophic).

**Root cause:** linear scaling of `viabilityPerFailure` from 0.10 (Wave 1) to 0.40 (Wave 10) does not account for the exponential growth in request volume across waves. Wave 1 generates ~300 requests; Wave 10 generates ~120,000. A viable retune must scale `viabilityPerFailure` INVERSELY with wave intensity, or reformulate the damage to depend on failure RATE (not raw count).

**Suggested starting point for a future retuning pass** (not implemented in Slice A):

| Wave | Current vPF | Suggested vPF |
|------|-------------|---------------|
| 1    | 0.100       | 0.100         |
| 2    | 0.120       | 0.040         |
| 3    | 0.150       | 0.025         |
| 4    | 0.180       | 0.015         |
| 5    | 0.200       | 0.009         |
| 6    | 0.220       | 0.005         |
| 7    | 0.250       | 0.005         |
| 8    | 0.280       | 0.003         |
| 9    | 0.300       | 0.002         |
| 10   | 0.400       | 0.0005        |

These values target "up to ~50 viability damage at 100% failure rate on each wave" so the pool survives a bad but not catastrophic wave. Playtest will almost certainly refine them.

**Alternative design to consider:** damage the pool by `max(0, dropRate - SLA_TARGET) × SCALE` per tick instead of per-failure × constant. This decouples damage from raw volume and keys off the SLA-exceedance delta, which is what "opportunity window closing" should actually feel like narratively.

### `evaluateSLA` and `evaluateOutcome` are still alive but de-gated

`TDModeController.evaluateSLA` and `evaluateOutcome` are still defined and callable. They are no longer used as the TD wave outcome gate — `getTerminalState(state)` is the new gate. `evaluateOutcome` is still called by `runWave` for backward compatibility with existing `outcome.verdict` assertions on losing-path tests (the TODO(T16) files above). When those tests migrate, `evaluateOutcome` can either be deleted or kept for display-only purposes.

## Tests that were retired in Slice A

- `tests/unit/td-economy.test.ts` — the "debits upkeep, allowing negative budget" test block (obsolete under `debitUpkeep` no-op).
- `tests/unit/td-sla-gate.test.ts` — the entire `describe("SLA gate — onTick penalty", ...)` block (3 tests, all obsolete).
- `tests/unit/td-sla-scheduled-denominator.test.ts` — the "onTick penalty fires when rolling availability is vacuous" test (obsolete).
- `tests/unit/td-mode-controller-place.test.ts` — the "rejects with insufficient_budget when balance is too low" test was removed entirely; the "places a server, debits the economy" test was rewritten to assert placement is free under the rent model.

All replacement coverage lives in `tests/unit/td-mode-controller-viability-and-rent.test.ts`.

## Slice B handoff

Slice B (UX pass) can be written from `docs/superpowers/specs/2026-04-15-wave1-ux-and-economy-design.md` §5 against merged Slice A APIs. The key dependencies:

- `TDModeController.getViability()` — for the viability HUD meter
- `TDModeController.getRentBill(state)` — for the live "Next wave bill: $X" counter
- `TDModeController.payRent(state)` — for the READY handler's atomic rent preflight
- `TDModeController.getTerminalState(state?)` — for the loss/win modal triggers
- `ComponentRegistry.get(type).rentPerWave` — for dossier "RENT $80 / wave" rows

Slice B's plan should also include the Slice C VFX/SFX roadmap items, none of which are implemented.

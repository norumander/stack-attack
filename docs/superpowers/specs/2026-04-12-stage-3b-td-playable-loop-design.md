# Stage 3b — TD Mode Playable Loop (Design)

**Status:** Draft
**Author:** Normid + Claude
**Date:** 2026-04-12
**Predecessor:** [Stage 3a — Wave 1–3 Playable Slice](./2026-04-12-stage-3a-wave-1-3-playable-slice-design.md)

## 1. Purpose

Make TD mode actually playable end-to-end. Today, the four Wave 1–3 integration tests prove the engine can resolve a 3-wave learning arc, but the ModeController's `tryPlace` is a stub and the only way to "play" is to write a TypeScript test. Stage 3b closes the gap from headless test fixture to interactive build → watch → assess → repeat loop running in the existing dashboard.

The minimum-viable interactive experience: a human opens `pnpm dev`, toggles to TD mode, sees an empty topology with a $200 starting budget and a Wave 1 indicator, clicks a Server from a palette, clicks the entry point to draw a connection, clicks READY, watches Wave 1 resolve in the existing throughput/latency charts, sees the wave-pass toast, and is returned to the build phase with the next wave's `buildBudget` credited. They do this four times and either win or lose the campaign.

This is the first stage where a non-engineer can hold the controller, and the first stage that exercises the "game-first" principle outside of test code.

## 2. Goals

- **G1.** `TDModeController.tryPlace` mutates state for real — adds component, creates declared connections, debits economy, validates ports and budget.
- **G2.** `TDModeController` has an explicit Build/Run phase machine. The dashboard sim loop drives transitions; the engine never runs during the build phase.
- **G3.** A four-wave campaign is playable end-to-end via the dashboard, and the same campaign is reproducible headlessly in a test that scripts placements and asserts wins.
- **G4.** A new Wave 4 introduces `auth_required` traffic and forces the player to place an API Gateway with `AuthCapability` at the edge. The lone-server topology that won Wave 3 fails Wave 4.
- **G5.** No regressions in sandbox mode, existing TD tests, or the merged capability library.

## 3. Non-goals

- **Pixi.js / canvas rendering.** The existing DOM-based topology view in `src/dashboard/main.ts` is the rendering surface. Pixi waits.
- **Drag-to-place / drag-to-connect.** Click-to-place and click-to-connect-by-selecting-endpoints is the entire interaction model.
- **Mid-wave intervention.** Placement is gated behind the build phase. The player cannot pause a running wave to add components.
- **Intra-wave satisfaction bar / lives.** Wave-end `evaluateOutcome` remains the only loss condition, same as Stage 3a. Stage 3c will revisit.
- **Component upgrades.** Tier-1 placement only. Upgrades are a separate stage.
- **Save / load campaign state.** A reload starts a fresh campaign at Wave 1 with the starting budget. No persistence.
- **TD-mode chaos panel.** Sandbox keeps its chaos panel; TD doesn't expose chaos in Stage 3b. Chaos integration with TD waves is a later stage.
- **Two new waves.** RateLimit and CircuitBreaker waves are deferred to Stage 3c. Stage 3b adds **one** new wave.

## 4. Scope summary

| Area | In | Out |
|---|---|---|
| `tryPlace` | Real impl, validation, budget debit | Engine-meaningful position semantics, drag-to-place |
| Phase machine | Build / Run states, transitions, exposed via getters | Pause / fast-forward, branching states |
| Economy | `tryDebit` atomic check | Refunds, sales, partial credits |
| New wave | Wave 4 (Auth) | Wave 5+ |
| New component | `buildApiGateway` registry entry | New capabilities (Auth already exists) |
| Dashboard | TD mode toggle, palette, READY button, wave HUD | New visual style, separate TD app, animations |
| Tests | Headless campaign, `tryPlace` paths, Wave 4 outcome | Manual playtest automation |

## 5. Architecture

### 5.1 `TDModeController` changes

**Current state:** `tryPlace` is a stub that increments a counter and returns a fake id without touching `state.components`. There is no phase concept; a wave is "running" iff `TDTrafficSource` has not yet exhausted its definition.

**New state:**

```ts
type TDPhase = "build" | "run";

class TDModeController implements ModeController {
  private phase: TDPhase = "build";
  private currentWaveIndex = 0;
  private trafficSource: TDTrafficSource | null = null;

  // Existing fields: economy, registry, waves, dropThreshold, ...

  getPhase(): TDPhase;
  getCurrentWaveIndex(): number;
  getCurrentWave(): WaveDefinition;       // throws if past last wave
  isCampaignComplete(): boolean;          // currentWaveIndex >= waves.length

  startWave(): void;                      // build → run, instantiates TDTrafficSource
  endWave(): WaveResult;                  // run → build, evaluates, advances index, credits revenue

  tryPlace(
    type: ComponentTypeId,
    position: Position,
    connectsTo: ReadonlyArray<ComponentId>,
  ): TryPlaceResult;
}

type TryPlaceResult =
  | { ok: true; componentId: ComponentId; connectionIds: ConnectionId[] }
  | { ok: false; reason: TryPlaceFailureReason };

type TryPlaceFailureReason =
  | "wrong_phase"           // can only place during build
  | "unknown_type"          // type not in registry
  | "insufficient_funds"    // economy.tryDebit failed
  | "incompatible_ports"    // source has no out-port or target has no in-port
  | "unknown_target";       // a connectsTo id doesn't exist in state.components
```

**`Position` is a UI hint, not engine-meaningful in 3b.** The engine ignores `position` (no spatial routing, no proximity rules). The dashboard uses it to render the component on the topology grid; tests can pass `{x: 0, y: 0}` for every placement without consequence. Future stages may make position meaningful (e.g. for visual layout persistence or zone affinity), but Stage 3b treats it as opaque metadata.

**`tryPlace` flow:**

1. Reject if `phase !== "build"`.
2. Look up registry entry by `type`. Reject `unknown_type` if missing.
3. Compute placement cost: `entry.placementCost` (a new field on registry entries, see §5.4). Default formula if absent: `entry.getUpkeepCost(1) * 10`.
4. `economy.tryDebit(cost)`. Reject `insufficient_funds` if false.
5. Validate every `connectsTo` id exists in `state.components`. Reject `unknown_target` otherwise.
6. Validate port compatibility: the new component must declare at least one `direction: "in"` port, and each target must declare at least one `direction: "out"` port. Reject `incompatible_ports` otherwise. (Stage 3b uses default port routing — first matching port wins. Multi-port disambiguation is later.)
7. Call `state.placeComponent(type, position)` which returns the new `ComponentId`. This already exists and is what Stage 3a tests use.
8. For each target id, call `state.createConnection(targetOutPortId, newInPortId)`. (Same path used in tests today.)
9. Return `{ok: true, componentId, connectionIds}`.

**Phase transitions:**

- `startWave()`: assert `phase === "build"`, assert `!isCampaignComplete()`, instantiate `new TDTrafficSource(getCurrentWave(), entryPointId)`, set `phase = "run"`. The dashboard sim loop must read `getPhase()` after each tick and call `endWave()` when the traffic source is exhausted **and** all in-flight requests have resolved or timed out.
- `endWave()`: assert `phase === "run"`, run the existing `evaluateOutcome` logic, credit revenue on a pass via `economy.creditRevenue(wave.passReward)`, debit a fixed wave-end debt of 0 (no penalty in 3b), advance `currentWaveIndex`, drop the traffic source, set `phase = "build"`. Returns the `WaveResult`.

**Wave-end detection:** The sim loop is the authority. It calls `tdController.isWaveExhausted()` after each tick, where:

```ts
isWaveExhausted(): boolean {
  if (this.phase !== "run" || !this.trafficSource) return false;
  return this.trafficSource.isExhausted()
    && this.state.pendingRequests.length === 0
    && this.allBufferablesEmpty();
}
```

`allBufferablesEmpty()` walks `state.components` and asks each `EngineBufferable` capability for `peekBuffered().length === 0`.

### 5.2 `TDEconomy` changes

```ts
class TDEconomy {
  // Existing: balance, creditRevenue, debitUpkeep, isInsolvent, ...

  tryDebit(amount: number): { ok: true } | { ok: false; reason: "insufficient_funds" } {
    if (this.balance < amount) return { ok: false, reason: "insufficient_funds" };
    this.balance -= amount;
    this.debitLog.push({ tick: -1, amount, source: "placement" });  // tick=-1 = build phase
    return { ok: true };
  }
}
```

`tryDebit` is atomic — no partial debits. `tick: -1` distinguishes build-phase debits from in-wave upkeep debits in the existing log.

### 5.3 `WaveDefinition` and Wave 4

**New optional field on `WaveDefinition`:**

```ts
interface WaveDefinition {
  // Existing: name, durationTicks, requestMix, dropThreshold, ...
  buildBudget?: number;      // credited on wave PASS, before phase returns to build; default 0
}
```

`TDEconomy` already credits per-request revenue during a wave (existing behavior). `buildBudget` is a separate, deterministic lump sum credited only when the wave passes — it gives the spec direct control over how much budget the player has for the next build phase, independent of how good their per-request economy was. Wave 1 uses an initial campaign budget set on `TDModeController` construction (`initialBudget: 200`).

**Wave 4 — "Authenticated reads":**

- `name: "Wave 4 — Authenticated reads"`
- `durationTicks: 30`
- `requestMix: { api_read: 0.6, auth_required: 0.4 }`
- `dropThreshold: 0.10`
- `buildBudget: 240` (credited on Wave 3 PASS, before phase returns to build for Wave 4 placements)
- TTL on `auth_required`: 8 (same as `api_read`)
- Per-request revenue continues to accrue during the wave via existing `TDEconomy` logic.

**Outcome calibration:**

- A topology that wins Wave 3 (Server + Cache + LB, no Gateway) **must lose Wave 4** because `auth_required` requests have no PROCESS handler (Server's `ProcessingCapability` is constructed with `handledTypes: ["api_read"]`). Those requests fall through PASS at PROCESS phase → silent drop. ~40% of traffic vanishes → drop ratio exceeds threshold → fail.
- A topology with a single `ApiGateway` placed at the entry point, with all entry-bound traffic routed through it, **must win Wave 4**. The Gateway's `AuthCapability` (INTERCEPT) lets `auth_required` PASS through. The Gateway's `ForwardingCapability` (PROCESS, `handledTypes: ["api_read", "auth_required"]`) routes both types to the downstream Server.
- **Calibration mechanism:** an integration test `wave-4-auth.test.ts` runs both topologies headlessly and asserts the lone-server (or Wave-3-winner) topology fails and the with-Gateway topology passes. Tune Gateway throughput and Wave 4 intensity until both hold.

### 5.4 `ApiGateway` registry entry

`src/modes/td/td-component-entries.ts` gains:

```ts
export function buildApiGateway(): ComponentRegistryEntry {
  return {
    type: "api_gateway" as ComponentTypeId,
    displayName: "API Gateway",
    ports: [
      { id: "in" as PortId, direction: "in" },
      { id: "out" as PortId, direction: "out" },
    ],
    placementCost: 80,
    capabilityFactories: [
      (id) => new AuthCapability(id),
      (id) => new ForwardingCapability(id, {
        handledTypes: ["api_read", "auth_required"],
        throughputPerTier: 30,
        emitForwardedEvent: true,
      }),
    ],
    getUpkeepCost: (tier) => tier * 4,
  };
}
```

Registered via `registerTDDefaults()` alongside Server, Database, Cache, LoadBalancer.

**Why these numbers (subject to calibration):**

- `throughputPerTier: 30` — slightly above Server's 20 so the Gateway is not the bottleneck. Wave 4 intensity will be tuned so the Server is the chokepoint, not the Gateway, to keep the lesson focused on "you needed an auth-handling component at the edge," not "your gateway was undersized."
- `placementCost: 80` — affordable on the 240 buildBudget for Wave 4 with room to also place a second Server or an upgrade.
- `getUpkeepCost(1) = 4` — meaningful but not punishing on Wave 4's expected revenue.

All numbers are starting points; the calibration test in §7 is the source of truth.

### 5.5 `placementCost` field on registry entries

New optional field on `ComponentRegistryEntry`:

```ts
interface ComponentRegistryEntry {
  // Existing: type, displayName, ports, capabilityFactories, getUpkeepCost, ...
  placementCost?: number;
}
```

Used by `tryPlace` to compute up-front cost. If absent, falls back to `getUpkeepCost(1) * 10`. Sandbox registry entries (which `tryPlace` will not exercise in 3b) can leave the field undefined. TD entries set explicit values for calibration.

Existing TD entries get explicit `placementCost`:

| Component | placementCost | Rationale |
|---|---|---|
| Server | 60 | Workhorse; should fit comfortably in early budgets |
| Database | 80 | Once-per-game purchase, slightly heavier |
| Cache | 50 | Cheap rescue for Wave 3 |
| LoadBalancer | 70 | Mid-tier rescue for Wave 3 |
| ApiGateway | 80 | New for Wave 4, on par with Database |

These numbers will be revisited when the campaign is calibrated end-to-end.

### 5.6 Dashboard changes

**File-level scope:**

- `src/dashboard/main.ts` — gains a mode toggle and TD HUD wiring
- `src/dashboard/td-mode.ts` — new file, owns TD-mode-specific rendering and click handlers
- `src/dashboard/sim-loop.ts` — gains TD phase awareness
- `src/dashboard/index.html` — adds palette, READY button, HUD container
- `src/dashboard/styles.css` — minimal CSS for new elements

**Mode toggle:**

- Top-bar toggle: `[Sandbox] [TD]`. Persisted in `location.hash` (`#mode=td`). On reload, the hash determines which mode boots.
- Sandbox mode keeps its current behavior unchanged. TD mode hides the topology preset selector, hides the chaos panel, and shows the TD HUD.

**TD HUD layout (right-side panel):**

```
┌──────────────────────────┐
│ Wave 2 of 4              │
│ Phase: BUILD             │
│ Budget: $340             │
│                          │
│ Palette                  │
│ ─────────────            │
│ [+ Server      $60]      │
│ [+ Database    $80]      │
│ [+ Cache       $50]      │
│ [+ Load Bal    $70]      │
│ [+ Api Gateway $80]      │
│                          │
│ [ READY ]                │
└──────────────────────────┘
```

During the run phase: palette and READY are disabled. HUD shows `Phase: RUNNING` and a tick counter scoped to the wave. The existing throughput/latency/health-bar charts continue to update from the same `MetricsSnapshot` source.

**Click-to-place flow:**

1. Player clicks a palette button → `td-mode.ts` enters `placing` state, highlights cursor.
2. Player clicks an empty cell in the topology grid → component is placed at that grid position via `tdController.tryPlace(type, position, connectsTo: [])` with **zero connections initially**. State enters `connecting` mode targeting the new component.
3. Player clicks an existing component → a connection is added from the existing component to the new one via a follow-up `state.createConnection` call (or, if we want atomicity, a `tryConnect(sourceId, targetId)` method on the controller that validates ports and either adds the connection or returns a failure).
4. ESC or click-outside cancels the connecting state without removing the component (the component is already placed; it's just unconnected).

**Why zero connections in the initial `tryPlace` call:** keeping `tryPlace` and `tryConnect` as separate operations avoids encoding click-flow ordering into the controller. The sim treats unconnected components as inert (Server with no in-port traffic produces no work). The HUD can show a small warning icon on unconnected components.

**`tryConnect` is part of the controller's public API:**

```ts
tryConnect(
  sourceId: ComponentId,
  targetId: ComponentId,
): { ok: true; connectionId: ConnectionId } | { ok: false; reason: TryConnectFailureReason };

type TryConnectFailureReason =
  | "wrong_phase"
  | "unknown_source" | "unknown_target"
  | "incompatible_ports"
  | "duplicate_connection";
```

`tryConnect` validates phase, both endpoints, port compatibility, and uniqueness of the (source, target) pair. Returns the new connection id on success.

**Sim loop phase awareness:**

```ts
// sim-loop.ts (TD branch)
function tickTD() {
  if (tdController.getPhase() === "build") return;     // do nothing
  engine.tick(tdController);
  if (tdController.isWaveExhausted()) {
    const result = tdController.endWave();
    showWaveResultToast(result);
    if (tdController.isCampaignComplete()) {
      showCampaignEndModal(result.passed);
    }
  }
}
```

The play/step/reset buttons retain their semantics: play loops `tickTD` at the speed slider, step calls it once, reset destroys the controller and restarts at Wave 1 with a fresh budget.

### 5.7 What stays the same

- `Engine`, `processPending`, `deliverStaged`, `checkTTL`, all 10 tick steps — untouched.
- `TDTrafficSource` — untouched. It already supports being instantiated per-wave.
- `evaluateOutcome` — untouched. Wave 4 uses the existing drop-threshold gate.
- All existing capabilities — untouched. `AuthCapability`, `ForwardingCapability`, `ProcessingCapability`, `StorageCapability`, `CachingCapability` are used as-is.
- The 564 existing tests — must continue to pass without modification.

## 6. Data flow — a campaign session

```
Page load
  → main.ts reads #mode=td from URL
  → constructs TDModeController(initialBudget=200, waves=[W1,W2,W3,W4])
  → mode = "build", waveIndex = 0
  → renders empty topology + palette + HUD ($200, Wave 1, BUILD)

Player clicks [+ Server]
  → cursor enters placing state
Player clicks empty cell (5,3)
  → tdController.tryPlace("server", {x:5, y:3}, [])
  → economy debited $60, balance now $140
  → component placed, HUD updates
  → cursor enters connecting state on new component
Player clicks the entry-point component
  → tdController.tryConnect(entry, server)
  → connection created, cursor returns to idle

Player clicks [READY]
  → tdController.startWave()
  → phase = "run", trafficSource constructed
  → sim loop drives engine.tick(tdController) at speed
  → existing charts populate from MetricsSnapshot
  → ticks 1..30: traffic, processing, metrics
  → ticks 31..N: drain — no new traffic, in-flight requests resolve
  → tdController.isWaveExhausted() returns true
  → tdController.endWave() → WaveResult{passed: true, dropRatio: 0.02, revenueEarned: $R, ...}
  → economy already accrued $R per-request revenue during the wave (existing TDEconomy behavior)
  → endWave() credits Wave 2's buildBudget (e.g. $180) on top
  → toast: "Wave 1 PASSED. Earned $R, build budget +$180."
  → phase = "build", waveIndex = 1
  → HUD updates to Wave 2, BUILD, balance = (140 + R + 180)

[repeat for waves 2–4]

After Wave 4 endWave():
  → tdController.isCampaignComplete() === true
  → campaign-end modal: "Campaign complete — 4/4 waves passed"
```

## 7. Testing strategy

### 7.1 Unit tests

**`tests/unit/td-mode-controller-place.test.ts`** — `tryPlace` and `tryConnect` paths:

- success: places component, debits economy, returns id
- `wrong_phase`: phase=run rejects placement
- `unknown_type`: rejects gracefully
- `insufficient_funds`: economy untouched, no component placed
- `unknown_target` in `connectsTo`: no component placed, no debit
- `incompatible_ports`: e.g. trying to connect Database (no out-port) as a source
- `tryConnect` after `tryPlace`: full two-step click flow
- `duplicate_connection`: rejects second connect of same (source, target)

**`tests/unit/td-mode-controller-phase.test.ts`** — phase machine:

- starts in build phase, waveIndex 0
- `startWave()` from build → run, instantiates trafficSource
- `startWave()` from run throws / rejects
- `endWave()` from run → build, increments waveIndex, credits revenue + buildBudget
- `endWave()` from build throws / rejects
- `isCampaignComplete()` true after final endWave
- `isWaveExhausted()` semantics: false during traffic, false while pending non-empty, true when both drained

**`tests/unit/td-economy-try-debit.test.ts`** — atomicity:

- success debits and logs
- failure leaves balance unchanged
- back-to-back debits up to balance succeed; the next one fails atomically

### 7.2 Integration tests

**`tests/integration/td/wave-4-auth.test.ts`** — calibration test for Wave 4:

```ts
// Topology A: Wave-3-winner (Server + Cache + LB, no Gateway) — must FAIL Wave 4
const a = setupWave3WinnerTopology();
const resultA = runWave(a, WAVE_4);
expect(resultA.passed).toBe(false);
expect(resultA.dropRatio).toBeGreaterThan(WAVE_4.dropThreshold);

// Topology B: Wave-3-winner + ApiGateway at entry — must PASS Wave 4
const b = setupWave3WinnerTopology();
addApiGatewayAtEntry(b);
const resultB = runWave(b, WAVE_4);
expect(resultB.passed).toBe(true);
```

This test is the source of truth for Wave 4 numerics. If it fails, tune Wave 4 mix / threshold / Gateway throughput / Server capacity until both assertions hold.

**`tests/integration/td/campaign-headless.test.ts`** — full four-wave scripted campaign:

```ts
const tdc = new TDModeController({
  initialBudget: 200,
  waves: [WAVE_1, WAVE_2, WAVE_3, WAVE_4],
  registry: registerTDDefaults(),
  // ...
});

// Wave 1 build
expect(tdc.tryPlace("server", pos1, [entryId]).ok).toBe(true);
tdc.startWave();
runUntilWaveExhausted(tdc);
expect(tdc.endWave().passed).toBe(true);

// Wave 2 build
expect(tdc.tryPlace("database", pos2, [serverId]).ok).toBe(true);
tdc.startWave();
runUntilWaveExhausted(tdc);
expect(tdc.endWave().passed).toBe(true);

// Wave 3 build
expect(tdc.tryPlace("cache", pos3, [serverId]).ok).toBe(true);
expect(tdc.tryPlace("load_balancer", pos4, [entryId]).ok).toBe(true);
tdc.tryConnect(lbId, serverId);
tdc.startWave();
runUntilWaveExhausted(tdc);
expect(tdc.endWave().passed).toBe(true);

// Wave 4 build
expect(tdc.tryPlace("api_gateway", pos5, [entryId]).ok).toBe(true);
tdc.tryConnect(gwId, lbId);
tdc.startWave();
runUntilWaveExhausted(tdc);
expect(tdc.endWave().passed).toBe(true);

expect(tdc.isCampaignComplete()).toBe(true);
```

This test doubles as the executable spec for the campaign and the smoke test for the dashboard's headless behavior.

### 7.3 Dashboard verification

Stage 3b's UI changes are DOM-based and not unit-tested directly. Manual verification per CLAUDE.md's UI-changes rule:

1. `pnpm dev` opens the dashboard
2. Toggle to TD mode, verify HUD renders Wave 1 / BUILD / $200
3. Place a Server, click entry-point to connect, click READY
4. Verify Wave 1 runs, charts update, toast appears, HUD advances to Wave 2
5. Repeat through Wave 4
6. Reset, verify campaign restarts cleanly
7. Toggle back to Sandbox, verify chaos panel + topology preset selector reappear and behave normally

The dashboard verification is documented in the implementation plan as a manual checklist; it does not gate `pnpm test`.

## 8. Risks and mitigations

**R1. Click-to-connect UX is fiddly.** Mitigation: keep it dumb — click source, click target, done. No drag, no pathfinding, no connection routing. If playtest reveals it feels bad, we ship a select-source-from-dropdown fallback in the same stage.

**R2. Wave 4 economic balance.** Mitigation: the calibration integration test in §7.1 is the source of truth. Tune numbers iteratively against the test, not the live dashboard. The test must hold both assertions before the stage merges.

**R3. Dashboard mode toggle leaks state between sandbox and TD.** Mitigation: separate top-level state objects (`tdState`, `sandboxState`) in `main.ts`. The toggle swaps which one drives the renderer. No shared mutable references. A unit test on the toggle's state-isolation is overkill; the manual verification checklist catches regressions.

**R4. `tryPlace` validation surface grows.** Mitigation: every failure reason is an enum variant (`TryPlaceFailureReason`). Adding a new reason is a type-system change that forces every call site to handle it. No "string failure messages."

**R5. Connections need port-direction validation.** Mitigation: §5.1 step 6 uses the `direction: "in" | "out"` field already on `Port`. The Stage 1 type system enforces this at the registry level; Stage 3b just enforces it at the controller boundary. No new typing work.

**R6. `isWaveExhausted` undercounts buffered requests.** Mitigation: `allBufferablesEmpty()` walks all components and queries every `EngineBufferable` capability. The Stage 2c interface guarantees `peekBuffered` exists on all buffer-holders. Sandbox's `TestQueueCapability` proves the pattern; production capabilities (e.g. `QueueCapability` from the merge) follow it.

**R7. Wave 4 calibration leaks into Stage 3a's wave numerics.** Mitigation: Stage 3a's three integration tests pin the existing wave numerics. Any change to `WAVE_1`, `WAVE_2`, `WAVE_3`, or to the existing `Server` / `Database` / `Cache` / `LoadBalancer` registry entries must keep those tests green. If Wave 4 calibration would force a regression, tune Gateway and Wave 4 instead.

## 9. Exit criteria

- All Stage 3a tests still pass (564 existing tests untouched)
- New unit tests for `tryPlace`, `tryConnect`, phase machine, `tryDebit` all pass
- New `wave-4-auth.test.ts` passes both assertions
- New `campaign-headless.test.ts` passes the full four-wave scripted run
- `pnpm test` green, `pnpm typecheck` clean
- Manual dashboard verification checklist (§7.3) completed and reported
- No new files in `src/core/engine/` (Stage 3b is mode-layer + dashboard work, not engine work)
- CLAUDE.md updated under "Implementation status" to reflect Stage 3b completion and the new "Next" section pointing at Stage 3c candidates

## 10. Open questions deferred to Stage 3c

These are deliberately not addressed here:

- **RateLimit wave** — Wave 5 candidate. Burst traffic that exceeds Server capacity, forcing a RateLimit at the edge to drop early and protect downstream condition. Needs `RateLimitCapability` to be exercised.
- **CircuitBreaker wave** — Wave 6 candidate. Requires chaos integration with TD waves so the player can experience flaky downstream and learn fail-fast.
- **Intra-wave satisfaction bar.** Mid-wave loss condition / lives. Best designed once the dashboard shows live wave feedback (which Stage 3b enables).
- **Campaign persistence.** Save / load campaign state across reloads. Trivial once we agree on a serialization format; not blocking gameplay.
- **Tier upgrades.** Spending budget to upgrade an existing component instead of placing a new one. Needs a UI surface and an economy decision.
- **Multi-port disambiguation in `tryConnect`.** Stage 3b uses first-matching-port. A component with multiple in-ports of different roles needs explicit port selection in the click flow.

## 11. Files touched

**New:**
- `src/dashboard/td-mode.ts`
- `tests/unit/td-mode-controller-place.test.ts`
- `tests/unit/td-mode-controller-phase.test.ts`
- `tests/unit/td-economy-try-debit.test.ts`
- `tests/integration/td/wave-4-auth.test.ts`
- `tests/integration/td/campaign-headless.test.ts`

**Modified:**
- `src/modes/td/td-mode-controller.ts` — `tryPlace`, `tryConnect`, phase machine
- `src/modes/td/td-economy.ts` — `tryDebit`
- `src/modes/td/waves.ts` — Wave 4 definition, `passReward`/`buildBudget` fields
- `src/modes/td/td-component-entries.ts` — `buildApiGateway`, `placementCost` on existing entries, `registerTDDefaults` registers the gateway
- `src/core/registry/component-entries.ts` — `placementCost?: number` field on `ComponentRegistryEntry`
- `src/dashboard/main.ts` — mode toggle, TD wiring
- `src/dashboard/sim-loop.ts` — TD phase awareness
- `src/dashboard/index.html` — palette, READY, HUD container
- `src/dashboard/styles.css` — minimal new element styles
- `CLAUDE.md` — implementation status update

**Untouched (explicitly):**
- `src/core/engine/**` — no engine changes
- `src/capabilities/**` — no capability changes
- `tests/integration/td/wave-1.test.ts`, `wave-2.test.ts`, `wave-3-*.test.ts` — Stage 3a tests pinned

# Stage 3b — TD Mode Playable Loop (Design)

**Status:** Draft v2 (post cold audit, scope reduced)
**Author:** Normid + Claude
**Date:** 2026-04-12
**Predecessor:** [Stage 3a — Wave 1–3 Playable Slice](./2026-04-12-stage-3a-wave-1-3-playable-slice-design.md)

## Revision history

- **v1 (initial draft):** introduced Wave 4 (Auth) as a new mechanic alongside the playable loop. Cold-audit found Wave 4 is unbuildable with the current capability library (`AuthCapability` is a no-op pass-through; silent PASS-at-PROCESS drops are invisible to `evaluateOutcome`). Spec also misremembered several existing APIs (`tryPlace` signature, `state.placeComponent`, port direction literals, `TDWaveDefinition` field names, `TDEconomy` surface).
- **v2 (cold-audit rewrite):** Wave 4 cut — new-wave / new-mechanic work deferred to Stage 3c. Spec rewritten against the real APIs in the codebase. Stage 3b ships *only* the interactive playable loop for the existing Wave 1–3 learning arc.
- **v3 (round-2 cold-audit fixes):** Tuned `registerTDDefaults` to register TD-specific capability factory options (`handledTypes`, `throughputPerTier`, `emitProcessedEvent`/`emitForwardedEvent`) so the dashboard/registry path produces the **same** runtime behavior as the harness path — collapsing the "divergence story" from v2 §5.9. Added a `CLIENT_ENTRY` to `td-component-entries.ts` for entry-point seeding. `isWaveDrained` now walks `EngineBufferable.peekBuffered()` partitions. `tryConnect` flow specifies Connection field defaults. Dashboard `condition` reset on wave boundary explicitly addressed. `economy` field becomes mutable via `setEconomy`. Sample code in §6/§7.2 fixed to pass `capRegistry` to `ComponentRegistry` constructor.

## 1. Purpose

Make TD mode actually playable end-to-end. Today, the four Wave 1–3 integration tests prove the engine can resolve the learning arc, but the ModeController's `tryPlace` is a stub and the only way to "play" is to write a TypeScript test that calls `tests/integration/td/helpers.ts` to construct components directly. Stage 3b closes the gap from headless test fixture to interactive build → watch → assess → repeat loop running in the existing dashboard, for the existing three-wave arc.

The minimum-viable interactive experience: a human runs `pnpm dev`, toggles to TD mode, sees an empty topology with the Wave 1 starting budget ($500) and a Wave 1 indicator, clicks **Server** from the palette, drops it on the grid, clicks the entry-point Client to draw a connection, clicks **READY**, watches Wave 1 resolve in the existing throughput/latency charts, sees the wave-pass toast, and is returned to the build phase with Wave 2's traffic ahead. They do this three times and either complete the campaign or fail a wave.

This is the first stage where a non-engineer can hold the controller, and the first stage that exercises the "game-first" principle outside of test code. It does **not** introduce any new wave, capability, or component. New mechanics arrive in Stage 3c.

## 2. Goals

- **G1.** `TDModeController.tryPlace` mutates state for real — uses `ComponentRegistry.create` to mint a component, validates against build phase + budget, debits `TDEconomy`, and calls `state.placeComponent`. Returns the existing `PlacementResult` discriminated union.
- **G2.** `TDModeController.tryConnect` (new TD-only method) validates ports, creates a `Connection` with a fresh branded id, and calls `state.addConnection`. Returns a `ConnectResult` with explicit failure reasons.
- **G3.** `TDModeController` accepts a list of waves and progresses through them via the existing `advancePhase()` machinery, exposing `getCurrentWaveIndex` / `getCurrentWave` / `isCampaignComplete`. The existing single-wave constructor path (used by `tests/integration/td/helpers.ts`) remains supported.
- **G4.** A three-wave campaign is playable end-to-end via the dashboard, and the same campaign is reproducible headlessly in a test that scripts placements with `tryPlace` / `tryConnect` and asserts wins through the registry path (not via the harness `buildServer` / `buildDatabase` shortcuts).
- **G5.** No regressions in sandbox mode, the four existing TD wave tests, or any other test in the suite.

## 3. Non-goals

- **New waves.** No Wave 4 in Stage 3b. The Wave 4 candidate from the v1 draft is deferred to Stage 3c so it can be designed against a capability primitive that actually supports the lesson.
- **New capabilities.** No new capability classes or new options on existing ones.
- **New component types.** No new entries in the TD registry. Server, Database, Cache, LoadBalancer only — same as Stage 3a.
- **Pixi.js / canvas rendering.** The existing DOM-based topology view in `src/dashboard/main.ts` is the rendering surface.
- **Drag-to-place / drag-to-connect.** Click-to-place and click-to-connect-by-selecting-endpoints is the entire interaction model.
- **Mid-wave intervention.** Placement is gated behind the build phase. The player cannot pause a running wave to add components.
- **Intra-wave satisfaction bar / lives.** Wave-end `evaluateOutcome` remains the only loss condition. Stage 3c will revisit.
- **Component upgrades.** Tier-1 placement only.
- **Save / load campaign state.** A reload starts a fresh campaign at Wave 1.
- **TD-mode chaos panel.** Sandbox keeps its chaos panel; TD doesn't expose chaos in Stage 3b.
- **Multi-port disambiguation in `tryConnect`.** Stage 3b uses first-matching-egress-on-source + first-matching-ingress-on-target. Components with multiple in-ports of different roles need explicit port selection — Stage 3c.
- **Position semantics in the engine.** `position` is a UI-layout hint only. The engine ignores it.

## 4. Scope summary

| Area | In | Out |
|---|---|---|
| `tryPlace` | Real impl, registry-minted component, `PlacementResult` failure reasons | New failure reasons; new return type |
| `tryConnect` | New TD-only method, port-direction validated, single connection per call | Multi-port selection, drag-to-connect, batch connect |
| `TDModeController` | Multi-wave support (waves array, `currentWaveIndex`, `getCurrentWave`, `isCampaignComplete`), `isWaveDrained` helper, registry held in options, `componentMintCounter` for id generation | Save/load, branching campaign paths |
| `TDTrafficSource` | Internal `ticksGenerated` counter, `isExhausted()` getter, decoupled from `state.currentTick` | Per-wave intensity ramps mid-wave |
| `TDEconomy` | No interface change — uses existing `canAfford` / `debitPlacement` / `creditRevenue` / `debitUpkeep` | New methods, `tryDebit`, debit log |
| Wave definitions | No change — `WAVE_1`/`WAVE_2`/`WAVE_3` from `td-waves.ts` are reused as-is. `id` literal type widened from `1 \| 2 \| 3` to `number` to allow future waves without churning Stage 3a tests | New waves |
| Dashboard | TD mode toggle, palette, READY button, wave HUD, build/connect interaction | Pixi rendering, animations, drag UX |
| Tests | Headless multi-wave campaign via `tryPlace`/`tryConnect`, unit tests for placement/connect/phase | Wave 4 calibration, manual playtest automation |

## 5. Architecture

### 5.1 `TDModeController` changes

**Current state** (`src/modes/td/td-mode-controller.ts`):
- Constructor takes one `wave: TDWaveDefinition`, eagerly constructs `trafficSource` from it.
- `tryPlace(state, type, position, zone): PlacementResult` is a stub: increments a counter, returns `{ok: true, componentId: "td-placed-N" as ComponentId}` without touching state.
- `phase: "build" | "simulate" | "assess"` with `advancePhase()` cycling `build → simulate → assess → build`.
- `evaluateOutcome(metrics)` reads from passed-in metrics, not from internal state.

**Stage 3b changes:**

```ts
export interface TDMultiWaveOptions {
  // CHANGED: array of waves, not one. Constructor throws if waves.length === 0.
  readonly waves: readonly TDWaveDefinition[];
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
  // NEW: needed for tryPlace to mint components from registry entries
  readonly componentRegistry: ComponentRegistry;
}

export class TDModeController implements ModeController {
  private readonly waves: readonly TDWaveDefinition[];
  private currentWaveIndex = 0;
  private trafficSource: TDTrafficSource;
  private phase: "build" | "simulate" | "assess" = "build";
  private waveStartMetricsIndex = 0;     // for slicing metricsHistory per wave
  private placementSerial = 0;           // for minting unique component / connection ids

  // CHANGED in v3: economy is no longer readonly. Dashboard reconstructs it
  // between waves (mirrors per-wave economy in tests/integration/td/helpers.ts:runWave).
  // Stage 3a's runWave constructs a fresh controller per wave so it never
  // exercises this mutation. Single-wave back-compat shim users likewise
  // never call setEconomy.
  economy: TDEconomy;

  constructor(options: TDMultiWaveOptions | TDSingleWaveOptions) {
    // Discriminated-union narrowing
    if ("waves" in options) {
      if (options.waves.length === 0) {
        throw new Error("TDModeController: waves array must be non-empty");
      }
      this.waves = options.waves;
      this.componentRegistry = options.componentRegistry;
    } else {
      this.waves = [options.wave];
      this.componentRegistry = STUB_REGISTRY;  // throws on tryPlace
    }
    this.economy = options.economy;
    this.entryPointId = options.entryPointId;
    this.rng = options.rng;
    this.trafficSource = new TDTrafficSource({
      wave: this.waves[0]!,           // safe: empty-waves rejected above; single-wave produces length 1
      targetEntryPointId: options.entryPointId,
      rng: options.rng,
    });
  }

  /** Dashboard calls this on assess→build to swap in the next wave's economy. */
  setEconomy(economy: TDEconomy): void {
    this.economy = economy;
  }

  // Existing methods stay (with this.wave → this.getCurrentWave())
  getActiveCapabilities(component): ReadonlySet<CapabilityId>;
  getTierCap(component, capabilityId): number;
  getBuildConstraints(): BuildConstraints;
  getTrafficSource(): TrafficSource;
  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport;
  getInitialZoneTopology(): ZoneTopology;
  tryUpgrade(state, componentId, capabilityId): UpgradeResult;
  getScheduledChaos(currentTick): readonly ChaosEvent[];

  // Existing phase machinery — keep
  getPhase(): "build" | "simulate" | "assess";
  advancePhase(): void;  // Now also handles assess→build wave advancement (see §5.2)

  // NEW
  getCurrentWaveIndex(): number;
  getCurrentWave(): TDWaveDefinition;        // throws if isCampaignComplete
  isCampaignComplete(): boolean;             // currentWaveIndex >= waves.length
  isWaveDrained(state: SimulationState): boolean;
  getCurrentWaveMetrics(state: SimulationState): readonly TickMetrics[];

  // CHANGED: real impl
  tryPlace(state, type, position, zone): PlacementResult;

  // NEW: TD-only public method (not on ModeController interface)
  tryConnect(
    state: SimulationState,
    sourceComponentId: ComponentId,
    targetComponentId: ComponentId,
  ): ConnectResult;
}

export type ConnectResult =
  | { ok: true; connectionId: ConnectionId }
  | {
      ok: false;
      reason:
        | "wrong_phase"
        | "unknown_source"
        | "unknown_target"
        | "no_egress_port"
        | "no_ingress_port"
        | "duplicate_connection"
        | "port_capacity_exceeded";
      detail?: string;
    };
```

**`tryPlace` flow:**

1. **Phase check.** Reject `{ok: false, reason: "disallowed_by_mode", detail: "wrong phase"}` if `phase !== "build"`. (We reuse the existing `PlacementResult` reason set rather than inventing new variants — this is the closest existing fit.)
2. **Mode allowlist.** Reject `disallowed_by_mode` if `type` is not in `getCurrentWave().availableComponents`. (Stage 3a uses `getBuildConstraints` for this; same check applies here.)
3. **Registry lookup + component creation.** `const result = this.componentRegistry.tryCreate(type, position, zone)`. If the registry rejects (unknown type), translate to `{ok: false, reason: "registry_unknown_type"}`. If the registry accepts, it returns a fully-constructed `Component` with capabilities instantiated by their factory (this is the existing path; see `ComponentRegistry.create`).
4. **Budget check.** If `!economy.canAfford(component.placementCost)`, return `{ok: false, reason: "insufficient_budget"}`. The component is not retained — it's discarded since the registry's `create` does not commit anywhere yet.
5. **Debit + place.** `economy.debitPlacement(component); state.placeComponent(component);`. Both succeed unconditionally given the prior checks.
6. **Return.** `{ok: true, componentId: component.id}`.

**Note on rollback semantics:** `ComponentRegistry.tryCreate` advances the registry's internal id counter even when the component is later discarded (e.g. on `insufficient_budget` rejection). This means `ComponentId` values may have gaps from the player's perspective. Acceptable for Stage 3b — no test or runtime depends on contiguous ids — but worth flagging if a future stage adds deterministic-id snapshot tests.

**`Position` is a UI hint, not engine-meaningful.** The engine ignores `position` (no spatial routing). The dashboard uses it to render the component on the topology grid; tests can pass `{x: 0, y: 0}` for every placement without consequence.

**`tryConnect` flow:**

1. **Phase check.** Reject `wrong_phase` if `phase !== "build"`.
2. **Endpoint existence.** Reject `unknown_source` / `unknown_target` if either id is not in `state.components`.
3. **Port discovery.** Find first port on source with `direction === "egress"`. Reject `no_egress_port` if absent. Find first port on target with `direction === "ingress"`. Reject `no_ingress_port` if absent.
4. **Duplicate check.** If any existing connection in `state.connections` has matching `from.componentId === sourceId && to.componentId === targetId`, reject `duplicate_connection`.
5. **Port capacity check.** If `sourcePort.connections.length >= sourcePort.capacity` or `targetPort.connections.length >= targetPort.capacity`, reject `port_capacity_exceeded`.
6. **Mint connection.** Generate a new `ConnectionId` (`` `td-conn-${++this.placementSerial}` `` cast as `ConnectionId`). Construct a `Connection` literal with the required fields:
   - `id`: minted `ConnectionId`
   - `from: { componentId: sourceComponentId, portId: sourcePort.id }`
   - `to: { componentId: targetComponentId, portId: targetPort.id }`
   - `bandwidth: 100` (TD-mode default; matches `tests/harness/fixtures.ts:makeConnection`)
   - `latency: 1` (TD-mode default; same source)
   - `currentLoad: 0` (engine resets each tick anyway)
7. **Add to state.** Call `state.addConnection(conn)`.
8. **Update port state.** Push the new connection id into both `sourcePort.connections` and `targetPort.connections`. (Mirrors `tests/integration/td/helpers.ts:wire`.)
9. **Return.** `{ok: true, connectionId: conn.id}`.

**Note on connection defaults:** `bandwidth: 100` and `latency: 1` are hardcoded in `tryConnect`. Stage 3a's tests use the same defaults via `makeConnection`. A future stage may want connection-type-aware defaults (e.g. CDN-to-Origin gets higher latency than LB-to-Server) — Stage 3b leaves that as a Stage 3c question.

**`isWaveDrained` flow:**

```ts
isWaveDrained(state: SimulationState): boolean {
  if (!this.trafficSource.isExhausted()) return false;
  for (const arr of state.pending.values()) {
    if (arr.length > 0) return false;
  }
  if (state.blockedParents.size > 0) return false;
  if (state.activeStreams.size > 0) return false;
  // EngineBufferable partitions: requests held inside Queue/CircuitBreaker/Retry
  // capabilities. Mirrors the scan loop in src/core/engine/check-ttl.ts.
  for (const componentId of state.visitOrder) {
    const component = state.components.get(componentId);
    if (!component) continue;
    for (const cap of component.getCapabilities()) {
      if (isEngineBufferable(cap) && cap.peekBuffered().length > 0) return false;
    }
  }
  return true;
}
```

This walks every place a request can live between ticks:
- per-component pending queues (`state.pending` is `Map<ComponentId, Request[]>`)
- SPAWN-blocked parent pool (`state.blockedParents`)
- active long-lived streams (`state.activeStreams`)
- `EngineBufferable` capability partitions (Queue, CircuitBreaker, Retry, etc. — none used in TD Stage 3b's component set, but the `isWaveDrained` primitive is reusable and must be correct for future waves)

`state.stagedOutcomes` is asserted-empty between ticks by the engine itself, so we don't check it.

The `isEngineBufferable` type guard already exists in `src/core/capability/engine-bufferable.ts` (or wherever the guard lives — verified during round-1 audit). Stage 3b imports it.

**`getCurrentWaveMetrics` flow:**

```ts
getCurrentWaveMetrics(state: SimulationState): readonly TickMetrics[] {
  return state.metricsHistory.slice(this.waveStartMetricsIndex);
}
```

The slice index is captured on `build → simulate` transition (see §5.2).

### 5.2 `advancePhase` semantics for multi-wave campaigns

The existing 3-state machine cycles `build → simulate → assess → build`. Stage 3b adds wave-index advancement on the `assess → build` edge:

```ts
advancePhase(): void {
  switch (this.phase) {
    case "build":
      // Player clicked READY. Snapshot metrics index for this wave.
      this.waveStartMetricsIndex = this.state.metricsHistory.length;
      // (this.state is now held on the controller — see Open Question O1)
      this.phase = "simulate";
      break;
    case "simulate":
      // Sim loop has detected isWaveDrained. Move to assess.
      this.phase = "assess";
      break;
    case "assess":
      // Player acknowledged the wave result. Advance to next wave.
      this.currentWaveIndex += 1;
      if (this.currentWaveIndex < this.waves.length) {
        this.trafficSource = new TDTrafficSource({
          wave: this.waves[this.currentWaveIndex]!,
          targetEntryPointId: this.entryPointId,
          rng: this.rng,
        });
      }
      this.phase = "build";
      break;
  }
}
```

**Open Question O1:** The current `evaluateOutcome` takes `metrics: readonly TickMetrics[]` as a param — it does not hold a reference to `SimulationState`. To slice metricsHistory at wave boundaries, the controller needs *some* way to know the snapshot point at `build → simulate` time. Two options:

- **(a) Pass `state` into `advancePhase(state)`.** Cleanest from a no-hidden-state perspective, but changes a method signature that exists today.
- **(b) Hold `state` in `TDModeControllerOptions`.** Constructor-bound. Simpler call sites but more coupling.

**Recommendation: (a).** Add `state` as an optional parameter on `advancePhase` for new call sites; old call sites (Stage 3a `runWave`) continue to call `advancePhase()` without it, which is fine because Stage 3a uses single-wave controllers and never crosses a wave boundary. The implementation snapshots the index only when `state` is provided.

This is the only signature change to an existing method. It's additive — no Stage 3a test breaks.

**Call-site narrowing under `exactOptionalPropertyTypes`:** `ModeController.advancePhase()` in the interface stays no-arg. TD-typed call sites (`tdController.advancePhase(state)`) work because they hold a concrete `TDModeController` reference, not an upcast `ModeController`. The dashboard sim loop must therefore keep a TD-typed reference, not a generic one. Callers tempted to pass `state | undefined` directly will need `state ? mc.advancePhase(state) : mc.advancePhase()` because `exactOptionalPropertyTypes` rejects explicit `undefined` for optional parameters. Stage 3b call sites all pass a defined `state`, so this is a documentation note, not a code constraint.

### 5.3 `TDTrafficSource` changes

**Current state** (`src/modes/td/td-traffic-source.ts`):
- `generate(tick: number): Request[]` checks `tick >= this.wave.duration` and short-circuits.
- The `tick` argument is the engine's global `state.currentTick`. For a single-wave session this is fine — `state.currentTick` starts at 0 and increments with each tick. For a multi-wave campaign with a single persistent state, `state.currentTick` is already ≥ 30 by the time Wave 2 starts, so the second source short-circuits immediately.

**Stage 3b changes:**

```ts
export class TDTrafficSource implements TrafficSource {
  // existing fields...
  private ticksGenerated = 0;

  generate(tick: number): Request[] {
    if (this.ticksGenerated >= this.wave.duration) return [];
    this.ticksGenerated += 1;
    // tick is still used for the request's `createdAt` (see existing impl).
    // Only the exhaustion gate moves from `tick` to `ticksGenerated`.
    // ... existing per-tick generation logic, with `createdAt: tick` preserved ...
  }

  isExhausted(): boolean {
    return this.ticksGenerated >= this.wave.duration;
  }
}
```

The source becomes self-counting **for the exhaustion gate**. The `tick` parameter is still passed by the engine (`inject-traffic.ts` calls `sub.generate(state.currentTick)`) and the source still uses it as the `createdAt` field on emitted requests. This matters for cross-wave continuity: when Wave 2 starts, `state.currentTick` is already ~30+ (Wave 1 duration + drain), so Wave 2 requests have `createdAt` values starting from that point. TTL math is relative (`createdAt + ttl <= state.currentTick`), so it remains correct.

Each new source instance starts at `ticksGenerated = 0`. This means a fresh `TDTrafficSource` for Wave 2 generates the correct traffic volume regardless of `state.currentTick`.

**Backwards compatibility with Stage 3a tests:** the existing `runWave` helper in `tests/integration/td/helpers.ts` runs `engine.tick(mode)` for `wave.duration` iterations. With the new self-counting source, `generate(0..29)` runs and produces traffic exactly as before — no behavioral change.

### 5.4 `TDWaveDefinition.id` widening

Current: `readonly id: 1 | 2 | 3`. This is a literal union — adding waves later requires editing the type. Stage 3b widens to `readonly id: number`, which costs nothing today (existing literal values 1/2/3 still satisfy it) and unblocks Stage 3c without a type-system churn.

This is the only `td-waves.ts` change.

### 5.5 `TDEconomy` — no changes

`TDEconomy` already has the methods Stage 3b needs:
- `canAfford(cost: number): boolean`
- `debitPlacement(component: ComponentReader): void`
- `creditRevenue(request: Request): number`
- `debitUpkeep(totalUpkeep: number): void`

The `tryDebit` and `debitLog` from the v1 draft are deleted. `tryPlace` uses `canAfford` then `debitPlacement` — two synchronous calls inside the controller, atomic at the controller's discretion (no concurrency).

### 5.6 `ComponentRegistry.tryCreate` — minor extension

`ComponentRegistry.create(type, position, zone)` currently throws on unknown type. `tryPlace` needs a non-throwing variant to translate to `{ok: false, reason: "registry_unknown_type"}` cleanly.

**Add:**

```ts
tryCreate(type: string, position: Position, zone: string | null): Component | null
```

Returns `null` on unknown type, returns a `Component` on success. The existing `create` can stay as a thin wrapper that throws if `tryCreate` returns null (preserves the throwing API for callers that want it).

This is the only change to `src/core/registry/component-registry.ts`.

### 5.7 Dashboard changes

**File-level scope:**

- `src/dashboard/main.ts` — gains a mode toggle and TD HUD wiring
- `src/dashboard/td-mode.ts` — **new file**, owns TD-mode-specific rendering, click handlers, palette
- `src/dashboard/sim-loop.ts` — gains TD branch, parameterized over `ModeController`
- `src/dashboard/index.html` — adds TD HUD container, palette, READY button (hidden by default)
- `src/dashboard/styles.css` — minimal CSS for new elements

**Mode toggle:**

- Top-bar toggle: `[Sandbox] [TD]`. Persisted in `location.hash` (`#mode=td`). On reload, the hash determines which mode boots.
- Sandbox mode keeps its current behavior unchanged. TD mode hides the topology preset selector and the chaos panel; shows the TD HUD.

**TD HUD layout (right-side panel):**

```
┌──────────────────────────┐
│ Wave 2 of 3              │
│ Phase: BUILD             │
│ Budget: $340             │
│                          │
│ Palette                  │
│ ─────────────            │
│ [+ Server      $100]     │
│ [+ Database    $200]     │
│ [+ Cache       $150]     │
│ [+ Load Bal    $175]     │
│                          │
│ [ READY ]                │
└──────────────────────────┘
```

Costs match the existing TD entries — no rebalancing in 3b. During `simulate` and `assess` phases the palette and READY button are disabled. The HUD shows `Phase: RUNNING` (during simulate) or `Phase: ASSESS` (during assess). Existing throughput/latency/health-bar charts continue to update from the `MetricsSnapshot` source.

Wave 1 starts with `WAVE_1.startingBudget = 500`; Wave 2 and Wave 3 start with their own `startingBudget` values (500 and 600 respectively per `td-waves.ts`). Stage 3b uses those values as-is. For the campaign experience the starting budget at Wave 2/3 *replaces* leftover budget from the prior wave (matching the way `TDEconomy` is currently constructed with a fresh `startingBudget` per-wave in `runWave`). This is a deliberate Stage 3b simplification — carrying over budget across waves is a Stage 3c question.

**Per-wave dashboard reset on `assess → build`:**

1. Construct a fresh `TDEconomy` for the next wave: `new TDEconomy({startingBudget: nextWave.startingBudget, revenuePerRequestType: nextWave.revenuePerRequestType})`.
2. Call `tdController.setEconomy(newEconomy)` to swap it in. The controller's `economy` field is mutable for exactly this purpose (see §5.1).
3. Reset every existing component's `condition` to `1.0` via `state.setCondition(componentId, 1.0)`. **Component condition persists across ticks but the build phase has no engine ticks**, so a Server degraded to 0.6 by Wave 1's traffic spike would start Wave 2 at 0.6 unless the dashboard explicitly resets it. Stage 3b chooses **reset to 1.0 between waves** so the player isn't punished for damage they can't see or remediate. Stage 3c may revisit this if condition becomes player-visible mid-wave.
4. Call `tdController.advancePhase(state)` to transition `assess → build`. This advances `currentWaveIndex` and reconstructs `trafficSource` for the new wave.

**TD HUD data sources (separate from sandbox HUD):**

The existing `src/dashboard/main.ts` reads `economy.totalRevenue` and `economy.totalUpkeep` for the sandbox HUD — those are `SandboxEconomy`-only getters. `TDEconomy` exposes only `getBudget()`. The TD HUD's budget display reads `tdController.economy.getBudget()`. Cumulative wave revenue/upkeep numbers, if shown, must come from `state.metricsHistory` aggregation (`m.revenueEarnedThisTick` / `m.upkeepPaidThisTick` summed over `getCurrentWaveMetrics(state)`). The TD branch of `main.ts` keeps its data wiring entirely separate from the sandbox branch — no shared call path that would force a polymorphic economy interface.

**Click-to-place flow:**

1. Player clicks a palette button → `td-mode.ts` enters `placing` state, highlights the cursor.
2. Player clicks an empty cell on the topology grid → `td-mode.ts` calls `tdController.tryPlace(state, type, {x, y}, null)`.
3. On `{ok: true}`, the new component renders on the grid; the cursor enters `connecting` state with the new component as the connect target.
4. Player clicks an existing component (the *source*) → `td-mode.ts` calls `tdController.tryConnect(state, sourceId, newId)`. On success, the connection renders.
5. ESC or click-outside cancels the connecting state. The component remains placed but unconnected. Unconnected components show a small warning icon (CSS only — no logic change in the engine).

**Sim loop phase awareness:**

```ts
// sim-loop.ts (TD branch)
function tickTD() {
  const phase = tdController.getPhase();
  if (phase === "build" || phase === "assess") return;   // no engine work
  // phase === "simulate"
  engine.tick(tdController);
  if (tdController.isWaveDrained(state)) {
    tdController.advancePhase(state);                    // simulate → assess
    const outcome = tdController.evaluateOutcome(
      tdController.getCurrentWaveMetrics(state),
    );
    showWaveResultToast(outcome);
    if (outcome.verdict === "win" && tdController.getCurrentWaveIndex() === tdController.getWaveCount() - 1) {
      showCampaignEndModal(true);
    } else if (outcome.verdict === "lose") {
      showCampaignEndModal(false);
    }
    // Player must click "Continue" to advance assess → build (next wave or restart)
  }
}
```

The play/step/reset buttons retain their semantics: play loops `tickTD` at the speed slider, step calls it once, reset destroys the controller and the state and restarts at Wave 1 with a fresh budget.

**SimLoop refactor:** `src/dashboard/sim-loop.ts` currently imports `SandboxModeController` directly and calls a sandbox-specific `getMetricsSnapshot`. Stage 3b parameterizes `SimLoop` over `ModeController` and moves the sandbox-specific snapshot getter into a callback the constructor accepts. The TD branch passes its own snapshot getter that pulls metrics directly from `state.metricsHistory`.

### 5.8 What stays the same

- `Engine`, `processPending`, `deliverStaged`, `checkTTL`, all 10 tick steps — untouched.
- `WAVE_1`, `WAVE_2`, `WAVE_3` definitions (intensity/composition/duration/threshold) — untouched (only `id` literal type widened).
- `evaluateOutcome` — untouched.
- All existing capability **classes** — untouched. Stage 3b only changes the **factory options** that `registerTDDefaults` passes when constructing them.
- `tests/integration/td/wave-1-launch-day.test.ts`, `wave-2-signups.test.ts`, `wave-3-traffic-spike.test.ts`, `wave-3-learning-arc.test.ts` — untouched. They use single-wave `TDModeController` construction and the harness `buildServer` / `buildDatabase` / `wire` shortcuts (direct `new Component(...)` construction that bypasses the registry entirely). They are unaffected by §5.9's factory tuning. Both single-wave and multi-wave construction paths must continue to work after Stage 3b's controller refactor.

**Backwards compatibility shim:** the existing `TDModeControllerOptions` shape (`{wave, economy, entryPointId, rng}`) is preserved as an alternative call signature on the constructor. Internally, single-`wave` construction is normalized to `waves: [wave]` and `componentRegistry` defaults to a no-op stub registry that throws if `tryPlace` is called. Stage 3a tests never call `tryPlace`, so the stub is never reached.

```ts
export type TDModeControllerOptions = TDMultiWaveOptions | TDSingleWaveOptions;

interface TDMultiWaveOptions {
  readonly waves: readonly TDWaveDefinition[];
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
  readonly componentRegistry: ComponentRegistry;
}

interface TDSingleWaveOptions {
  readonly wave: TDWaveDefinition;
  readonly economy: TDEconomy;
  readonly entryPointId: ComponentId;
  readonly rng: () => number;
  // componentRegistry omitted — controller uses an internal stub that throws on tryPlace
}
```

The constructor narrows on `"waves" in options ? ... : ...`. The stub registry exists as a private constant inside the controller module.

### 5.9 `registerTDDefaults` and `td-component-entries.ts` changes

**v2 said this section was "no change." Round-2 cold audit found that was wrong** — the registry-default `ProcessingCapability("processing")` has `canHandle: true` (responds to *all* request types) and unbounded throughput. A dashboard-placed Server would then RESPOND to `api_write` traffic directly without ever needing a Database, completely invalidating the Wave 2 / Wave 3 learning arc for dashboard players.

The fix is one-line-per-factory: tune `registerTDDefaults` to register TD-specific factory options that match the harness builders. This collapses the divergence — dashboard play and headless tests now produce identical runtime behavior.

**Modified `register-td-defaults.ts`:**

```ts
export function registerTDDefaults(
  capRegistry: CapabilityRegistry,
  compRegistry: ComponentRegistry,
): void {
  capRegistry.register({
    id: "processing" as CapabilityId,
    factory: () =>
      new ProcessingCapability("processing" as CapabilityId, {
        handledTypes: ["api_read"],          // TD-tuned: reads only
        throughputPerTier: 20,                // TD-tuned: matches harness
        emitProcessedEvent: true,
      }),
  });
  capRegistry.register({
    id: "forwarding" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding" as CapabilityId, {
        handledTypes: ["api_read", "api_write"],
        throughputPerTier: 12,                // TD-tuned: matches harness Server-style cap
        emitForwardedEvent: true,
      }),
  });
  // Cache and LB use higher Forwarding throughput. The factory registry is
  // shared, so the Server's lower throughput is the bottleneck. To keep
  // Cache/LB unconstrained, we register TWO forwarding factories under
  // distinct ids: "forwarding" (Server-style, capped) and "forwarding-pipe"
  // (Cache/LB-style, ~55/tick). The component entries for Cache and LB
  // reference "forwarding-pipe" instead of "forwarding".
  capRegistry.register({
    id: "forwarding-pipe" as CapabilityId,
    factory: () =>
      new ForwardingCapability("forwarding-pipe" as CapabilityId, {
        handledTypes: ["api_read", "api_write"],
        throughputPerTier: 55,
        emitForwardedEvent: true,
      }),
  });
  capRegistry.register({
    id: "storage" as CapabilityId,
    factory: () =>
      new StorageCapability("storage" as CapabilityId, {
        throughputPerTier: 25,                // TD-tuned: matches harness Database
        emitProcessedEvent: true,
      }),
  });
  capRegistry.register({
    id: "caching" as CapabilityId,
    factory: () => new CachingCapability("caching" as CapabilityId),
  });
  capRegistry.register({
    id: "routing" as CapabilityId,
    factory: () => new RoutingCapability("routing" as CapabilityId),
  });
  capRegistry.register({
    id: "monitoring" as CapabilityId,
    factory: () => new MonitoringCapability("monitoring" as CapabilityId),
  });

  compRegistry.register(CLIENT_ENTRY);              // NEW
  compRegistry.register(SERVER_ENTRY);
  compRegistry.register(DATABASE_ENTRY);
  compRegistry.register(CACHE_ENTRY);
  compRegistry.register(LOAD_BALANCER_ENTRY);

  compRegistry.validate();
}
```

**Modified `td-component-entries.ts`:**

- **`CACHE_ENTRY` and `LOAD_BALANCER_ENTRY`** change their `forwarding` capability ref to `forwarding-pipe`. Existing Stage 3a tests that build Cache/LB via `buildCache`/`buildLoadBalancer` use direct construction with `new ForwardingCapability(...)`, so the registry-side rename doesn't affect them.
- **New `CLIENT_ENTRY`** — minimal entry-point component for the dashboard to seed the topology entry-point. It carries one capability (`forwarding`) and an egress port:

```ts
export const CLIENT_ENTRY: ComponentRegistryEntry = {
  type: "client",
  name: "Client",
  description: "Traffic entry point. Forwards requests into the architecture.",
  capabilities: [
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 1 },
  ],
  ports: [
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 4, connections: [] },
  ],
  placementCost: 0,
  upgradeCostCurve: [0],
  visual: { icon: "client", color: "#94a3b8", shape: "circle" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};
```

The Client uses `forwarding-pipe` (uncapped) so it is never the bottleneck. `placementCost: 0` makes it free; the dashboard auto-places one Client at the start of every campaign.

**Implication for Stage 3a tests:** the four wave tests in `tests/integration/td/` build their components via `helpers.ts:buildServer`/`buildDatabase`/`buildCache`/`buildLoadBalancer` — direct `new Component(...)` construction that bypasses the registry entirely. They are **unaffected** by the `register-td-defaults.ts` factory tuning. Their registry-side calls (`compRegistry.validate()`) still pass because the entries still reference valid capability ids.

**Implication for dashboard play:** dashboard-placed components now match harness-built components byte-for-byte. The lone-server topology loses Wave 3 in both the dashboard and the headless test. The Cache-rescue and LB-rescue topologies win in both. The learning arc is preserved end-to-end.

## 6. Data flow — a campaign session

```
Page load
  → main.ts reads #mode=td from URL
  → main.ts constructs:
      - state = new SimulationState({zones: ["default"], pairLatency: new Map()})
      - capRegistry = new CapabilityRegistry()
      - compRegistry = new ComponentRegistry(capRegistry)        // capRegistry is required
      - registerTDDefaults(capRegistry, compRegistry)             // wires TD-tuned factories + CLIENT_ENTRY
      - client = compRegistry.create("client", {x:0, y:0}, null)  // CLIENT_ENTRY now exists
      - state.placeComponent(client)
      - economy = new TDEconomy({startingBudget: WAVE_1.startingBudget, revenuePerRequestType: WAVE_1.revenuePerRequestType})
      - tdController = new TDModeController({waves: [WAVE_1, WAVE_2, WAVE_3], economy, entryPointId: client.id, rng: makeRng(1), componentRegistry: compRegistry})
      - phase = "build", waveIndex = 0
  → renders topology with the seeded Client + palette + HUD ($500, Wave 1, BUILD)

Player clicks [+ Server] then clicks empty cell (5,3)
  → tdController.tryPlace(state, "server", {x:5, y:3}, null)
  → tryPlace path:
      - phase check OK
      - allowlist check OK (server in WAVE_1.availableComponents)
      - registry.tryCreate("server", {x:5,y:3}, null) → Component instance with placementCost=100
      - economy.canAfford(100) OK
      - economy.debitPlacement(component) → balance = $400
      - state.placeComponent(component)
      - returns {ok: true, componentId: "server-1"}
Player clicks the entry-point Client
  → tdController.tryConnect(state, clientId, "server-1")
  → tryConnect path:
      - phase check OK
      - source/target exist OK
      - source has egress port, target has ingress port OK
      - no duplicate, capacity OK
      - mints Connection, calls state.addConnection
      - pushes connection id into both port.connections arrays
      - returns {ok: true, connectionId: "td-conn-1"}

Player clicks [READY]
  → tdController.advancePhase(state)
  → advancePhase: build → simulate, snapshots waveStartMetricsIndex = 0
  → SimLoop drives engine.tick(tdController) at speed
  → existing charts populate from MetricsSnapshot
  → ticks 1..30: traffic generated, processed, metrics recorded
  → ticks 31..N: trafficSource exhausted (ticksGenerated=30), pending drains
  → tdController.isWaveDrained(state) === true
  → tdController.advancePhase(state) → simulate → assess
  → outcome = tdController.evaluateOutcome(tdController.getCurrentWaveMetrics(state))
  → toast: "Wave 1 PASSED — drop rate 1.2%, budget $400."
  → modal "Continue?" → player clicks
  → dashboard runs the per-wave reset (see §5.7):
      - newEconomy = new TDEconomy({startingBudget: WAVE_2.startingBudget=500, revenuePerRequestType: WAVE_2.revenuePerRequestType})
      - tdController.setEconomy(newEconomy)
      - for each placed component: state.setCondition(componentId, 1.0)
      - tdController.advancePhase(state) → assess → build, currentWaveIndex=1, trafficSource swapped to WAVE_2's source
  → HUD updates to Wave 2 of 3, BUILD, $500

[repeat for waves 2 and 3]

After Wave 3 advancePhase from assess to build:
  → tdController.isCampaignComplete() === true
  → campaign-end modal: "Campaign complete — 3/3 waves passed"
```

## 7. Testing strategy

### 7.1 Unit tests

**`tests/unit/td-mode-controller-place.test.ts`** — `tryPlace` paths:

- **success** — placing a Server with sufficient budget mutates `state.components`, debits economy, returns `{ok: true, componentId}`
- **`disallowed_by_mode` for wrong phase** — `tryPlace` during `simulate` rejects without mutating state or economy
- **`disallowed_by_mode` for type not in availableComponents** — Wave 1 only allows server/database; cache/load_balancer rejected
- **`registry_unknown_type`** — unknown type string rejected, no mutation
- **`insufficient_budget`** — placing when balance < placementCost rejects, balance unchanged, no component placed
- the `ok:true` shape narrows `componentId` correctly for downstream test code

**`tests/unit/td-mode-controller-connect.test.ts`** — `tryConnect` paths:

- **success** — first egress on source, first ingress on target, fresh connection added to `state.connections` with both endpoints' `port.connections` arrays updated, all Connection fields populated (id, from, to, bandwidth=100, latency=1, currentLoad=0)
- **`wrong_phase`** — rejects during `simulate` / `assess`
- **`unknown_source` / `unknown_target`** — bogus ids rejected
- **`no_egress_port`** — A target with no egress port fails when used as a source. (Stage 3a's `DATABASE_ENTRY` has both ingress and egress, so this test uses a contrived component or the new `CLIENT_ENTRY` if it lacks ingress.)
- **`no_ingress_port`** — `CLIENT_ENTRY` has no ingress port (entry-point-only); attempting to connect TO a Client rejects with `no_ingress_port`
- **`duplicate_connection`** — second connect of same `(source, target)` rejects
- **`port_capacity_exceeded`** — `SERVER_ENTRY` egress port has `capacity: 2`. The test connects three downstream targets to one Server; the third connect rejects with `port_capacity_exceeded`. Source/target are reset between sub-cases to avoid the duplicate-connection rule firing first.

**`tests/unit/td-mode-controller-phase.test.ts`** — multi-wave phase machine:

- starts in `build` phase, `currentWaveIndex` 0
- empty waves array throws on construction
- `advancePhase(state)` snapshots `waveStartMetricsIndex` on `build → simulate`
- `simulate → assess` does not advance `currentWaveIndex`
- `assess → build` advances `currentWaveIndex` and reconstructs `trafficSource` with the next wave
- `isCampaignComplete()` true after final `assess → build`
- single-wave construction (Stage 3a back-compat shim) works without `componentRegistry` in options; calling `tryPlace` on the back-compat-constructed controller throws (stub registry)
- `getCurrentWaveMetrics(state)` returns only metrics from `waveStartMetricsIndex` onward
- `setEconomy(newEconomy)` swaps the economy reference; subsequent `tryPlace` calls debit the new economy
- **`isWaveDrained` cases:** drains correctly when pending is empty + traffic exhausted; stays false when a SPAWN-blocked parent exists; stays false when an active stream exists; stays false when an `EngineBufferable` capability holds requests (test uses `TestQueueCapability` from `tests/harness/test-capabilities.ts`)

**`tests/unit/td-traffic-source-self-counting.test.ts`** — internal counter:

- `generate(0)` returns full intensity batch, `ticksGenerated === 1`
- `generate(99999)` for the same source instance returns intensity batch as long as `ticksGenerated < wave.duration` (the `tick` argument is now ignored)
- after `wave.duration` calls, `generate()` returns `[]` and `isExhausted()` true
- a fresh source instance for a new wave starts at `ticksGenerated === 0` regardless of any prior source

### 7.2 Integration test

**`tests/integration/td/campaign-headless.test.ts`** — full three-wave scripted campaign via the registry path:

```ts
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import { makeRng } from "./helpers";  // tests/integration/td/helpers.ts

it("plays a 3-wave campaign through the registry path", () => {
  const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);   // capRegistry is required
  registerTDDefaults(capRegistry, compRegistry);

  // Seed entry-point Client via CLIENT_ENTRY (added in §5.9)
  const client = compRegistry.create("client", { x: 0, y: 0 }, null);
  state.placeComponent(client);

  const economy = new TDEconomy({
    startingBudget: WAVE_1.startingBudget,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  const tdc = new TDModeController({
    waves: [WAVE_1, WAVE_2, WAVE_3],
    economy,
    entryPointId: client.id,
    rng: makeRng(1),
    componentRegistry: compRegistry,
  });

  // === Wave 1 build ===
  const placeServer = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
  expect(placeServer.ok).toBe(true);
  if (!placeServer.ok) throw new Error();   // narrowing
  const connect1 = tdc.tryConnect(state, client.id, placeServer.componentId);
  expect(connect1.ok).toBe(true);

  tdc.advancePhase(state);  // build → simulate
  runUntilDrained(state, tdc);
  tdc.advancePhase(state);  // simulate → assess
  const w1 = tdc.evaluateOutcome(tdc.getCurrentWaveMetrics(state));
  expect(w1.verdict).toBe("win");

  // Reconstruct economy for wave 2 (mirrors dashboard behavior)
  // ... etc for waves 2 and 3 ...
});

function runUntilDrained(state: SimulationState, tdc: TDModeController) {
  const engine = new Engine(state);
  let safety = 200;
  while (!tdc.isWaveDrained(state) && safety-- > 0) {
    engine.tick(tdc);
  }
  if (safety <= 0) throw new Error("wave did not drain within 200 ticks");
}
```

**Calibration expectation:** after §5.9's tuning, the registry path produces the **same** runtime behavior as the harness path. The headless campaign test should observe identical wave outcomes to the existing `wave-3-learning-arc` test for matched topologies. Specifically:

- Wave 1: lone Server passes (under the 30/tick reads at intensity 10).
- Wave 2: Server + Database with write routing passes.
- Wave 3: Server + Database alone *loses* (lone-server topology fails the 50/tick spike); Server + Cache + Database wins; Server + LB + Server + Database wins.

The campaign-headless test exercises the **winning** topology progression for each wave, ensuring the multi-wave plumbing works end-to-end. A separate test case (or an additional assertion) verifies the lone-server topology loses Wave 3 via the registry path, mirroring the assertion in `wave-3-learning-arc.test.ts`. Both paths must now agree.

### 7.3 Dashboard verification

Stage 3b's UI changes are DOM-based and not unit-tested directly. Manual verification per CLAUDE.md's UI-changes rule:

1. `pnpm dev` opens the dashboard
2. Toggle to TD mode, verify HUD renders Wave 1 / BUILD / $500
3. Place a Server, click entry-point Client to connect, click READY
4. Verify Wave 1 runs, charts update, toast appears, HUD advances to Wave 2
5. Repeat through Wave 3
6. Reset, verify campaign restarts cleanly
7. Toggle back to Sandbox, verify chaos panel + topology preset selector reappear and behave normally

The dashboard verification is documented in the implementation plan as a manual checklist; it does not gate `pnpm test`.

## 8. Risks and mitigations

**R1. Click-to-connect UX is fiddly.** Mitigation: keep it dumb — click source, click target, done. No drag, no pathfinding. If playtest reveals it feels bad, swap for a select-source-from-dropdown fallback in the same stage.

**R2. `register-td-defaults.ts` tuning may break the existing wave tests.** Mitigation: the wave tests bypass the registry entirely — they call `helpers.ts:buildServer` etc. which constructs `Component` instances with their own per-instance capability options. The registry factories are only touched by `compRegistry.validate()` (which validates phases / sub-interfaces, not numerics). The tuning change is verified by re-running `pnpm test` after the edit.

**R3. `advancePhase` signature change is contagious.** Mitigation: the new `state` parameter is **optional**. Stage 3a `runWave` calls `mode.advancePhase()` with no arguments — that path keeps working. Only the new dashboard sim loop and the new `campaign-headless` test pass `state`. Type-check: optional parameters with `exactOptionalPropertyTypes` must not be invoked with explicit `undefined` — see §5.2 call-site narrowing note.

**R4. Multi-wave `TDModeController` with single-wave back-compat shim is two code paths.** Mitigation: the constructor narrows once via `"waves" in options`, and from that point internal state is uniform (`waves: readonly TDWaveDefinition[]` even for single-wave callers). Only `componentRegistry` is conditionally a stub. The shim is ~10 lines.

**R5. `isWaveDrained` undercounts where requests can live.** Mitigation: the implementation walks `state.pending`, `state.blockedParents`, `state.activeStreams`, **and** `EngineBufferable.peekBuffered()` partitions. A unit test (`isWaveDrained` cases in the phase test file) seeds each scenario (blocked-parent, active stream, bufferable holding requests via `TestQueueCapability`) and asserts `isWaveDrained` stays false.

**R6. Dashboard mode toggle leaks state between sandbox and TD.** Mitigation: separate top-level state objects (`tdState`, `sandboxState`) in `main.ts`. The toggle swaps which one drives the renderer. No shared mutable references. The existing sandbox HUD code (which reads `economy.totalRevenue` etc.) lives in the sandbox branch only; the TD branch reads `tdController.economy.getBudget()`.

**R7. Component condition persistence across waves could quietly punish players.** Mitigation: dashboard explicitly resets every component's condition to 1.0 on `assess → build` (see §5.7). Headless `campaign-headless.test.ts` does the same so its assertions match dashboard behavior.

**R8. Stage 3a tests must continue to pass without modification.** Mitigation: §5.8's back-compat shim plus §5.4's `id` widening are the only signature touches. The §5.9 factory tuning changes default capability behavior but the wave tests bypass the registry, so they're unaffected. The four wave tests construct controllers via the single-wave shape, never call `tryPlace`/`tryConnect`, and never observe the new `currentWaveIndex` field. They should pass byte-identically.

**R9. `forwarding-pipe` capability id is a new surface.** Mitigation: it's a TD-internal id. Sandbox doesn't use it. The id namespace is per-`CapabilityRegistry` instance, so there's no collision with the sandbox `forwarding` factory in the parallel `bootstrapRegistries()` path. The id is registered alongside `forwarding` in `registerTDDefaults` and referenced by `CACHE_ENTRY` / `LOAD_BALANCER_ENTRY`.

## 9. Exit criteria

- All Stage 3a tests still pass (564 existing tests untouched, both wave-3-learning-arc topologies still produce their documented win/lose outcomes)
- New unit tests for `tryPlace`, `tryConnect`, multi-wave phase machine, self-counting traffic source all pass
- New `campaign-headless.test.ts` passes the full three-wave scripted run via the registry path
- `pnpm test` green, `pnpm typecheck` clean
- Manual dashboard verification checklist (§7.3) completed and reported
- No new files in `src/core/engine/` (Stage 3b is mode-layer + dashboard work, not engine work)
- CLAUDE.md updated under "Implementation status" to reflect Stage 3b completion + the new "Next" section pointing at Stage 3c candidates

## 10. Open questions deferred to Stage 3c

- **New waves and matching capability primitives.** Stage 3c is the right place to design Wave 4+ once we know which capability primitive will support each lesson:
  - **Auth wave** — needs a primitive that *rejects* unauthenticated requests instead of `AuthCapability`'s current pass-through. Probably a new INTERCEPT capability `AuthGate(requiredType: "auth_required") → DROP` or an opt-in `AuthCapability(rejectUnauthenticated: true)`.
  - **Rate-limit wave** — `RateLimitCapability` already DROPs on token exhaustion. Wave needs a burst pattern that exceeds Server capacity so the player learns "drop early to protect downstream." Most buildable of the three.
  - **Circuit-breaker wave** — needs chaos integration with TD waves so the player can experience flaky downstream and learn fail-fast.
- **Cross-wave budget carry-over.** Should leftover budget from Wave N persist into Wave N+1, or does each wave reset to its `startingBudget`? Stage 3b uses reset-per-wave to mirror existing helpers. Stage 3c can add carry-over once the design intent is decided.
- **Cross-wave condition persistence.** Stage 3b resets every component's condition to 1.0 between waves (see §5.7). Stage 3c may want condition to persist across waves once a "repair" or "maintenance" mechanic exists, so the player has a meaningful response to wear.
- **Registry-vs-harness construction unification.** Stage 3b's §5.9 fix made `registerTDDefaults` produce the same per-instance behavior as the helpers, but the helpers still bypass the registry entirely. Stage 3c could move `helpers.ts:buildServer` etc. to consume the registry for consistency (they currently exist as parallel construction paths).
- **Intra-wave satisfaction bar.** Mid-wave loss condition / lives. Best designed once the dashboard shows live wave feedback (which Stage 3b enables).
- **Campaign persistence.** Save / load campaign state across reloads.
- **Tier upgrades.** Spending budget to upgrade an existing component instead of placing a new one.
- **Multi-port disambiguation in `tryConnect`.** Components with multiple in-ports of different roles need explicit port selection in the click flow.
- **`TDModeController.tryPlace` reusing `disallowed_by_mode` for phase + allowlist failures.** The reason enum is conflating two failure modes (wrong phase vs. type not in current wave's allowlist). Acceptable for 3b — both produce a generic "you can't place that here" UI message — but Stage 3c may extend `PlacementResult.reason` with explicit variants if the failure messaging needs to differ.

## 11. Files touched

**New:**
- `src/dashboard/td-mode.ts`
- `tests/unit/td-mode-controller-place.test.ts`
- `tests/unit/td-mode-controller-connect.test.ts`
- `tests/unit/td-mode-controller-phase.test.ts` (covers `isWaveDrained` cases too)
- `tests/unit/td-traffic-source-self-counting.test.ts`
- `tests/integration/td/campaign-headless.test.ts`

**Modified:**
- `src/modes/td/td-mode-controller.ts` — multi-wave option shape, `tryPlace`/`tryConnect` real impl, multi-wave phase machine, back-compat shim, `isWaveDrained`, `getCurrentWaveMetrics`, `getCurrentWave`, `getCurrentWaveIndex`, `isCampaignComplete`, optional `state` param on `advancePhase`, mutable `economy` field with `setEconomy`
- `src/modes/td/td-traffic-source.ts` — `ticksGenerated` counter, `isExhausted`
- `src/modes/td/td-waves.ts` — widen `id: 1 | 2 | 3` to `id: number`
- `src/modes/td/td-component-entries.ts` — new `CLIENT_ENTRY`; `CACHE_ENTRY` and `LOAD_BALANCER_ENTRY` reference `forwarding-pipe` instead of `forwarding`
- `src/modes/td/register-td-defaults.ts` — TD-tuned factory options on `processing` / `forwarding` / `storage`; new `forwarding-pipe` factory; register `CLIENT_ENTRY`
- `src/core/registry/component-registry.ts` — add `tryCreate(type, position, zone): Component | null`
- `src/dashboard/main.ts` — mode toggle, TD wiring, TD HUD data sources separate from sandbox
- `src/dashboard/sim-loop.ts` — parameterize over `ModeController`, factor metrics-snapshot getter into a callback
- `src/dashboard/index.html` — TD HUD container, palette, READY button (hidden by default)
- `src/dashboard/styles.css` — minimal new element styles
- `CLAUDE.md` — implementation status update, new "Next" section pointing at Stage 3c

**Untouched (explicitly):**
- `src/core/engine/**` — no engine changes
- `src/capabilities/**` — no capability classes touched (only factory **options** in `register-td-defaults.ts`)
- `src/modes/td/td-economy.ts` — no API changes
- `src/modes/sandbox/**` — sandbox mode untouched
- `tests/integration/td/wave-1-launch-day.test.ts`, `wave-2-signups.test.ts`, `wave-3-traffic-spike.test.ts`, `wave-3-learning-arc.test.ts` — Stage 3a tests pinned; all four must pass byte-identically (they bypass the registry via `helpers.ts:buildServer/...`)
- `tests/integration/td/helpers.ts` — single-wave `runWave` path preserved via the back-compat shim

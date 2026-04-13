# Stage 3b — TD Mode Playable Loop (Design)

**Status:** Draft v2 (post cold audit, scope reduced)
**Author:** Normid + Claude
**Date:** 2026-04-12
**Predecessor:** [Stage 3a — Wave 1–3 Playable Slice](./2026-04-12-stage-3a-wave-1-3-playable-slice-design.md)

## Revision history

- **v1 (initial draft):** introduced Wave 4 (Auth) as a new mechanic alongside the playable loop. Cold-audit found Wave 4 is unbuildable with the current capability library (`AuthCapability` is a no-op pass-through; silent PASS-at-PROCESS drops are invisible to `evaluateOutcome`). Spec also misremembered several existing APIs (`tryPlace` signature, `state.placeComponent`, port direction literals, `TDWaveDefinition` field names, `TDEconomy` surface).
- **v2 (this draft):** Wave 4 cut — new-wave / new-mechanic work deferred to Stage 3c. Spec rewritten against the real APIs in the codebase. Stage 3b ships *only* the interactive playable loop for the existing Wave 1–3 learning arc.

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
export interface TDModeControllerOptions {
  // CHANGED: array of waves, not one
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
  private placementSerial = 0;           // for minting unique ComponentIds

  constructor(options: TDModeControllerOptions) {
    this.waves = options.waves;
    this.economy = options.economy;
    this.componentRegistry = options.componentRegistry;
    this.entryPointId = options.entryPointId;
    this.rng = options.rng;
    this.trafficSource = new TDTrafficSource({
      wave: this.waves[0]!,
      targetEntryPointId: options.entryPointId,
      rng: options.rng,
    });
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

**`Position` is a UI hint, not engine-meaningful.** The engine ignores `position` (no spatial routing). The dashboard uses it to render the component on the topology grid; tests can pass `{x: 0, y: 0}` for every placement without consequence.

**`tryConnect` flow:**

1. **Phase check.** Reject `wrong_phase` if `phase !== "build"`.
2. **Endpoint existence.** Reject `unknown_source` / `unknown_target` if either id is not in `state.components`.
3. **Port discovery.** Find first port on source with `direction === "egress"`. Reject `no_egress_port` if absent. Find first port on target with `direction === "ingress"`. Reject `no_ingress_port` if absent.
4. **Duplicate check.** If any existing connection has the same `(sourceComponentId → targetComponentId)` pair through these ports, reject `duplicate_connection`.
5. **Port capacity check.** If `sourcePort.connections.length >= sourcePort.capacity` or `targetPort.connections.length >= targetPort.capacity`, reject `port_capacity_exceeded`.
6. **Mint connection.** Generate a new `ConnectionId` (`` `td-conn-${++this.placementSerial}` `` cast as `ConnectionId`). Construct a `Connection` literal with the source/target endpoint pairs. Call `state.addConnection(conn)`.
7. **Update port state.** Push the new connection id into both `sourcePort.connections` and `targetPort.connections`. (Mirrors `tests/integration/td/helpers.ts:wire`.)
8. **Return.** `{ok: true, connectionId: conn.id}`.

**`isWaveDrained` flow:**

```ts
isWaveDrained(state: SimulationState): boolean {
  if (!this.trafficSource.isExhausted()) return false;
  for (const arr of state.pending.values()) {
    if (arr.length > 0) return false;
  }
  if (state.blockedParents.size > 0) return false;
  if (state.activeStreams.size > 0) return false;
  return true;
}
```

This walks every place a request can live between ticks: per-component pending queues (`state.pending` is `Map<ComponentId, Request[]>`), the SPAWN-blocked parent pool (`state.blockedParents`), and active long-lived streams (`state.activeStreams`). `state.stagedOutcomes` is asserted-empty between ticks by the engine itself, so we don't check it.

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

### 5.3 `TDTrafficSource` changes

**Current state** (`src/modes/td/td-traffic-source.ts`):
- `generate(tick: number): Request[]` checks `tick >= this.wave.duration` and short-circuits.
- The `tick` argument is the engine's global `state.currentTick`. For a single-wave session this is fine — `state.currentTick` starts at 0 and increments with each tick. For a multi-wave campaign with a single persistent state, `state.currentTick` is already ≥ 30 by the time Wave 2 starts, so the second source short-circuits immediately.

**Stage 3b changes:**

```ts
export class TDTrafficSource implements TrafficSource {
  // existing fields...
  private ticksGenerated = 0;

  generate(_tick: number): Request[] {
    if (this.ticksGenerated >= this.wave.duration) return [];
    this.ticksGenerated += 1;
    // ... existing per-tick generation logic ...
  }

  isExhausted(): boolean {
    return this.ticksGenerated >= this.wave.duration;
  }
}
```

The source becomes self-counting. The `tick` parameter is now ignored (kept for `TrafficSource` interface compatibility). Each new source instance starts at zero. This means a fresh `TDTrafficSource` for Wave 2 generates traffic correctly regardless of `state.currentTick`.

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

Implementation: on `assess → build` transition, the dashboard tears down `TDEconomy` and reconstructs it with the next wave's `startingBudget`. The controller does not own the economy lifecycle — the dashboard sim loop does, mirroring the per-wave economy construction in `tests/integration/td/helpers.ts:runWave`.

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
- `WAVE_1`, `WAVE_2`, `WAVE_3` — untouched (only `id` literal type widened).
- `evaluateOutcome` — untouched.
- All existing capabilities — untouched.
- `tests/integration/td/wave-1-launch-day.test.ts`, `wave-2-signups.test.ts`, `wave-3-traffic-spike.test.ts`, `wave-3-learning-arc.test.ts` — untouched. They use single-wave `TDModeController` construction and the harness `buildServer` / `buildDatabase` / `wire` shortcuts. Both paths must continue to work after Stage 3b's controller refactor (waves array + registry option).

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

### 5.9 `registerTDDefaults` extension

`registerTDDefaults` (`src/modes/td/register-td-defaults.ts`) currently registers capabilities and component entries into a `CapabilityRegistry` + `ComponentRegistry`. It already wires `processing/forwarding/monitoring/storage/caching/routing` capability factories and the four TD entries (`SERVER_ENTRY`, etc.).

**Stage 3b change:** none. `registerTDDefaults` works as-is. The capability factories it registers (which are general-purpose `ProcessingCapability` / `ForwardingCapability` instances) are what the dashboard's `tryPlace`-minted components will use. **This means dashboard-placed components do NOT carry the `handledTypes`/`throughputPerTier` tuning that `tests/integration/td/helpers.ts:buildServer` applies.**

**Implication for dashboard play:** a dashboard-placed Server uses the registry-default `ProcessingCapability` (default `canHandle: true`, default `tier*25` throughput, no PROCESSED events) and the registry-default `ForwardingCapability` (default `handledTypes: ["api_read", "api_write"]`, no throughput cap, no FORWARDED events). The TD-helper-built Server uses the tuned variants.

This is a **deliberate Stage 3b choice with a consequence we accept:** dashboard play will *not* exactly reproduce the headless wave-3-learning-arc test outcomes. The lone-server dashboard topology may *win* Wave 3 instead of losing it, because the registry-default Server is not capacity-throttled the same way. The "lone-server loses Wave 3" lesson is preserved in the headless test (which still uses the harness builders), but the dashboard player will see a more forgiving experience.

**Rationale:** unifying the harness-built and registry-built component construction is a Stage 3c project. It requires either (a) moving the tuned `handledTypes`/`throughputPerTier` configuration into the registry capability factories — which forces a decision about whether sandbox/dashboard wants the same tuning, or (b) introducing a TD-specific capability registry that overrides the defaults. Both deserve explicit design. Stage 3b ships the playable loop with the registry-default tuning and documents the gap.

The headless `campaign-headless.test.ts` introduced in Stage 3b (§7.2) **exercises the registry path**, so it will reflect the more-forgiving registry-default tuning. The wave-pass thresholds in the new test are tuned to that path.

## 6. Data flow — a campaign session

```
Page load
  → main.ts reads #mode=td from URL
  → main.ts constructs:
      - SimulationState (empty)
      - registry = new ComponentRegistry; capRegistry = new CapabilityRegistry
      - registerTDDefaults(capRegistry, registry)
      - economy = new TDEconomy({startingBudget: WAVE_1.startingBudget, revenuePerRequestType: WAVE_1.revenuePerRequestType})
      - Place a "client" entry-point component manually (or read it from a TD baseline topology helper)
      - tdController = new TDModeController({waves: [WAVE_1, WAVE_2, WAVE_3], economy, entryPointId: clientId, rng, componentRegistry: registry})
      - phase = "build", waveIndex = 0
  → renders empty topology + palette + HUD ($500, Wave 1, BUILD)

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
  → modal "Continue?" → player clicks → tdController.advancePhase(state) → assess → build, currentWaveIndex=1
  → dashboard tears down economy and reconstructs with WAVE_2.startingBudget=500
  → trafficSource swapped to WAVE_2's source
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

- **success** — first egress on source, first ingress on target, fresh connection added to `state.connections` with both endpoints' `port.connections` arrays updated
- **`wrong_phase`** — rejects during `simulate` / `assess`
- **`unknown_source` / `unknown_target`** — bogus ids rejected
- **`no_egress_port`** — Database has no egress in the TD entry shape (verify against `td-component-entries.ts:DATABASE_ENTRY`); attempting to connect FROM a Database rejects
- **`no_ingress_port`** — Client has no ingress; attempting to connect TO a Client rejects
- **`duplicate_connection`** — second connect of same `(source, target)` rejects
- **`port_capacity_exceeded`** — when `port.connections.length >= port.capacity`

**`tests/unit/td-mode-controller-phase.test.ts`** — multi-wave phase machine:

- starts in `build` phase, `currentWaveIndex` 0
- `advancePhase(state)` snapshots `waveStartMetricsIndex` on `build → simulate`
- `simulate → assess` does not advance `currentWaveIndex`
- `assess → build` advances `currentWaveIndex` and reconstructs `trafficSource` with the next wave
- `isCampaignComplete()` true after final `assess → build`
- single-wave construction (Stage 3a back-compat shim) works without `componentRegistry` in options
- `getCurrentWaveMetrics(state)` returns only metrics from `waveStartMetricsIndex` onward

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
import { makeRng } from "../helpers"; // path tbd

it("plays a 3-wave campaign through the registry path", () => {
  const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry();
  registerTDDefaults(capRegistry, compRegistry);

  // Seed entry-point Client manually
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

**Calibration expectation:** because the dashboard/registry path uses the *registry-default* capability tuning (not the harness-tuned `handledTypes`/`throughputPerTier`), wave-pass thresholds will be **more forgiving** than the existing `wave-3-learning-arc` test. The headless test asserts pass on each wave with the registry path. The lone-server lossy behavior is still pinned by the existing `wave-3-learning-arc` test which uses the harness builders. We do **not** try to make both paths agree in Stage 3b — see §5.9 rationale.

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

**R2. Registry-default vs harness-tuned tuning divergence (§5.9).** Mitigation: documented as an accepted Stage 3b limitation. The headless `campaign-headless` test pins the registry path; the existing `wave-3-learning-arc` test pins the harness path. Both stay green on different code paths. Stage 3c unifies them.

**R3. `advancePhase` signature change is contagious.** Mitigation: the new `state` parameter is **optional**. Stage 3a `runWave` calls `mode.advancePhase()` with no arguments — that path keeps working. Only the new dashboard sim loop and the new `campaign-headless` test pass `state`. Type-check: optional parameters with `exactOptionalPropertyTypes` need explicit handling — the implementation captures `state` only when defined and snapshots the index only on `build → simulate`.

**R4. Multi-wave `TDModeController` with single-wave back-compat shim is two code paths.** Mitigation: the constructor narrows once via `"waves" in options`, and from that point internal state is uniform (`waves: readonly TDWaveDefinition[]` even for single-wave callers). Only `componentRegistry` is conditionally a stub. The shim is ~10 lines.

**R5. `isWaveDrained` undercounts where requests can live.** Mitigation: the implementation walks `state.pending`, `state.blockedParents`, and `state.activeStreams`. A unit test (`isWaveDrained` cases in the phase test file) seeds a blocked-parent scenario and asserts `isWaveDrained` stays false.

**R6. Dashboard mode toggle leaks state between sandbox and TD.** Mitigation: separate top-level state objects (`tdState`, `sandboxState`) in `main.ts`. The toggle swaps which one drives the renderer. No shared mutable references.

**R7. Per-wave economy reconstruction is awkward (§5.7).** Mitigation: documented as deliberate. The dashboard sim loop owns the economy lifecycle, mirroring `tests/integration/td/helpers.ts:runWave`. Stage 3c can move ownership into the controller and add cross-wave budget carry-over.

**R8. Stage 3a tests must continue to pass without modification.** Mitigation: §5.8's back-compat shim plus §5.4's `id` widening are the only touches to existing files. The four wave tests construct controllers via the single-wave shape, never call `tryPlace`/`tryConnect`, and never observe the new `currentWaveIndex` field. They should pass byte-identically.

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
- **Registry-default vs harness-tuned tuning divergence.** Unify the two construction paths so dashboard play and headless tests see identical component behavior. Requires deciding whether sandbox wants the TD tuning (probably not).
- **Cross-wave budget carry-over.** Should leftover budget from Wave N persist into Wave N+1, or does each wave reset to its `startingBudget`? Stage 3b uses reset-per-wave to mirror existing helpers. Stage 3c can add carry-over once the design intent is decided.
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
- `src/modes/td/td-mode-controller.ts` — multi-wave option shape, `tryPlace`/`tryConnect` real impl, multi-wave phase machine, back-compat shim, `isWaveDrained`, `getCurrentWaveMetrics`, `getCurrentWave`, `getCurrentWaveIndex`, `isCampaignComplete`, optional `state` param on `advancePhase`
- `src/modes/td/td-traffic-source.ts` — `ticksGenerated` counter, `isExhausted`
- `src/modes/td/td-waves.ts` — widen `id: 1 | 2 | 3` to `id: number`
- `src/core/registry/component-registry.ts` — add `tryCreate(type, position, zone): Component | null`
- `src/dashboard/main.ts` — mode toggle, TD wiring
- `src/dashboard/sim-loop.ts` — parameterize over `ModeController`, factor metrics-snapshot getter into a callback
- `src/dashboard/index.html` — TD HUD container, palette, READY button (hidden by default)
- `src/dashboard/styles.css` — minimal new element styles
- `CLAUDE.md` — implementation status update, new "Next" section pointing at Stage 3c

**Untouched (explicitly):**
- `src/core/engine/**` — no engine changes
- `src/capabilities/**` — no capability changes
- `src/modes/td/td-economy.ts` — no API changes
- `src/modes/td/register-td-defaults.ts` — no changes
- `src/modes/td/td-component-entries.ts` — no changes
- `src/modes/sandbox/**` — sandbox mode untouched
- `tests/integration/td/wave-1-launch-day.test.ts`, `wave-2-signups.test.ts`, `wave-3-traffic-spike.test.ts`, `wave-3-learning-arc.test.ts` — Stage 3a tests pinned; all four must pass byte-identically
- `tests/integration/td/helpers.ts` — single-wave `runWave` path preserved via the back-compat shim

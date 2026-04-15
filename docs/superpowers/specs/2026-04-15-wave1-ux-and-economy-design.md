# Wave 1 UX pass + campaign economy retune — design

**Status:** Draft, awaiting review.
**Scope:** Phase 2 polish. Cross-cutting campaign economy change + Wave 1 onboarding UX + tutorial primitive.
**Surface:** Cyberpunk HUD (iso renderer) only. Classic dashboard TD mode is deprecated and no longer the default entry point.
**Ships in three slices:** A (economy core), B (UX), C (polish & VFX/SFX — roadmap only).
**Does not touch:** `src/core/`, `src/capabilities/`. Phase 1 engine-purity invariant is preserved.

---

## 1. Goals

Wave 1 is currently a cold drop: the player opens the dashboard, sees a technical briefing card (`10 req/tick · 100% read · TTL 10 · 30 ticks`), a palette of Server + Database, and no guidance on what anything does, what the goal actually is, or how close they are to failing. The game treats traffic like a statistics problem instead of an experience.

This pass addresses three gaps at once, using Wave 1 as the showcase for a template that extends to all 10 waves:

1. **First-time player onboarding.** A brand-new player has no idea what "Server" or "Database" mean in the game's vocabulary. Just-in-time component dossiers teach each component the first time it is unlocked — not per wave, not in a scripted tutorial sequence, but the moment the player reaches for a palette entry they haven't seen before.
2. **Wave-level clarity.** The current briefing is wordy and technical. It gets replaced with an abstracted, glanceable version using qualitative language ("A handful of readers", "Survive 30 ticks") and a 5-dot load meter instead of `req/tick`. Cyberpunk HUD aesthetic preserved.
3. **In-simulate legibility.** The player needs to feel the wave going well or badly in real time. A persistent viability meter (campaign-wide health pool, never refills) drains on failures so the player sees their mistake consequentially, not via a post-wave modal. Money goes up live as requests resolve (existing behavior, re-surfaced by the new HUD layout).

This pass also retunes the campaign economy model, because the new UX cannot sit on top of the old model without lying:

- **No more upfront component costs.** Components are rent, not capex — you pay per-wave for what you're currently running. Real-world realism; removes the "save up for an expensive thing" gating; adds real pressure on over-provisioning.
- **No more SLA pass/fail hard gate.** The current three-target SLA gate (availability ≥ X, latency ≤ Y, budget ≥ Z) is removed from the TD loss path. Ramping SLA failure is rerouted into viability damage. A wave "passes" when its duration elapses with viability > 0.
- **No more per-wave starting budget reset.** Budget carries across the campaign. Starting capital is a single `$600` at run start; every dollar after that is earned from a fulfilled request.
- **Viability as a campaign-wide health pool.** Starts at 100. Damaged by failures. Never refilled. Hits 0 → run over → restart from Wave 1.

## 2. Non-goals

- Updating the classic (non-iso) dashboard to match. Classic TD mode is marked deprecated and the main entry point redirects to the iso renderer. Classic code paths remain compiled for the sandbox mode and for safety, but are not polished.
- Engine changes. Phase 1 invariant is preserved — nothing in `src/core/` or `src/capabilities/` is modified. Per-tick upkeep is zeroed at the registry layer, not removed from the engine contract.
- VFX/SFX implementation. Money-pop text, component shake, audio, dossier animations — all deferred to the Slice C roadmap.
- Dossier content for components that do not appear in Wave 1. Only Server and Database get authored copy. The other 10 dossiers are roadmap tasks with the infrastructure (modal, NEW badge, store, first-click flow) already in place.
- Wave narrative beats for Waves 2–10. Authoring is a roadmap task; the schema ships in Slice B.
- Mercy / respawn modes. Death = full campaign restart. Alternative reset paths are roadmap items.
- In-simulate diagnostic overlays beyond the existing flash system. The existing `flashDrop` / `flashOverload` / `flashResponded` remain the primary mid-wave component feedback. Viability meter + live budget are the new high-level signals.

## 3. Architecture & boundaries

**Layer discipline.** All code changes live in `src/modes/td/` (economy core, viability, wave defs), `src/dashboard/` (HUD, main entry, loss/win modal copy), and `src/dashboard/td/` (briefing text, dossier, narrative). The engine (`src/core/`) and capabilities (`src/capabilities/`) are untouched — the `tests/unit/engine-pixi-isolation.test.ts` invariant stays green by construction.

**Viability lives in TD, not the engine.** Viability is a TD-mode-only concept. Other modes (sandbox) do not need it and the engine has no opinion on it. `TDModeController` owns the viability state; the HUD reads via a getter; nothing else in the codebase touches it.

**Upkeep stays in the engine — zeroed at the registry layer.** The engine still ticks `upkeepPaid` each tick. We set `upkeep: 0` on every TD component entry in `td-component-entries.ts`, so the per-tick deduction is a no-op. Existing upkeep-related tests are updated to reflect `upkeepPaid === 0` in TD runs, but the engine contract itself is unchanged and sandbox mode continues to exercise upkeep if it wants to.

**SLA evaluation stays in core — unused by TD.** `evaluateSLA` / `evaluateOutcome` in `src/core/` remain for sandbox mode and for any tests that exercise the SLA contract directly. `TDModeController` simply stops calling them as a gate, replacing the outcome decision with a viability-based one.

**Two pre-flights at READY.** The new `advancePhase` build→simulate transition runs two pre-flights in order:

1. **Rent check (hard-blocking, atomic).** Sums rent-per-wave for every currently placed component; compares to budget; if insufficient, returns `{ok: false, reason: "insufficient_rent", bill, budget}` and does NOT flip the phase. The dashboard interprets this and shows a "Scrap something or you can't run this wave" toast, staying in build phase.
2. **Topology validation (non-blocking, advisory).** Existing `validateTopology()` call landed in commit 190a997. Continues to run, continues to store errors in `_topologyErrors`, continues to be advisory — the engine can run a broken topology, it just drops requests. The dashboard reads `getTopologyErrors()` after `advancePhase` returns and displays any warnings. No phase revert needed (the phase already advanced successfully — the topology is just imperfect).

This distinction — rent is transactional, topology is advisory — is load-bearing and must be preserved through implementation.

**New files:**
- `src/modes/td/td-viability.ts` — `TDViability` class, damage rules, helpers
- `src/dashboard/td/briefing-text.ts` — pure `renderBriefing(wave)` and its sub-functions
- `src/dashboard/td/component-dossier.ts` — `ComponentDossierStore`, `DOSSIERS` map, `showDossier()`
- `src/dashboard/td/wave-narrative.ts` — `WAVE_NARRATIVES` keyed map

**Modified files (Slice A):** `td-economy.ts`, `td-mode-controller.ts`, `td-waves.ts`, `td-component-entries.ts`, `register-td-defaults.ts` (possibly), `tests/integration/td/helpers.ts`, most `tests/integration/td/*.test.ts` files.

**Modified files (Slice B):** `cyberpunk-hud.ts`, `cyberpunk-hud.css`, `briefing-card.ts`, `main.ts` (entry-point redirect + READY handler integration), `td/diagnose-wave.ts` (if the death-mode copy plugs into it).

## 4. Slice A — Economy core

Ships first, in isolation. The dashboard continues to render the old briefing / HUD / no viability meter until Slice B lands. Slice A is intentionally a pure mechanical retune: if it's green, the math works; Slice B then paints the result.

### 4.1 TDViability

New file `src/modes/td/td-viability.ts`:

```ts
export class TDViability {
  private current: number;
  private readonly max: number;

  constructor(initial = 100, max = 100) {
    this.current = initial;
    this.max = max;
  }

  get value(): number { return this.current; }
  get maxValue(): number { return this.max; }
  get fraction(): number { return this.current / this.max; }
  get isDead(): boolean { return this.current <= 0; }

  damage(amount: number): void {
    if (amount < 0) return;
    this.current = Math.max(0, this.current - amount);
  }
}
```

Wholly owned by `TDModeController` as a single instance for the campaign lifetime. Constructed in the controller's constructor at `100`. Exposed via `getViability(): Readonly<{ value: number; max: number; fraction: number; isDead: boolean }>`.

### 4.2 Damage rules

The controller's `onTickEnd` callback (already fired after every engine `tick()` in the TD `SimLoop` path) reads the latest `TickMetrics` and computes damage:

```ts
// Per-tick damage
const failureCount = tickMetrics.dropped + tickMetrics.timedOut;
const baseDamage = failureCount * wave.viabilityPerFailure;
viability.damage(baseDamage);

// Ramping penalty for sustained failure — rolling-3-tick drop rate
const rollingDropRate = this.computeRollingDropRate(3);
if (rollingDropRate > wave.dropThreshold) {
  viability.damage(wave.viabilityRampPenalty);
}

// Death check
if (viability.isDead) {
  this.terminalState = "dead";
  // advancePhase path will emit a terminal transition for the dashboard
}
```

- `wave.viabilityPerFailure` — number, e.g. Wave 1 = `0.1`. Each dropped/timed-out request does this much viability damage.
- `wave.viabilityRampPenalty` — number applied per tick while the rolling drop rate exceeds the wave's `dropThreshold`. Wave 1 = `0.5`. Models the "ramping financial penalty for breaking SLA" discussed during brainstorming, rerouted into viability instead of budget.
- `wave.dropThreshold` — already on `TDWaveDefinition`. Repurposed from "hard fail line" to "ramping penalty trigger line."

`computeRollingDropRate(n)` reads `state.metricsHistory` and averages the last `n` entries. Implementation detail; new private method on `TDModeController`.

### 4.3 Rent at READY

The new `advancePhase(state)` build → simulate branch, ordered pre-flights:

```ts
case "build": {
  if (state === undefined) {
    throw new Error("advancePhase(state) required for build→simulate transition");
  }

  // Pre-flight 1: rent check (hard block, atomic)
  const bill = this.computeRentBill(state);
  if (bill > this.economy.getBudget()) {
    return {
      ok: false,
      reason: "insufficient_rent",
      bill,
      budget: this.economy.getBudget(),
    };
  }
  this.economy.debit(bill);

  // Snapshot wave state
  this.waveStartMetricsIndex = state.metricsHistory.length;
  this.waveStartTick = state.currentTick;
  this.cachedState = state;

  // Pre-flight 2: topology validation (advisory, non-throwing)
  this._topologyErrors = validateTopology(
    state,
    this.waves[this.currentWaveIndex]!,
    this.entryPointId,
  );

  this.phase = "simulate";
  return { ok: true };
}
```

`advancePhase` return type gains a discriminated union: `{ok: true} | {ok: false, reason: "insufficient_rent", bill, budget} | {ok: false, reason: "campaign_complete"}`. Existing callers that ignore the return value continue to work for all but the build → simulate transition, where they must now handle the rent-blocked case.

`computeRentBill(state)` — new private method. Iterates `state.components`, looks up each component's registry entry in `this.componentRegistry`, sums `entry.rentPerWave ?? 0`. Pure function over state + registry. TD entries populate `rentPerWave`; sandbox entries leave it undefined and the sum treats missing values as zero.

### 4.4 Rent bill preview (for HUD)

New public method `getRentBill(state: SimulationState): number` — same logic as `computeRentBill`, exposed read-only for the HUD's "Next wave bill" counter. Also `getRentBillCanAfford(state: SimulationState): boolean` for disabling READY.

### 4.5 Registry entry field — additive only

`ComponentRegistryEntry` gains one new optional field: `rentPerWave?: number`. The existing `cost` field is **not** renamed and **not** touched — sandbox mode continues to treat it as an upfront placement cost exactly as it does today.

- TD entries in `td-component-entries.ts` set `rentPerWave: <N>` and leave `cost: 0` (no upfront — placement is free in TD mode).
- Sandbox entries in `src/core/registry/component-entries.ts` leave `rentPerWave` undefined and keep their existing `cost` values.
- `TDModeController.computeRentBill` reads only `rentPerWave`, treating missing values as `0`. Sandbox components that somehow end up in a TD simulation contribute zero rent — safe default.
- `SandboxModeController.tryPlace` (or wherever sandbox debits cost) reads only `cost` as it does today. No change to sandbox economy.

This additive approach is zero-risk for sandbox — not a single sandbox call site moves.

### 4.6 Income

`TDEconomy` credits per-tick from `tickMetrics.processed × wave.revenuePerRequestType`. If the current implementation already does this, no change — verify in implementation. If it does anything else (periodic bonus, per-wave top-up, etc.), strip those paths.

No per-wave starting-budget reset. `TDWaveDefinition.startingBudget` is kept on Wave 1 only. Waves 2–10 drop the field. `advancePhase` between waves does not touch `TDEconomy.budget`.

### 4.7 TDEconomy changes

- Remove any per-wave reset logic.
- Constructor takes initial budget (Wave 1 = `$600`).
- `credit(amount)`, `debit(amount)`, `getBudget()` stay.
- New `setViability(viability: TDViability)` or equivalent — or just leave viability on the controller, not the economy. **Decision:** viability lives on the controller, not the economy. Economy is money-only.

### 4.8 SLA gate removal from TD

`evaluateSLA` and `evaluateOutcome` (wherever they currently gate TD wave outcomes) are bypassed. The new wave outcome contract on `TDModeController`:

```ts
type TDTerminalState = "running" | "wave_passed" | "dead";

getTerminalState(): TDTerminalState
```

- `"running"`: wave is still ticking or in build phase
- `"wave_passed"`: wave duration elapsed (and drain complete for stream waves) AND viability > 0
- `"dead"`: viability reached 0 at any point (can happen mid-wave)

The dashboard's loss-modal and win-modal wiring polls `getTerminalState()` once per tick instead of reading `evaluateOutcome()`. The loss modal triggers on `"dead"`; the win modal triggers on `"wave_passed"`.

### 4.9 Per-tick upkeep removal (at the data layer)

Every TD entry in `src/modes/td/td-component-entries.ts` gets `upkeep: 0`. The engine still subtracts zero each tick. `state.metricsHistory[i].upkeepPaid` is always `0` for TD runs.

Integration tests that asserted `upkeepPaid > 0` are updated to assert `upkeepPaid === 0`. Tests that asserted budget decrements from upkeep are updated to expect no decrements from upkeep (only rent debits at advancePhase).

### 4.10 Wave definitions retune

New optional fields on `TDWaveDefinition`:

```ts
interface TDWaveDefinition {
  // ... existing fields ...
  readonly startingBudget?: number;          // Wave 1 only
  readonly viabilityPerFailure: number;      // required; Wave 1 = 0.1
  readonly viabilityRampPenalty: number;     // required; Wave 1 = 0.5
  // sla field is kept as a compile-time alias but ignored by TD. Eventually dropped.
}
```

Wave 1:
```ts
export const WAVE_1: TDWaveDefinition = {
  id: 1,
  name: "Launch Day",
  startingBudget: 600,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 30,
  ttl: 10,
  availableComponents: ["server", "database"],
  dropThreshold: 0.2,        // rolling drop rate that triggers ramp penalty
  revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
  keyPoolSize: 20,
  viabilityPerFailure: 0.1,
  viabilityRampPenalty: 0.5,
  // sla removed
};
```

Waves 2–10: each wave gets a first-pass `viabilityPerFailure` and `viabilityRampPenalty`, scaled so that late-wave failures bite harder than early-wave failures. Initial scaling (subject to playtest):

| Wave | viabilityPerFailure | viabilityRampPenalty | dropThreshold |
|------|---------------------|----------------------|----------------|
| 1    | 0.10                | 0.5                  | 0.20           |
| 2    | 0.12                | 0.7                  | 0.15           |
| 3    | 0.15                | 1.0                  | 0.10           |
| 4    | 0.18                | 1.2                  | 0.10           |
| 5    | 0.20                | 1.5                  | 0.08           |
| 6    | 0.22                | 1.8                  | 0.08           |
| 7    | 0.25                | 2.0                  | 0.07           |
| 8    | 0.28                | 2.2                  | 0.07           |
| 9    | 0.30                | 2.5                  | 0.05           |
| 10   | 0.40                | 3.0                  | 0.05           |

Rationale: Wave 1 values let a brand-new player fail a naked-Database topology (~300 drops over 30 ticks = 30 viability damage + maybe 15 ramp-penalty damage ≈ 45 total) and still have 55 viability left to recover. Wave 10 values punish mistakes severely enough that a player who limped through Waves 7–9 cannot also limp through Wave 10 — the meter bites late.

`startingBudget` stays on Wave 1 only. Waves 2–10 drop the field entirely. Any test that constructed a wave-def with a starting budget on a non-Wave-1 wave is updated.

### 4.11 Component rent values (first pass)

In `td-component-entries.ts`, every entry gets `cost: 0` (unchanged semantically — still the upfront sandbox field) and `rentPerWave: <N>`:

| Component        | rentPerWave |
|------------------|-------------|
| Client           | 0           |
| Server           | 80          |
| Database         | 80          |
| Cache            | 120         |
| Load Balancer    | 100         |
| CDN              | 150         |
| API Gateway      | 200         |
| Queue            | 80          |
| Worker           | 100         |
| Circuit Breaker  | 60          |
| DNS/GTM          | 200         |
| Streaming Server | 200         |
| Blob Storage     | 80          |

### 4.12 Wave 1 economy tuning sanity check

- Start: $600 budget, 100 viability
- Place Server ($80 rent) + Database ($80 rent) during build phase. Budget still shows $600. HUD shows "Next bill: $160".
- READY: pre-flight passes ($160 ≤ $600). Budget debited to $440. Phase advances to simulate.
- Wave runs: 30 ticks × 10 reads/tick × $1/read = $300 max revenue.
- End of Wave 1 (best case): **$740 budget, 100 viability**.
- Wave 2 start: same topology still placed. READY pre-flight: $160 ≤ $740. Budget debited to $580. Wave 2 runs...

Failure path: player naked-Databases Wave 1.
- Start: $600 budget, 100 viability
- Place Database only ($80 rent). READY: $520 remaining. Wave runs.
- Database cannot handle reads (`StorageCapability.canHandle` is writes-only for TD). All 300 reads get dropped.
- Damage: 300 × 0.1 = 30 viability + rolling drop rate quickly exceeds 20% → ~20 ticks × 0.5 ramp = 10 viability. Total: ~40 viability.
- End of Wave 1: $520 budget (no revenue — nothing served), 60 viability.
- Player learns, scraps Database, places Server + Database, tries again next run cycle — wait, they don't get a retry on the same wave by default. They proceed to Wave 2 with 60 viability and a budget of $520.
- Alternatively they can retry from scratch (back to Wave 1) manually.

**Open tuning question (decided in spec):** when a wave ends with `"wave_passed"`, the player automatically advances to the next wave's build phase — they cannot re-run Wave 1 for a better score. If they want a cleaner run, they restart the campaign. This is consistent with "viability is persistent" — you live with your scars.

## 5. Slice B — UX

Ships after Slice A is green. All changes in `src/dashboard/`, `src/dashboard/td/`, and the cyberpunk HUD CSS. Classic dashboard TD mode continues to work with the old briefing/HUD on the new Slice-A economy, but is marked deprecated and no longer the default entry point.

### 5.1 Entry-point redirect

`src/dashboard/main.ts`: at boot, if the URL hash is `#mode=td` but the query does not include `?renderer=iso`, the main function rewrites the URL to include `?renderer=iso` and continues. Effect: anyone entering TD mode gets the iso HUD, always. No user action required.

Classic TD paths are marked `/** @deprecated use ?renderer=iso */` at their entry points (e.g. the classic `createTDDashboard` function). A `console.warn` fires once if the classic TD path is taken (only possible now via programmatic calls).

### 5.2 Briefing redesign

New pure module `src/dashboard/td/briefing-text.ts`:

```ts
export interface BriefingDisplay {
  readonly title: string;         // "LAUNCH DAY"
  readonly narrative?: string;    // optional story beat for Wave 1+
  readonly load: {
    readonly dots: number;        // 1..5
    readonly label: string;       // "LIGHT" | "STEADY" | "HEAVY" | "PEAK" | "EXTREME"
  };
  readonly traffic: string;       // "A handful of readers"
  readonly objective: string;     // "Survive 30 ticks. Don't lose your foothold."
  readonly reward: string;        // "$1 per user served"
}

export function renderBriefing(wave: TDWaveDefinition): BriefingDisplay;
```

Sub-functions, each independently testable:

- `computeLoad(intensity: number): { dots; label }` — deterministic buckets: `≤15` = 1 LIGHT; `16–50` = 2 STEADY; `51–150` = 3 HEAVY; `151–500` = 4 PEAK; `501+` = 5 EXTREME.
- `describeTraffic(composition: ReadonlyMap<string, number>): string` — ordered rule table matching composition shape:
  - 100% `api_read` → "A handful of readers"
  - `api_read` + `api_write` (no other types) → "Readers and contributors"
  - contains `static_asset` → "Readers and asset traffic"
  - contains `auth_required` → "Sign-ins and reads"
  - contains `stream` → "Viewers tuning in"
  - contains `batch` → "Background jobs and reads"
  - fallback → "Mixed traffic"
- `describeObjective(wave: TDWaveDefinition): string` — Wave 1: `"Survive 30 ticks. Don't lose your foothold."` Later waves read from a mapping or a simple template.
- `describeReward(revenue: ReadonlyMap<string, number>): string` — dominant type + rate. `[["api_read", 1]]` → `"$1 per user served"`. Mixed → `"$1–$2 per user served"`.

`wave-narrative.ts` provides the optional narrative line:

```ts
export const WAVE_NARRATIVES: Record<number, string> = {
  1: "Your service just went live. A trickle of users is knocking.",
};
export function getNarrative(waveId: number): string | undefined;
```

### 5.3 Briefing card DOM (cyberpunk HUD)

`buildBriefingPanel` in `cyberpunk-hud.ts` is rewritten. The classic `#td-briefing` mirror pattern is dropped on the iso path — the HUD observes TDModeController state directly via a new `onWaveChange` hook in `main.ts`.

Layout (CSS-driven, no new sprites):

```
┌─────────────────────────────────────────┐
│ LAUNCH DAY                                                │
│ "Your service just went live. A trickle of users..."    │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━      │
│ ▸ INCOMING   ●○○○○  A handful of readers         │
│ ▸ OBJECTIVE  Survive 30 ticks. Don't lose your foothold. │
│ ▸ REWARD     $1 per user served                         │
└─────────────────────────────────────────┘
```

Title is ALL CAPS monospace (existing cyberpunk type). Narrative is italic, dimmer color. The dot meter is three filled/unfilled glyph characters (not images) styled with CSS. Rows are styled like the existing `cp-briefing-body` rows, just with different labels.

### 5.4 Component dossier system

`src/dashboard/td/component-dossier.ts`:

```ts
export class ComponentDossierStore {
  private seen: Set<string>;
  private static KEY = "td-dossiers-seen";

  constructor() {
    const raw = localStorage.getItem(ComponentDossierStore.KEY);
    this.seen = new Set(raw ? JSON.parse(raw) : []);
  }

  hasSeen(type: string): boolean { return this.seen.has(type); }
  markSeen(type: string): void {
    this.seen.add(type);
    localStorage.setItem(
      ComponentDossierStore.KEY,
      JSON.stringify([...this.seen]),
    );
  }
  clear(): void {
    this.seen.clear();
    localStorage.removeItem(ComponentDossierStore.KEY);
  }
}

export interface ComponentDossier {
  readonly title: string;
  readonly body: string;
  readonly wire: string;
  readonly handles: string;
  readonly tip?: string;
}

export const DOSSIERS: Record<string, ComponentDossier> = {
  server: {
    title: "SERVER",
    body:
      "Servers are the workhorses of your stack. They take a request from a user, do the work, and send a response back.",
    wire: "Client → Server → Database",
    handles: "Read requests (and writes, if forwarded to a Database)",
    tip: "You always need at least one. Without a Server in the read path, your users have nowhere to go.",
  },
  database: {
    title: "DATABASE",
    body:
      "Databases store your data. They accept writes from Servers and hold onto them for later reads. Databases don't answer user requests directly — they sit behind a Server.",
    wire: "Server → Database",
    handles: "Write requests forwarded from a Server",
    tip: "A Database alone can't serve users — it needs a Server in front of it to route reads.",
  },
  // roadmap: cache, load_balancer, cdn, api_gateway, queue, worker,
  // circuit_breaker, dns_gtm, streaming_server, blob_storage
};

export async function showDossier(
  type: string,
  rentPerWave: number,
): Promise<void>;
```

`showDossier` returns a `Promise` that resolves when the user dismisses the modal. Resolution triggers `markSeen(type)` and the palette's deferred placement intent.

### 5.5 Dossier modal DOM

```
┌─────────────────────────────────┐
│              SERVER                  ✕ │
│ ━━━━━━━━━━━━━━━━━━━━━━━ │
│                                          │
│        [static sprite / box]            │
│                                          │
│ Servers are the workhorses of your   │
│ stack. They take a request from a    │
│ user, do the work, and send a        │
│ response back.                          │
│                                          │
│ ▸ WIRE        Client → Server → DB  │
│ ▸ HANDLES     Read requests          │
│ ▸ RENT        $80 / wave                │
│ ▸ TIP         You always need at least │
│                one.                      │
│                                          │
│      [ GOT IT, PLACE IT ]             │
└─────────────────────────────────┘
```

The sprite is pulled from the iso renderer's atlas. If the atlas has a sprite registered for the component type, it is rendered as an `<img>` or a `<canvas>` that blits the atlas region. If no sprite is registered, fall back to a styled div with the component type name.

Modal is a full-overlay element with `role="dialog"`, focus-trapped, dismissible by Esc, X button, or the CTA. CTA text: `GOT IT, PLACE IT`.

All DOM construction uses `createElement` + `textContent`. No `innerHTML`. Matches existing dashboard pattern.

### 5.6 NEW badge + first-click interception

Palette button state on wave change:

```ts
for (const type of wave.availableComponents) {
  const button = this.paletteButtons.get(type);
  if (!button) continue;
  if (!dossierStore.hasSeen(type)) {
    button.classList.add("cp-palette-button--new");
  } else {
    button.classList.remove("cp-palette-button--new");
  }
}
```

CSS: `cp-palette-button--new::after` is a small absolute-positioned pulsing dot in the top-right corner. Pure keyframe animation, no JS ticker.

Click interception:

```ts
button.addEventListener("click", async (e) => {
  if (!dossierStore.hasSeen(type)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    await showDossier(type, getRentForType(type));
    dossierStore.markSeen(type);
    button.classList.remove("cp-palette-button--new");
    // Forward to the classic palette button click to enter placement mode
    classicButton.click();
  }
  // else: let the event fall through to the existing palette handler
});
```

The interception only fires on the first click per component type (across the entire install — it's `localStorage`-backed). After the player has seen a dossier, subsequent clicks go straight to placement.

### 5.7 Viability meter HUD

New element in `cyberpunk-hud.ts`, placed above the resources panel:

```
╔═════════════════════════════╗
║ VIABILITY   ████████░░  80%    ║
╚═════════════════════════════╝
```

Updated from the existing `onTickEnd` callback that the TD `SimLoop` already fires after every engine tick (no new polling timer). Reads `tdController.getViability().fraction` and writes the bar width + color class. Colors:
- `≥ 0.50`: green (`--cp-green`)
- `0.25 – 0.49`: amber (`--cp-amber`)
- `< 0.25`: red (`--cp-red`) + pulse keyframe

Implementation: a flex row with a label, a `<div>` bar containing a filled `<div>` whose `width` is set via `style.width = ${fraction * 100}%`, and a numeric readout.

### 5.8 Next wave bill counter

Added to the resources panel immediately below `BUDGET`:

```
BUDGET      $600
NEXT BILL   $160
PHASE       BUILD
```

`NEXT BILL` row is live-updated during build phase. Every place/scrap event fires a HUD refresh that calls `tdController.getRentBill(state)` and writes the result to the row. In simulate phase, the row is hidden (the bill has already been paid).

### 5.9 READY handler integration

`src/dashboard/main.ts` (or wherever the classic READY click is wired up) passes through the rent-check contract. Assumes a `showToast(msg: string)` helper exists on the cyberpunk HUD; if it does not, it is added as a small utility in Slice B — a fixed-position div that fades in, holds for 3 seconds, fades out. One toast at a time; subsequent calls replace the current one.

```ts
readyButton.addEventListener("click", () => {
  const result = tdController.advancePhase(state);
  if (!result.ok) {
    if (result.reason === "insufficient_rent") {
      showToast(
        `Rent due: $${result.bill}. You only have $${result.budget}.` +
        ` Scrap a component to reduce the bill.`,
      );
      return;
    }
    if (result.reason === "campaign_complete") {
      showCampaignCompleteModal();
      return;
    }
  }
  // Topology validation is advisory
  const errors = tdController.getTopologyErrors();
  if (errors.length > 0) {
    showToast(formatTopologyWarnings(errors));
    // Proceed anyway
  }
  // Phase is now simulate; sim loop will start ticking.
});
```

### 5.10 Loss modal (death)

Triggered when `tdController.getTerminalState() === "dead"` (viability reached 0).

- Title: `YOUR OPPORTUNITY WINDOW HAS CLOSED`
- Body (flavor): `"The market moved on. Your service couldn't keep up."`
- Existing `diagnose-wave` hint still runs and supplies an actionable line below the flavor.
- Primary CTA: `RESTART CAMPAIGN` (back to Wave 1). Not `Retry this wave` — deaths are persistent.
- Secondary (optional): `View stats` — shows summary. Roadmap if not already present.

### 5.11 Win modal (wave clear)

Triggered when `tdController.getTerminalState() === "wave_passed"`.

- Title: `WAVE {N} CLEAR`
- Body: `"Viability {V}% · Budget ${B}"`
- CTA: `NEXT WAVE →`
- For Wave 10 specifically, the CTA becomes `CAMPAIGN COMPLETE` and opens a different flow (scope: not in this spec, existing behavior preserved).

## 6. Slice C — Roadmap (not shipping in this pass)

Explicitly deferred. Every item listed here is tracked in the spec for discoverability but not implemented.

- **VFX pass:**
  - Money-pop floating text above the source component on `RESPONDED`, replacing or augmenting `flashResponded`.
  - Component shake tween on `DROPPED`, augmenting `flashDrop`.
  - Dossier animation (the static sprite plays an idle loop).
  - Viability meter low-pulse at `< 25%` is shipped in Slice B; finer animation (damage flash, heal flash) is deferred.
- **SFX subsystem:**
  - Thin Web Audio wrapper (`src/dashboard/audio/`).
  - Sound palette: "ka-ching" on served request, "thud/glitch" on dropped, "warning beep" on low viability, "death" stinger on run over, "wave-clear" fanfare.
  - Mute toggle + volume slider in HUD.
  - Browser autoplay policy handling (requires a user gesture to enable audio).
- **Remaining 10 component dossiers:** Cache, Load Balancer, CDN, API Gateway, Queue, Worker, Circuit Breaker, DNS/GTM, Streaming Server, Blob Storage. Author copy, register in `DOSSIERS`, cover with the existing first-click flow.
- **Wave narrative beats for Waves 2–10:** populate `WAVE_NARRATIVES`. Each narrative is authored as the wave's polish pass is done.
- **Mercy / respawn mode:** alternative to full campaign reset on death. Could be "respawn at last wave with 25% viability" or "3 lives per campaign." Reserved as a difficulty-flag hook.
- **Easy mode per-wave money infusion:** reverses the "per-wave organic only" decision via a difficulty setting. Brainstorming called this out explicitly as a future hook.
- **Dossier reset / re-access:** a debug-panel button that clears `td-dossiers-seen`; long-press or info-button on palette entries to re-open a dossier after being marked seen.
- **Classic dashboard TD mode removal:** once the iso renderer has been the confirmed surface for a stable period, delete the deprecated classic TD code paths entirely. Sandbox mode is unaffected.
- **In-simulate diagnostic overlay:** per-component live bottleneck indicators beyond the existing flash system (e.g., "Server is at 95% utilization," "Database queue depth: 12"). Currently out of scope — the existing flashes plus the viability meter are the Phase 2 signals.
- **Topology-error toast surfaces:** `getTopologyErrors()` is read by the dashboard but the toast formatting for each error kind is bare-bones. Polish pass.

## 7. Test strategy

### 7.1 Slice A test churn

Slice A touches most TD integration tests. The churn comes from three sources:

1. **SLA pass/fail → viability outcome.** Every test that asserted on the SLA gate (`runWave(...)` → checks `outcome.passed === true/false`) is updated to check `getTerminalState()` or a new helper. New helper signature:
   ```ts
   runWave(wave, state, controller, buildFn): WaveRunResult
   where WaveRunResult = { terminalState: "wave_passed" | "dead"; finalViability: number; finalBudget: number; }
   ```
2. **Starting budget assertions.** Tests that asserted on `economy.budget === wave.startingBudget` are updated to use the campaign-wide starting budget ($600) for Wave 1 and carryover for Waves 2+.
3. **Upkeep assertions.** Tests that asserted `upkeepPaid > 0` become `upkeepPaid === 0`. Tests that asserted budget decrements from upkeep become assertions that budget decrements from rent at the advancePhase boundary.

### 7.2 New unit tests

- `td-viability.test.ts` — construct, damage, isDead, clamp to 0, fraction math.
- `briefing-text.test.ts` — each sub-function (`computeLoad`, `describeTraffic`, `describeObjective`, `describeReward`) gets its own deterministic cases. `renderBriefing` integration covers each of the 10 waves against a hand-written expected `BriefingDisplay`.
- `component-dossier.test.ts` — `ComponentDossierStore` against a localStorage mock. `hasSeen`, `markSeen`, persistence across store re-creation, `clear`.
- `td-mode-controller-rent-preflight.test.ts` — build → simulate transition with sufficient/insufficient budget. Validates the discriminated union return and the atomic debit.
- `td-mode-controller-viability-damage.test.ts` — per-tick damage from drops and timeouts, ramp penalty trigger, `isDead` terminal transition.
- `wave-1-viability-loss.test.ts` — integration. Place only a Database, run Wave 1, assert viability drops to the expected range.
- `wave-1-viability-win.test.ts` — integration. Place Server + Database, run Wave 1, assert viability stays at 100 and `wave_passed` terminal state.

### 7.3 New integration tests (Slice B)

- **Dossier first-click flow** — JSDOM test driving the palette button click on a fresh localStorage, asserting the modal opens, asserting placement doesn't happen until the modal is dismissed, asserting `markSeen` persists, asserting a second click goes straight to placement.
- **Briefing render — Wave 1** — render briefing for Wave 1 and snapshot-assert the exact DOM structure and text content.

### 7.4 Play-test checklist

Pure human playtest, not automated. Run the cyberpunk HUD, play Wave 1 three times:

1. Fresh localStorage, naked-Database topology. Assert: dossiers appear, player understands mistake, viability drops to ~60, wave advances to Wave 2.
2. Fresh localStorage, Server + Database topology. Assert: dossiers appear for both, palette NEW badges clear after seeing each, wave passes at 100 viability, budget ends near $740.
3. Second run (localStorage persists). Assert: no dossiers appear, no NEW badges, straight to build phase. Place + READY works instantly.

Document observations in the follow-up work.

## 8. Tuning risks & unknowns

- **Viability scaling across 10 waves is untuned.** The table in §4.10 is a first pass. Playtest will almost certainly require re-tuning per wave. Expect this to be the majority of the work in the "follow-up tuning" pass after Slice A lands.
- **Wave 1 dossier copy might read wrong.** The prose in §5.4 is a first draft. A single review-pass of each dossier with a writer's eye is warranted.
- **Rent-at-READY timing may surprise the player.** The player will place components, see budget stay at $600, and then get surprised when $160 is taken at READY. The "Next bill: $X" counter in §5.8 is the mitigation — it must be visible enough during build phase to telegraph the coming debit. Playtest this specifically.
- **Death-to-Wave-1 restart may feel punishing.** The design accepts this risk for v1 but the Mercy Mode hook in §6 exists in case playtest says the punishment is too harsh for a teaching game.
- **localStorage persistence means a player can't re-see a dossier for Wave 1 on a second machine.** Mild concern — not blocking.
- **Sandbox regression risk from the `rentPerWave` additive field.** Low — sandbox ignores the new field entirely. But `computeRentBill` must be disabled (return 0) when called from a non-TD controller. Defensive.
- **Dashboard entry-point URL rewrite.** Changing the URL at boot is safe but users who bookmarked `#mode=td` will be silently redirected. Acceptable.

## 9. Open questions (tracked for implementation, not blocking design approval)

- Exactly which existing files contain the SLA-gate call site that TD currently uses. This determines whether we can delete the call site or must leave an unused branch.
- Exactly how the classic TD dashboard boots without iso — if we redirect on load, does the mirror pattern in `cyberpunk-hud.ts` still need the classic DOM elements to exist? If the classic DOM is never built, the mirror observers should no-op gracefully.
- Whether the iso renderer's sprite atlas exposes a public API for fetching a single component sprite. If not, the dossier modal falls back to the styled-box placeholder for v1 and the sprite integration becomes a polish-pass task.
- Whether `TDEconomy.debit` already clamps at zero or allows negative. Rent-at-READY needs the budget to NOT go negative — the pre-flight check prevents this, but a double-check in `debit` is cheap defensive.

## 10. Implementation slicing summary

**Slice A** (economy core, no UI): ships first. Green tests after this slice; the dashboard still renders the old briefing against new numbers.

**Slice B** (UX on top of A): ships second. Green tests after this slice; the dashboard is the new experience.

**Slice C** (VFX / SFX / polish): deferred. Roadmap only; nothing in this slice ships in the current pass.

Each slice gets its own implementation plan under `docs/superpowers/plans/` produced by the `writing-plans` skill after this design is approved.

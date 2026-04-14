# Stage 3c — Playable Polish: Find the Fun in Waves 1–3

**Date:** 2026-04-13
**Status:** Design
**Scope:** Turn the existing Wave 1–3 learning arc into a playable MVP that's fun to iterate on — introduce a Pixi-based topology renderer, visualize requests, and build the minimum teaching surfaces needed so a fresh player can actually learn the arc without a tutorial.

## Why this stage

Stage 3b shipped a mechanically complete 3-wave arc: placement, connections, real economy, win/loss verdicts, retry/reset. It passes its tests. It is not fun.

The gap is legibility. Players currently watch Chart.js bar graphs and stare at DOM rectangles labelled "server" while the engine ticks invisibly. There is no way to *see* a request in flight, no way to learn what a component does without reading source code, no way to understand why a wave was lost beyond "the toast said LOST."

Stage 3c closes that gap. We're not adding mechanics — we're making the mechanics we already have *playable*.

## North-star done-criteria

> A fresh player, given no tutorial, can win Waves 1–2 on first try, can lose Wave 3 once, read the diagnosis, change their topology, and win Wave 3 on second try — all without asking "what just happened" or "what does this component do."

This sentence is the scope fence. Every design decision below serves it. Anything that doesn't is out.

## Scope

### In

**Rendering layer**
1. Pixi.js v8 renderer for the topology canvas (components, connections, request dots, selection rings, overload pulses). DOM retains palette, HUD, briefing card, info panel, loss modal, Chart.js, buttons.
2. `TopologyRenderer` interface — dashboard depends on this, not Pixi directly. Future components and mechanics extend the interface; the Pixi implementation is the only consumer of `pixi.js`.

**Visualization**
3. Per-request dot visualization — one dot per forwarded request, animated along the connection it traversed, colored and shaped by request type.
4. Per-component utilization color lerp (green → yellow → red based on per-tick load).
5. One-frame red pulse on components when they drop a request.
6. Connection line opacity/thickness proportional to bandwidth utilization.

**Teaching surfaces**
7. Pre-wave briefing card — raw-spec presentation of the wave's traffic profile, budget, revenue table, and available components. No prescriptive advice.
8. Component info panel — persistent side panel, opens on click, shows real-world description, capability list, live per-tick stats.
9. Post-wave diagnosis — symptom-oriented readout in the loss modal (and a condensed version in the win toast).

**UX unblockers**
10. **Raise `SERVER_ENTRY.p-in.capacity` from 1 to 2** so Wave 3 cache-rescue (Client→Cache→Server plus direct Client→Server for writes) works without the 2-Server workaround. One-line fix to `src/modes/td/td-component-entries.ts`.

**Content**
11. Extend `ComponentRegistryEntry` with optional `longDescription?: string` and `capabilitiesHuman?: string[]` fields. Populate for all 5 TD component entries (Client, Server, Database, Cache, Load Balancer). Sandbox entries (14) are left untouched — the fields are optional.

### Out (not this stage)

- New waves or new mechanics (Auth / RateLimit / CircuitBreaker / scenario wave 4+).
- `tryUpgrade` real implementation (new verb, stays stubbed).
- Cross-wave budget carry-over or condition persistence.
- Particle effects, juice, screen shake, sound.
- Tutorial modals, "did you know?" popups, forced walkthroughs.
- Scenario save/load UX polish.
- Pixi-based rendering of DOM chrome (palette, HUD, modals stay DOM).
- Zoom / pan / minimap / camera (natural Pixi extensions, deferred until we need them).
- Migration of `tests/integration/td/helpers.ts:buildLoadBalancer` to `compRegistry.create` (Stage 3c-adjacent cleanup, deferred).

## Architecture

### The renderer interface

New file: `src/dashboard/render/topology-renderer.ts`. Defines `TopologyRenderer` as the *only* thing the dashboard knows about for visual topology state. The dashboard does not import `pixi.js`.

```ts
export interface TopologyRenderer {
  // ─ Lifecycle
  mount(container: HTMLElement): void;
  destroy(): void;
  resize(width: number, height: number): void;

  // ─ Components
  addComponent(id: ComponentId, visual: ComponentVisual): void;
  removeComponent(id: ComponentId): void;
  updateComponent(id: ComponentId, update: ComponentUpdate): void;

  // ─ Connections
  addConnection(id: ConnectionId, sourceId: ComponentId, targetId: ComponentId): void;
  removeConnection(id: ConnectionId): void;
  updateConnection(id: ConnectionId, update: ConnectionUpdate): void;

  // ─ Requests (fire-and-forget animations)
  spawnRequestDot(args: {
    connectionId: ConnectionId;
    requestType: string;
    durationMs: number;
  }): void;

  // ─ One-shot feedback
  flashOverload(id: ComponentId): void;
  flashDrop(id: ComponentId): void;

  // ─ Selection + placement preview
  setSelected(id: ComponentId | null): void;
  setPlacementGhost(type: string | null, screenPos: { x: number; y: number } | null): void;

  // ─ Input queries
  hitTest(screenX: number, screenY: number): { componentId: ComponentId } | null;
  screenToGrid(screenX: number, screenY: number): { x: number; y: number };

  // ─ Pointer events (delegated; returns unsubscribe)
  onPointerDown(cb: (ev: RendererPointerEvent) => void): () => void;
  onPointerMove(cb: (ev: RendererPointerEvent) => void): () => void;
}

export interface ComponentVisual {
  type: string;                          // 'server' | 'database' | ...
  displayName: string;
  gridPosition: { x: number; y: number };
}

export interface ComponentUpdate {
  utilization?: number;   // 0..1 → color lerp
  condition?: number;     // 0..1 → health ring
  pendingCount?: number;  // display
  gridPosition?: { x: number; y: number };
}

export interface ConnectionUpdate {
  loadUtilization?: number; // 0..1 → line opacity/width
}

export interface RendererPointerEvent {
  screenX: number;
  screenY: number;
  hit: { componentId: ComponentId } | null;
}
```

**Key invariant:** if we ever swap to another 2D library, the blast radius is one file (`src/dashboard/render/pixi-topology-renderer.ts`). Every other file speaks to `TopologyRenderer`.

### Pixi implementation

New file: `src/dashboard/render/pixi-topology-renderer.ts`. Implements `TopologyRenderer` using `pixi.js` v8.

Scene structure (Pixi containers, z-ordered low → high):
- `world` container (scaled by grid-cell size; origin at top-left)
  - `connectionsLayer` — `Graphics` for each connection (line + arrow)
  - `loadLayer` — `Graphics` for opacity overlay on loaded connections
  - `dotsLayer` — `Container` for in-flight request dots (pooled)
  - `componentsLayer` — `Container` per component (sprite + label + ring)
  - `selectionLayer` — `Graphics` for selection/hover rings
  - `ghostLayer` — `Graphics` for placement drag preview

Component visuals: simple `Graphics` primitives (rounded rect + label text) for MVP. No sprites / textures. Color comes from a per-type palette table. Utilization shifts the fill color via HSL interpolation. The "flash" methods push a one-frame alpha pulse via Pixi's ticker.

Request dots: pooled `Graphics` objects (pre-allocate 1000). On `spawnRequestDot`, grab one from the pool, set its start/end, push onto an active list with a start-time. Each ticker frame: lerp position along the connection based on `elapsed / durationMs`, free back to the pool at 1.0. Dot shape = small circle for reads, small square for writes, small triangle for stream_init — covers basic colorblind-friendly differentiation without a full shape library.

Pooling matters: Wave 3 peaks at 50 req/tick across multiple connections. 60fps dashboard + ~200ms dot travel time → ~1000 live dots steady-state worst case. Pool grows dynamically past 1000 with a console.warn.

### Feeding the renderer

Dashboard layer (`src/dashboard/main.ts` + `td-mode.ts`) no longer owns rendering. New thin adapter: `src/dashboard/render/state-to-renderer.ts`.

The adapter is called from `SimLoop.onTick`, *after* `engine.tick()` returns. At that point:
- `state.metricsHistory[last]` holds this tick's `TickMetrics` (recorded in step 8).
- `state.lastTickEvents` holds every `RequestEvent` emitted during this tick (see "Engine changes" below).
- Per-tick counters like `state.connectionLoadThisTick` have already been zeroed by step 9, so the adapter MUST read connection load out of `TickMetrics.perConnection` (also added — see below), not off the live state.

Adapter steps, per tick:
1. For each component `comp` in `state.components`, read `m = metrics.perComponent.get(id)` and compute `utilization = m.processed / Math.max(1, componentThroughputPerTick(comp))`, then call `renderer.updateComponent(id, { utilization, condition: m.condition, pendingCount: m.pendingAtEndOfTick })`. The dashboard imports `componentThroughputPerTick` from `@core/engine/throughput.js`. (No new field on `TickMetrics.perComponent` — utilization is derived.)
2. For each connection `conn` in `state.connections`, read `load = metrics.perConnection.get(connId)?.loadThisTick ?? 0`, derive `loadUtilization = load / getEffectiveBandwidth(state, connId)`, call `renderer.updateConnection(id, { loadUtilization })`. `TickMetrics.perConnection` is new — populated by `recordMetrics` from `state.connectionLoadThisTick` BEFORE step 9 clears it.
3. Walk `state.lastTickEvents`. For each event with `type === "FORWARDED" && connectionId !== null`, call `renderer.spawnRequestDot({ connectionId, requestType: /* derived from ev.metadata or request-type lookup */, durationMs })`. `durationMs` = `getEffectiveLatency(state, connectionId) * tickIntervalMs`. (Request type is in the `Request` object, not the `RequestEvent`; the adapter keeps a per-tick `Map<RequestId, string>` built from `ENTERED` events, which DO carry the request via the per-request context. Alternative: add `metadata.requestType` on FORWARDED events — simpler. Pick the `metadata.requestType` approach; single-line change in the two FORWARDED emit sites.)
4. For each `DROPPED` event with `componentId` set → `flashDrop(componentId)`. For each `OVERLOADED` event → `flashOverload(componentId)`. Both event types exist in `src/core/types/request.ts` and are actually emitted today (verified).

**Engine changes needed (three surgical additions):**

1. **`state.lastTickEvents: RequestEvent[]`** — new field on `SimulationState`, initialized to `[]`. `state.appendEvent()` pushes to both `requestLog` (existing, unbounded) AND `lastTickEvents` (per-tick view). In `Engine.tick()`, add `this.state.lastTickEvents.length = 0;` as the first statement of the method body — NOT inside any of the step files, just in the orchestrator. This guarantees the adapter (running after `tick()` returns) sees exactly this-tick's events. The very first tick's clear runs on an already-empty array; harmless. ~4 lines of code across `simulation-state.ts` and `engine.ts`.

2. **`TickMetrics.perConnection`** — new **optional** field: `perConnection?: ReadonlyMap<ConnectionId, { loadThisTick: number }>`. Populated inside `recordMetrics` by copying `state.connectionLoadThisTick` before step 9 clears it. Optional because four existing tests construct `TickMetrics` literals without the new field: `tests/unit/tick-metrics-shape.test.ts`, `tests/unit/mode-types.test.ts`, `tests/unit/sandbox-mode-controller.test.ts` (`makeEmptyMetrics`), `tests/unit/sandbox-metrics-snapshot.test.ts` (`makeFakeMetrics`). Making the field optional avoids touching all four. The adapter treats `undefined` as "no per-connection data" and skips connection load rendering for that tick — strictly rendering-layer degradation, no correctness impact. ~6 lines in `src/core/engine/metrics-builder.ts` and `src/core/types/metrics.ts`.

3. **`FORWARDED` event metadata** — both FORWARDED emit sites (in `deliverStaged.ts` and `ForwardingCapability.emitForwardedEvent`) add `metadata: { requestType: req.type }` to their events. ~2 lines.

Total engine surface change: ~12 lines across 4-5 files. Every change is additive; no existing test should need updating beyond a new unit test pinning the new contracts.

### Request dot mapping

Connection latency (in ticks) × dashboard tick interval (ms per tick) → dot travel time (ms). A 3-tick connection at 200ms/tick = 600ms traverse. This keeps the visuals honest with the simulation: faster connections have faster dots. Visual rhythm matches sim rhythm. When the player cranks the speed slider, dots fly proportionally faster.

### Component descriptions — extend the registry

`ComponentRegistryEntry` already has `name` and `description` (one-liner). Stage 3c extends it with two **optional** fields:

```ts
// added to the existing interface in src/core/registry/component-registry.ts
// (fields are optional so the 14 sandbox-only entries in component-entries.ts
// stay compilable without being touched — only the 5 TD entries need updating.)
longDescription?: string;        // 1-2 paragraph role explanation
capabilitiesHuman?: string[];    // human-readable capability bullets
```

Every TD component entry in `td-component-entries.ts` (Client, Server, Database, Cache, Load Balancer) populates both new fields. The 14 sandbox entries in `src/core/registry/component-entries.ts` are left untouched in Stage 3c — their entries are not consumed by the TD-mode info panel. A unit test asserts every TD entry has non-empty `longDescription` and `capabilitiesHuman`; sandbox entries are not asserted on.

Consumed by:
- Component palette (tooltip on hover — reads `description` from existing field)
- Component info panel (full content — reads `name`, `longDescription`, `capabilitiesHuman`)
- Pre-wave briefing (list of `availableComponents` rendered with `name` + `description`)

Real terminology per the CLAUDE.md principle: "cache" not "memory cache," descriptions that match what the player would encounter in real-world docs.

## Features — detailed design

### Feature 1: Pre-wave briefing card

A non-modal panel that appears on the build phase of each wave. Replaces the current `td-status` banner text for build phases.

Contents (Wave 3 example):
- **Wave 3 — "Traffic Spikes"**
- **Traffic:** 50 req/tick · 70% reads, 30% writes · TTL 8 ticks · Duration 30 ticks
- **Budget:** $600 starting · Revenue: $1 per read, $2 per write
- **Pass threshold:** Drop rate < 5%
- **Available components:** Server · Database · Cache · Load Balancer *(click for details)*

Zero prescriptive advice. The briefing is a *spec sheet* — raw numbers the player can reason about. The player decides what to build.

Rendered as a card pinned to the top of the topology viewport during build phase. Collapses to a one-line summary during simulate phase ("Wave 3 — running").

### Feature 2: Component info panel

Right-side panel, DOM-based, ~280px wide. Opens when the player clicks a component (or clicks a palette entry for a preview). Closes on outside-click or a close button.

Contents:
- **Header:** display name + type icon
- **Description:** `longDescription` from `COMPONENT_DESCRIPTIONS`
- **Capabilities:** bulleted list of `capabilities` strings
- **Live stats** (if an actual placed component is selected — not a palette preview):
  - Utilization this tick (processed / throughput budget)
  - Drops this wave
  - Pending queue depth
  - Current condition
  - Tier (for Stage 3c always 1)

Stats panel updates on every tick. No rerender of the description section — only the numbers change.

### Feature 3: Post-wave diagnosis

The loss modal currently shows `outcome.notes.join(" · ")`. Stage 3c adds a diagnosis section above it: a symptom-oriented readout derived from wave metrics.

New pure function signature:

```ts
diagnoseWave(args: {
  wave: TDWaveDefinition;
  metrics: readonly TickMetrics[]; // the wave's slice of metricsHistory
  components: ReadonlyMap<ComponentId, Component>;
  connections: ReadonlyMap<ConnectionId, Connection>;
}): Diagnosis;

export interface Diagnosis {
  headline: string;      // "Your Server was overwhelmed."
  symptom: string;       // "847 requests dropped at Server. Processing throughput was the bottleneck."
  hint: string | null;   // "Look at the component descriptions — what handles repeated reads?"
}
```

`connections` is required because the "write routing gap" branch needs to check whether the bottleneck component has any downstream path that can accept `api_write` — a graph reachability question.

Diagnosis logic for Stage 3c covers four cases (ordered by specificity — tests must assert branch selection with realistic multi-branch inputs, not just branches in isolation):

1. **Write routing gap:** `api_write` drops > 10% of wave total AND the bottleneck component has no `api_write`-accepting component reachable via egress walk → "Your server is trying to process writes but has nowhere to persist them." The reachability walk starts at the bottleneck, follows outbound `Connection.source.componentId → target.componentId` edges, and at each visited component iterates `comp.capabilities.values()` calling `cap.canHandle("api_write", ctx)` — `true` ends the walk with "reachable." `ProcessingCapability.handledTypes` is private; `canHandle()` is the only public probe.
2. **Process throughput bottleneck:** any component has `processed >= componentThroughputPerTick(comp) * 0.95` for ≥ 5 consecutive ticks AND `dropped / total > 0.05` → "Your Server was overwhelmed — it processed every tick at max throughput but traffic exceeded what it could handle."
3. **TTL timeouts:** sum of `requestsTimedOut` across the wave > 10% of total requests generated → "Requests piled up faster than they could drain. Your pipeline is under-provisioned."
4. **Default:** "Too many requests dropped. Check the per-component stats."

Hints are **symptom-adjacent, never solution-adjacent**. Never say "add a cache." Do say "look at the component descriptions — what handles repeated reads?" The player connects the dots.

Win path shows a condensed version in the existing toast: "Wave 3 cleared — 98% served, $420 revenue, $60 upkeep."

### Feature 4: Wave 3 cache-rescue unblocker (`SERVER_ENTRY.p-in.capacity: 1 → 2`)

Current blocker: Wave 3 cache-rescue topology is Client → Cache → Server, with writes going Client → Server direct. That requires TWO edges landing on Server's `p-in`, but `p-in.capacity` is 1, so the second `addConnection` rejects with `port_capacity_exceeded`. The Stage 3b workaround was "place a second Server." That makes the intended architectural lesson ("add a cache in front of your existing server") impossible to actually build.

Stage 3c fix: raise `SERVER_ENTRY.p-in.capacity` from `1` to `2` in `src/modes/td/td-component-entries.ts`. One line. No type changes, no new controller logic, no new UX surface.

Why not multi-port disambiguation? I audited the TD component registry: **no component has multiple ingress ports of different roles.** Every TD component has exactly one `p-in`. Multi-port disambiguation is a UX solution for a problem that doesn't exist in Stage 3c's component set. Adding it would be speculative complexity. When a future stage introduces a component with role-differentiated ingress ports (e.g. a Service Registry with `register` vs `query` ports), multi-port disambiguation becomes necessary and gets designed then.

Verification: after the capacity bump, the Wave 3 `tryConnect(Cache→Server)` followed by `tryConnect(Client→Server)` both succeed against the same `p-in`. The second edge uses port slot 2 instead of overflowing. An integration test (`tests/integration/td/wave-3-cache-rescue-single-server.test.ts`) builds the intended topology without the 2-server hack and asserts win.

### Feature 5 (cut): `state.placeComponent` auto-refresh

**Deferred to a later stage.** The intended cleanup was to move `recomputeVisitOrder` into `state.placeComponent` and delete the dashboard's explicit call. The benefit is one deleted line in `td-mode.ts`. The cost is that 39 call sites across 19 existing test files currently do `state.visitOrder.push(...computeVisitOrder(state.components))` AFTER `placeComponent`, and after the auto-refresh each of those produces a duplicated `visitOrder` array, causing double-iteration of components in `processPending` and friends. Fixing the tests requires either (a) deleting the redundant manual push at every site or (b) scripting a replacement. Either way the blast radius is bigger than the feature's value in Stage 3c, so this stays a Stage 3c-candidate for a later stage dedicated to engine-contract cleanup. Stage 3c leaves the dashboard's explicit `state.recomputeVisitOrder()` call in place.

### Feature 6: Visual details (low design depth)

- **Utilization color lerp:** component fill color interpolated HSL from `#22c55e` (green, util 0) → `#fbbf24` (yellow, 0.7) → `#ef4444` (red, ≥ 1.0). One pure function, one test.
- **Drop pulse:** one-frame alpha flash on the component sprite. Handled inside the Pixi renderer's ticker; no API beyond `flashDrop`.
- **Overload pulse:** same mechanism, different color.
- **Connection load opacity:** `opacity = 0.3 + 0.7 * loadUtilization`. Pure mapping.
- **Component health ring:** thin arc around each component, `arcLength = condition * 2π`. Updates on `updateComponent`.

## Testing strategy

### Unit tests (Vitest, added to existing suite)

- `diagnose-wave`: `tests/unit/diagnose-wave.test.ts` — 5 cases: each of the 4 branches fires on its happy-path input, AND a "specificity test" that feeds inputs matching multiple branches simultaneously and asserts the most-specific branch wins.
- `lastTickEvents retention`: `tests/unit/engine-last-tick-events.test.ts` — assert `state.lastTickEvents` is populated after each tick, clears at the start of the next, and contains the event types actually emitted in a representative minimal simulation.
- `TickMetrics.perConnection snapshot`: `tests/unit/metrics-per-connection.test.ts` — after one tick with traffic, `TickMetrics.perConnection.get(id).loadThisTick` matches the value `state.connectionLoadThisTick.get(id)` held DURING the tick.
- `FORWARDED metadata.requestType`: `tests/unit/forwarded-event-metadata.test.ts` — FORWARDED events carry `metadata.requestType` matching the originating request's type.
- `SERVER p-in capacity 2`: `tests/unit/server-port-capacity.test.ts` — assert `SERVER_ENTRY.ports.find(p => p.id === "p-in").capacity === 2`.
- `utilization color lerp`: `tests/unit/utilization-color.test.ts` — 3 points on the gradient (0, 0.7, 1.0) map to the expected HSL values.
- `component descriptions`: `tests/unit/component-descriptions.test.ts` — iterate the 5 TD entries (`CLIENT_ENTRY`, `SERVER_ENTRY`, `DATABASE_ENTRY`, `CACHE_ENTRY`, `LOAD_BALANCER_ENTRY`) imported directly from `td-component-entries.ts` and assert each has non-empty `longDescription` and `capabilitiesHuman`. Do NOT iterate `bootstrapRegistries()` — that registers the 14 sandbox entries, which intentionally stay un-populated.
- `engine-pixi isolation`: `tests/unit/engine-pixi-isolation.test.ts` — read `src/core/**` and `src/capabilities/**` source files from disk, assert none contains `"pixi"` as an import specifier. Uses the same `readFileSync`/`readdirSync` pattern as the existing `tests/unit/effective-latency.test.ts` grep invariant.

### Integration tests

- `campaign-headless.test.ts` already exists. Stage 3c modifies it in two ways: (a) add assertions that `state.lastTickEvents` contains expected event kinds on representative ticks (FORWARDED, PROCESSED); (b) rewrite the Wave 3 rescue topology to drop the `w3Server` second-Server hack. After the `SERVER_ENTRY.p-in` capacity bump (1→2), the rescue becomes `Client → Cache → w1Server` (cache lands on `p-in` slot 2, write path `Client → w1Server` retained from Wave 1 stays on slot 1). The `w3Server` placement and its connections get deleted from the test. Asserts Wave 3 still wins with the simpler topology. No new integration file.

### Manual testing

Renderer and UX cannot be unit-tested. Manual procedure, executed against the done-criteria sentence:

1. Boot a fresh dev server, open dashboard in TD mode, hash-reset.
2. Wave 1: place a Server, click READY. Expected: clear win, briefing made the target obvious.
3. Wave 2: place a Server, wire Client→Server, click READY. Expected: lose (writes drop).
4. Wave 2 retry: place a Database, wire Server→Database, click READY. Expected: win.
5. Wave 3 first attempt: click READY with Wave 2's topology. Expected: lose, diagnosis identifies Server as bottleneck, hint points at repeated-read handling.
6. Wave 3 second attempt: place Cache, wire Client→Cache and Cache→Server. The Client→Server write edge from step 4 is still there; the new Cache→Server edge lands in the second `p-in` slot (capacity is now 2, no picker). Click READY. Expected: win.

If any step fails, the done-criteria sentence does not hold and the stage is not done.

## Dependencies

- **New:** `pixi.js@^8.x` — runtime dep, Pixi v8 ships its own TypeScript types.
- Installed via `pnpm add pixi.js`. Bundled into the dashboard only (not the engine). Phase 1 engine scope is unchanged — `src/core/` and `src/capabilities/` must not import Pixi.

Invariant test (`tests/unit/engine-pixi-isolation.test.ts`): a grep over `src/core/**` and `src/capabilities/**` for `pixi` returns nothing. Runs in the normal Vitest suite. Non-negotiable — the engine must stay framework-agnostic.

## Migration plan (Pixi cutover)

Stage 3c does *not* keep the DOM topology renderer side-by-side. We replace it. Reasons: no value in maintaining two renderers, testing the renderer boundary requires using it, and the existing DOM renderer is ~100 lines we'd rather delete than port.

Execution order (engine plumbing FIRST so renderer slices have the data they need):

1. **Slice 1 — Engine plumbing (no Pixi yet).** All the pure engine/state changes: `state.lastTickEvents` field + write-through in `appendEvent` + clear at start of `Engine.tick`; `TickMetrics.perConnection` + snapshot in `metrics-builder.ts`; FORWARDED metadata requestType (both emit sites); `SERVER_ENTRY.p-in.capacity: 1 → 2`; `campaign-headless.test.ts` rewritten to use single-server Wave 3 rescue; extend `ComponentRegistryEntry` with optional `longDescription`+`capabilitiesHuman` and populate the 5 TD entries. All new unit tests for each land in this slice. After Slice 1, the engine is ready to feed a renderer — but the dashboard is unchanged.

2. **Slice 2 — Infrastructure.** `pnpm add pixi.js`. Create `TopologyRenderer` interface (includes `worldToScreen`, `screenToGrid`, `hitTest`, all pointer APIs) in `src/dashboard/render/topology-renderer.ts`. Add the `engine-pixi-isolation` invariant test. No implementation yet.

3. **Slice 3 — Pixi renderer + adapter.** Implement `PixiTopologyRenderer` against the interface. Implement `state-to-renderer.ts` adapter. Both remain unwired from the live dashboard in this slice; verification is limited to unit tests on pure helpers (color lerp, utilization math) and TypeScript compile. The renderer gets its first real exercise in Slice 4 when the dashboard cuts over to it. No throwaway preview entrypoint — Vite's config treats `src/dashboard/index.html` as the only input, so adding a secondary entry would require config changes we don't need.

4. **Slice 4 — Dashboard cutover.** Replace the DOM/SVG topology renderer in `td-mode.ts` with the new renderer + adapter. All click handlers route through `renderer.onPointerDown`/`screenToGrid`/`hitTest`. Delete the old SVG line code and the `.td-comp` DIV layout. Manual smoke test against the done-criteria sentence.

5. **Slice 5 — Teaching surfaces.** Pre-wave briefing card, component info panel, post-wave diagnosis. All DOM. Diagnosis pure function + its unit test live here. HTML/CSS additions for the panels.

6. **Slice 6 — Polish details.** Utilization color lerp, drop/overload flashes, connection load opacity, health ring. All inside the Pixi renderer. Unit test for color lerp.

7. **Slice 7 — Self-playtest and tuning.** Run the manual test procedure. If waves are too easy/too hard, tune `td-waves.ts` constants (intensity, threshold, budget) — not the design. Ship the stage.

Each slice ends with `pnpm test && pnpm typecheck` green.

## Risk register

- **Pixi v8 breaking changes.** Pixi v8 overhauled the API (v7 → v8). LLM training-era examples will be outdated. Mitigation: implementation plan explicitly calls out reading the v8 docs (https://pixijs.com/8.x/guides) for ticker, container hit-testing, and graphics API. Don't trust memory.
- **Pointer event mapping.** DOM click coordinates → Pixi world coordinates is a known hazard. Mitigation: isolate in `screenToGrid` / `hitTest`, unit test the pure math where possible, manual verify the interactive flow.
- **Dot pool sizing.** If Wave 3 produces more in-flight dots than the pool, we either drop dots or grow the pool. Mitigation: grow dynamically, log a console warning. The pool sizing is an engineering concern, not a correctness one.
- **Tuning churn.** The done-criteria sentence may reveal that Wave 3 is too easy or too hard once the player can actually *see* what's happening. Mitigation: Slice 7 is explicitly a tuning slice. Wave constants are data, not logic.
- **"Feel" is subjective.** Solo playtesting has zero feedback diversity. Mitigation: the done-criteria sentence is an explicit, falsifiable bar. If we hit it, we ship the slice. If we don't, we iterate on what's blocking it.

## Non-goals — restated for clarity

These are not in Stage 3c and should not creep in:

- A real `tryUpgrade`. Upgrades are out. The stub that throws stays a stub that throws.
- Cross-wave budget carry-over. Each wave still resets economy + condition.
- Pixi for DOM chrome (palette, HUD, modals). DOM stays DOM.
- Tutorial modals, walkthroughs, "did you know?" popups. Teaching happens through briefing + info panel + diagnosis, or not at all.
- Sound. Particles. Screen shake. Camera. Minimap. Zoom/pan.
- A web-worker engine. The engine stays on the main thread.

## Files touched (projected)

**New:**
- `src/dashboard/render/topology-renderer.ts`
- `src/dashboard/render/pixi-topology-renderer.ts`
- `src/dashboard/render/state-to-renderer.ts`
- `src/dashboard/render/utilization-color.ts`
- `src/dashboard/td/briefing-card.ts`
- `src/dashboard/td/component-info-panel.ts`
- `src/dashboard/td/diagnose-wave.ts`
- `tests/unit/diagnose-wave.test.ts`
- `tests/unit/engine-last-tick-events.test.ts`
- `tests/unit/metrics-per-connection.test.ts`
- `tests/unit/forwarded-event-metadata.test.ts`
- `tests/unit/server-port-capacity.test.ts`
- `tests/unit/utilization-color.test.ts`
- `tests/unit/component-descriptions.test.ts`
- `tests/unit/engine-pixi-isolation.test.ts`

**Modified:**
- `src/dashboard/main.ts` — wires renderer, briefing card, info panel; deletes DOM topology code.
- `src/dashboard/td-mode.ts` — replaces rerenderTopology with renderer-driven updates.
- `src/dashboard/index.html` — adds info panel, briefing card, extended loss modal containers.
- `src/dashboard/styles.css` — styles for new DOM surfaces.
- `src/core/state/simulation-state.ts` — adds `lastTickEvents` field, writes through from `appendEvent`.
- `src/core/engine/engine.ts` — clears `state.lastTickEvents` at start of `tick()`.
- `src/core/engine/metrics-builder.ts` — snapshots `state.connectionLoadThisTick` into `TickMetrics.perConnection`.
- `src/core/engine/deliver-staged.ts` — adds `metadata: { requestType: req.type }` to its FORWARDED emit.
- `src/capabilities/forwarding/forwarding-capability.ts` — adds `metadata.requestType` to its FORWARDED emit.
- `src/core/types/metrics.ts` — adds `perConnection` field to `TickMetrics`.
- `src/core/registry/component-registry.ts` — adds optional `longDescription` + `capabilitiesHuman` fields to `ComponentRegistryEntry`.
- `src/modes/td/td-component-entries.ts` — `SERVER_ENTRY.p-in.capacity: 1 → 2`; populates `longDescription`/`capabilitiesHuman` on all 5 TD entries.
- `tests/integration/td/campaign-headless.test.ts` — rewrites Wave 3 rescue topology to use a single Server (drops the `w3Server` hack), leveraging the new `p-in` capacity; adds `state.lastTickEvents` assertions.
- `package.json` — adds `pixi.js` dependency.

**Deleted:**
- The inline DOM topology rendering inside `src/dashboard/td-mode.ts:rerenderTopology` (SVG line drawing + `.td-comp` div layout).

## Open questions — resolved

- **Pixi v7 vs v8?** v8. Current, WebGPU-capable, not changing soon.
- **Canvas or WebGL?** Pixi picks automatically; we don't override.
- **Pool size for dots?** 1000 pre-allocated, grows dynamically if exceeded (console warns).
- **Dot fidelity — one per request or one per connection-tick?** One per forwarded request, driven by `state.lastTickEvents`.
- **Where does diagnosis live — engine or dashboard?** Dashboard (`src/dashboard/td/diagnose-wave.ts`). It's a presentation layer that consumes metrics, not an engine concern.
- **Do we migrate `buildLoadBalancer` to `compRegistry.create` in this stage?** No. Deferred.
- **Does the renderer need its own test suite?** No. Manual testing is sufficient for the rendering layer; unit tests cover the pure functions feeding it.
- **Why cut multi-port disambiguation?** No TD component currently has multiple ingress ports of different roles. The blocker multi-port was supposed to solve (Wave 3 cache-rescue) is actually fixed by a one-line capacity bump on `SERVER_ENTRY.p-in`. Speculative UX complexity cut.
- **Why `TickMetrics.perConnection` and not a live read?** `state.connectionLoadThisTick` is cleared in step 9 (end of tick), before `onTick` runs. Snapshotting preserves the value for the adapter.
- **Where does the adapter map `RequestId → requestType`?** FORWARDED events carry `metadata.requestType`. No per-tick map needed.

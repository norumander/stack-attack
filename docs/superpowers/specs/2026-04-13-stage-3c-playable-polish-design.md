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
10. Multi-port disambiguation in `tryConnect` — inline port picker when the target component has multiple compatible ingress ports.
11. Auto-refresh `state.visitOrder` inside `state.placeComponent` (so the dashboard's manual `recomputeVisitOrder` call on build→simulate becomes redundant but stays as a safety belt).

**Content**
12. Component description metadata — a single source of truth for display name, short description, and capability summary per component type.

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

Request dots: pooled `Graphics` objects (pre-allocate ~200). On `spawnRequestDot`, grab one from the pool, set its start/end, push onto an active list with a start-time. Each ticker frame: lerp position along the connection based on `elapsed / durationMs`, free back to the pool at 1.0. Dot shape = small circle for reads, small square for writes, small triangle for stream_init — covers basic colorblind-friendly differentiation without a full shape library.

Pooling matters: Wave 3 peaks at 50 req/tick across multiple connections. 60fps dashboard + ~200ms dot travel time → ~1000 live dots steady-state. Pre-pool sized for 5x headroom.

### Feeding the renderer

Dashboard layer (`src/dashboard/main.ts` + `td-mode.ts`) no longer owns rendering. New thin adapter: `src/dashboard/render/state-to-renderer.ts`.

Per tick, after the engine resolves:
1. For each component in `state.components`, read `metrics.perComponent.get(id)` and call `renderer.updateComponent(id, { utilization, condition, pendingCount })`.
2. Derive per-connection load from the same `perComponent` stats (we already have `bandwidthLoadThisTick` on connections) → `renderer.updateConnection(id, { loadUtilization })`.
3. Walk the per-tick `RequestEvent[]` (new — see next section) and for each `FORWARDED` event, call `renderer.spawnRequestDot({ connectionId, requestType, durationMs })` where `durationMs` scales with the connection's effective latency and the current sim-loop tick interval.
4. For each `OVERLOADED` event → `flashOverload`. For each `DROP` event → `flashDrop`.

**Engine change needed:** expose `state.lastTickEvents: readonly RequestEvent[]` populated by the tick loop. Currently events are held in local arrays during `deliverStaged` / `checkTTL` and discarded after metrics snapshot. We add a single write-through at the end of each tick step that accumulates events into `state.lastTickEvents` and clears at the start of the next tick.

This is a cheap addition — one array, one clear per tick. All engine code already emits events; only the retention changes. A unit test pins the new contract.

### Request dot mapping

Connection latency (in ticks) × dashboard tick interval (ms per tick) → dot travel time (ms). A 3-tick connection at 200ms/tick = 600ms traverse. This keeps the visuals honest with the simulation: faster connections have faster dots. Visual rhythm matches sim rhythm. When the player cranks the speed slider, dots fly proportionally faster.

### Component descriptions — single source of truth

New file: `src/core/registry/component-descriptions.ts`. A plain map:

```ts
export interface ComponentDescription {
  type: string;                 // 'server'
  displayName: string;          // 'Server'
  shortDescription: string;     // one sentence
  longDescription: string;      // 1-2 paragraph role explanation
  capabilities: string[];       // ['Processes API reads', 'Forwards writes to storage', ...]
  costHint: string;             // 'Base: $120 · Scales with tier'
}

export const COMPONENT_DESCRIPTIONS: ReadonlyMap<string, ComponentDescription>;
```

Consumed by:
- Component palette (tooltip on hover — small DOM tooltip)
- Component info panel (full content)
- Pre-wave briefing (list of `availableComponents` rendered as mini-cards)

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

New pure function: `diagnoseWave(wave, metricsHistory, components) → Diagnosis`.

```ts
export interface Diagnosis {
  headline: string;      // "Your Server was overwhelmed."
  symptom: string;       // "847 requests dropped at Server. Processing throughput was the bottleneck."
  hint: string | null;   // "Look at the component descriptions — what handles repeated reads?"
}
```

Diagnosis logic for Stage 3c covers four cases (ordered by specificity):

1. **Write routing gap:** `api_write` drops > 10% and no `api_write` target exists downstream of the bottleneck component → "Your server is trying to process writes but has nowhere to persist them."
2. **Process throughput bottleneck:** any component has sustained utilization ≥ 0.95 for ≥ 5 consecutive ticks and drops > 5% → "Your Server was overwhelmed — it processed every tick at max throughput but traffic exceeded what it could handle."
3. **TTL timeouts:** `TIMED_OUT` events > 10% of total → "Requests piled up faster than they could drain. Your pipeline is under-provisioned."
4. **Default:** "Too many requests dropped. Check the per-component stats."

Hints are **symptom-adjacent, never solution-adjacent**. Never say "add a cache." Do say "look at the component descriptions — what handles repeated reads?" The player connects the dots.

Win path shows a condensed version in the existing toast: "Wave 3 cleared — 98% served, $420 revenue, $60 upkeep."

### Feature 4: Multi-port disambiguation

Current contract: `tryConnect(state, sourceId, targetId)` picks the first matching ingress port on the target. Server's `p-in` has `capacity: 1`, so Wave 3 cache-rescue forces a second Server.

Stage 3c change:

```ts
tryConnect(
  state: SimulationState,
  sourceId: ComponentId,
  targetId: ComponentId,
  options?: { targetPortId?: PortId; sourcePortId?: PortId }
): ConnectResult;
```

When `targetPortId` is omitted, behavior is unchanged (first-matching). When provided, use that port explicitly and validate it.

Dashboard UX:
1. Player clicks source, then clicks target.
2. Dashboard calls a new `listCompatibleTargetPorts(state, sourceId, targetId)` helper which returns `{ portId, portName, capacityRemaining }[]`.
3. If length === 1, connect immediately (unchanged from Stage 3b).
4. If length > 1, show a small DOM popup anchored to the target component with a button per port. Player clicks a button → `tryConnect` with that `targetPortId`.
5. If length === 0, show the existing rejection toast.

This single change turns the cache-rescue topology from "requires the 2-server hack" into "click cache, click server, pick the p-cache port" — the intended topology works.

### Feature 5: `state.placeComponent` auto-refreshes visit order

Current contract: `state.placeComponent` does NOT call `recomputeVisitOrder`. The dashboard explicitly calls it on every build→simulate transition. This is a footgun — forgetting it makes newly placed components invisible to the engine.

Stage 3c change: `state.placeComponent` calls `state.recomputeVisitOrder()` at the end. The dashboard's explicit `recomputeVisitOrder` call on build→simulate is now redundant and gets deleted. Tests for `state.placeComponent` assert the new contract.

One-line fix. One new test. One deletion.

### Feature 6: Visual details (low design depth)

- **Utilization color lerp:** component fill color interpolated HSL from `#22c55e` (green, util 0) → `#fbbf24` (yellow, 0.7) → `#ef4444` (red, ≥ 1.0). One pure function, one test.
- **Drop pulse:** one-frame alpha flash on the component sprite. Handled inside the Pixi renderer's ticker; no API beyond `flashDrop`.
- **Overload pulse:** same mechanism, different color.
- **Connection load opacity:** `opacity = 0.3 + 0.7 * loadUtilization`. Pure mapping.
- **Component health ring:** thin arc around each component, `arcLength = condition * 2π`. Updates on `updateComponent`.

## Testing strategy

### Unit tests (Vitest, added to existing suite)

- `pure` diagnosis function: `tests/unit/diagnose-wave.test.ts` — 4 cases, one per diagnosis branch, plus a "default" case.
- `state.placeComponent auto-refresh`: `tests/unit/state-place-component-visit-order.test.ts` — assert `visitOrder` contains the new component after `placeComponent`.
- `tryConnect with targetPortId`: `tests/unit/td-mode-controller-connect-port.test.ts` — 3 cases: explicit port succeeds, invalid port rejected, omitted port preserves old behavior.
- `listCompatibleTargetPorts`: `tests/unit/list-compatible-target-ports.test.ts` — 3 cases: single port, multi-port, no compatible.
- `lastTickEvents retention`: `tests/unit/engine-last-tick-events.test.ts` — assert `state.lastTickEvents` is populated after each tick and cleared at the start of the next.
- `utilization color lerp`: `tests/unit/utilization-color.test.ts` — 3 points on the gradient.
- `component descriptions`: `tests/unit/component-descriptions.test.ts` — every registered component type has a description entry.
- `engine-pixi isolation`: `tests/unit/engine-pixi-isolation.test.ts` — `src/core/**` and `src/capabilities/**` do not import `pixi.js`.

### Integration tests

- `campaign-headless.test.ts` already exists. Add assertions that `state.lastTickEvents` contains expected event kinds on representative ticks. No new integration file.
- New integration: `tests/integration/td/multi-port-cache-rescue.test.ts` — wires the Wave 3 cache-rescue topology using the new `targetPortId` path without the 2-server workaround. Asserts win.

### Manual testing

Renderer and UX cannot be unit-tested. Manual procedure, executed against the done-criteria sentence:

1. Boot a fresh dev server, open dashboard in TD mode, hash-reset.
2. Wave 1: place a Server, click READY. Expected: clear win, briefing made the target obvious.
3. Wave 2: place a Server, wire Client→Server, click READY. Expected: lose (writes drop).
4. Wave 2 retry: place a Database, wire Server→Database, click READY. Expected: win.
5. Wave 3 first attempt: click READY with Wave 2's topology. Expected: lose, diagnosis identifies Server as bottleneck, hint points at repeated-read handling.
6. Wave 3 second attempt: place Cache, wire Client→Cache→Server. Multi-port picker appears for Server's ingress. Pick `p-cache`. Click READY. Expected: win.

If any step fails, the done-criteria sentence does not hold and the stage is not done.

## Dependencies

- **New:** `pixi.js@^8.x` — runtime dep, Pixi v8 ships its own TypeScript types.
- Installed via `pnpm add pixi.js`. Bundled into the dashboard only (not the engine). Phase 1 engine scope is unchanged — `src/core/` and `src/capabilities/` must not import Pixi.

Invariant test (`tests/unit/engine-pixi-isolation.test.ts`): a grep over `src/core/**` and `src/capabilities/**` for `pixi` returns nothing. Runs in the normal Vitest suite. Non-negotiable — the engine must stay framework-agnostic.

## Migration plan (Pixi cutover)

Stage 3c does *not* keep the DOM topology renderer side-by-side. We replace it. Reasons: no value in maintaining two renderers, testing the renderer boundary requires using it, and the existing DOM renderer is ~100 lines we'd rather delete than port.

Execution order (enforced by the implementation plan):

1. **Slice 0 — Infrastructure.** Install Pixi. Create `TopologyRenderer` interface. Create a trivial in-memory mock implementation used by dashboard tests (if we add any).
2. **Slice 1 — Pixi renderer + adapter.** Implement `PixiTopologyRenderer` against the interface. Implement `state-to-renderer.ts` adapter. Add `state.lastTickEvents`.
3. **Slice 2 — Dashboard cutover.** Replace the DOM topology renderer in `td-mode.ts` with the new renderer + adapter. All click handlers now route through `renderer.onPointerDown`. Delete the old SVG/DOM code. Manual smoke test: can place and connect components, can see request dots on click-READY.
4. **Slice 3 — Teaching surfaces.** Pre-wave briefing card, component info panel, post-wave diagnosis. All DOM.
5. **Slice 4 — Engine + controller changes.** `state.placeComponent` auto-refresh, `tryConnect` port option, diagnosis pure function.
6. **Slice 5 — Multi-port picker UX.** DOM popup anchored via `renderer.worldToScreen` (add this helper if missing).
7. **Slice 6 — Polish details.** Utilization color lerp, drop/overload flashes, connection load opacity, health ring.
8. **Slice 7 — Self-playtest and tuning.** Run the manual test procedure. If waves are too easy/too hard, tune `td-waves.ts` constants (intensity, threshold, budget) — not the design.

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
- `src/dashboard/td/multi-port-picker.ts`
- `src/core/registry/component-descriptions.ts`
- `tests/unit/diagnose-wave.test.ts`
- `tests/unit/state-place-component-visit-order.test.ts`
- `tests/unit/td-mode-controller-connect-port.test.ts`
- `tests/unit/list-compatible-target-ports.test.ts`
- `tests/unit/engine-last-tick-events.test.ts`
- `tests/unit/utilization-color.test.ts`
- `tests/unit/component-descriptions.test.ts`
- `tests/integration/td/multi-port-cache-rescue.test.ts`

**Modified:**
- `src/dashboard/main.ts` — wires renderer, briefing card, info panel; deletes DOM topology code.
- `src/dashboard/td-mode.ts` — replaces rerenderTopology with renderer-driven updates, adds multi-port picker flow.
- `src/dashboard/index.html` — adds info panel, briefing card, extended loss modal containers.
- `src/dashboard/styles.css` — styles for new DOM surfaces.
- `src/core/state/simulation-state.ts` — adds `lastTickEvents`, auto-calls `recomputeVisitOrder` in `placeComponent`.
- `src/core/engine/*.ts` — write events through to `state.lastTickEvents` at the end of each tick (one-line additions in `deliverStaged`, `checkTTL`, and maybe others).
- `src/modes/td/td-mode-controller.ts` — extends `tryConnect` with `options.targetPortId`, adds `listCompatibleTargetPorts` helper.
- `package.json` — adds `pixi.js` dependency.

**Deleted:**
- The inline DOM topology rendering inside `src/dashboard/td-mode.ts:rerenderTopology` (SVG line drawing + `.td-comp` div layout).

## Open questions — resolved

- **Pixi v7 vs v8?** v8. Current, WebGPU-capable, not changing soon.
- **Canvas or WebGL?** Pixi picks automatically; we don't override.
- **Pool size for dots?** 1000 pre-allocated, grows dynamically if exceeded.
- **Dot fidelity — one per request or one per connection-tick?** One per forwarded request, driven by `state.lastTickEvents`.
- **Where does diagnosis live — engine or dashboard?** Dashboard (`src/dashboard/td/diagnose-wave.ts`). It's a presentation layer that consumes metrics, not an engine concern.
- **Do we migrate `buildLoadBalancer` to `compRegistry.create` in this stage?** No. Deferred.
- **Does the renderer need its own test suite?** No. Manual testing is sufficient for the rendering layer; unit tests cover the pure functions feeding it.

# Physics Sim — Stage G (Renderer Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the demo from "works, but visually noisy" to "readable and game-feeling." Five focused improvements: two-lane edges (request below, response above), snake direction = away from first egress, cache slot chips on cache sprites, component utilization bars, and flash accumulation throttling.

**Architecture:** All changes are in the renderer + adapter. Sim core is untouched. Existing `TopologyRenderer` interface gets two small extensions (direction on addConnection; component update gains a few optional fields).

**Working directory:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`

**Stage E precondition:** Demo page works at `http://localhost:5173/sim-demo/physics-demo.html`. 117 unit tests + 6 integration tests passing. HEAD `5662b73`.

---

## File Structure

**Modified:**
- `src/dashboard/render/topology-renderer.ts` — extend `addConnection` with optional direction; extend `ComponentUpdate` with `cacheKeys?` and `utilization?`
- `src/dashboard/render/cyberpunk-topology-renderer.ts` — wire new fields
- `src/dashboard/render/cyberpunk/connection-layer.ts` — perpendicular offset by direction
- `src/dashboard/render/cyberpunk/component-layer.ts` — render cache chips + capacity bar
- `src/dashboard/render/cyberpunk/snake-layer.ts` — direction-aware trail orientation
- `src/dashboard/sim-demo/sim-to-renderer.ts` — register both connection directions; thread cache snapshots + utilization; flash batching window
- `src/dashboard/sim-demo/physics-demo.ts` — register back connections too
- `src/sim/capabilities/caching.ts` — expose `getSnapshot()` for renderer

---

## Task 1: Two-lane edges

**Files:**
- Modify: `src/dashboard/render/topology-renderer.ts` (addConnection signature)
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts`
- Modify: `src/dashboard/render/cyberpunk/connection-layer.ts` (perpendicular offset)
- Modify: `src/dashboard/sim-demo/physics-demo.ts` (register both directions)

Each twin pair becomes two visible lanes: forward direction renders below the natural axis, back direction above. Existing call sites (sandbox, TD dashboard) continue to work because the parameter is optional.

- [ ] **Step 1: Extend `addConnection` interface**

In `src/dashboard/render/topology-renderer.ts`:

```ts
addConnection(
  id: ConnectionId,
  sourceId: ComponentId,
  targetId: ComponentId,
  options?: { direction?: "forward" | "back" },
): void;
```

- [ ] **Step 2: Wire direction through CyberpunkTopologyRenderer**

In `src/dashboard/render/cyberpunk-topology-renderer.ts`, update the `addConnection` method body to forward the new arg to the connection layer (or store it on the connection state for later use).

- [ ] **Step 3: Apply perpendicular offset in connection-layer**

Read `src/dashboard/render/cyberpunk/connection-layer.ts` to understand how connection lines are drawn. The lane offset should be applied perpendicular to the edge axis. Suggested offset: 6px (configurable).

For a connection from `(x1,y1)` to `(x2,y2)`, perpendicular unit vector is `(-(y2-y1), (x2-x1)) / length`. Multiply by `±6` based on direction (`forward` = `-6`, `back` = `+6`, or vice versa — pick whichever reads better visually).

When drawing the line and any midpoint markers, shift by this offset.

For PacketLayer's spawned dots: dots are rendered along the connection. They need the same perpendicular offset so they ride the correct lane. Read packet-layer.ts to find where dot positions are computed (probably `lerp(source, target, progress)`) and add the per-direction offset.

If PacketLayer doesn't currently know about direction, it can look up the connection from the connection layer (or get the direction passed in via SpawnRequestDotArgs — extend that interface if needed).

- [ ] **Step 4: Bootstrap registers both directions**

In `src/dashboard/sim-demo/physics-demo.ts`, change:

```ts
for (const [id, conn] of sim.connections.entries()) {
  if (conn.direction !== "forward") continue;
  renderer.addConnection(id, conn.from.componentId, conn.to.componentId);
}
```

to:

```ts
for (const [id, conn] of sim.connections.entries()) {
  renderer.addConnection(id, conn.from.componentId, conn.to.componentId, { direction: conn.direction });
}
```

- [ ] **Step 5: Verify in browser**

Refresh the demo page. Each twin pair should now show two visibly-offset lanes. Forward packets ride one lane, response packets ride the other. No collision in the middle.

- [ ] **Step 6: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(render): two-lane edges — forward and back lanes visually separated"
```

---

## Task 2: Snake direction = away from first egress

**Files:**
- Modify: `src/dashboard/render/cyberpunk/snake-layer.ts` — accept a direction vector; orient trail accordingly
- Modify: `src/dashboard/render/topology-renderer.ts` — extend `updateClientSnake` signature to optionally accept direction
- Modify: `src/dashboard/sim-demo/sim-to-renderer.ts` — compute direction from client's first forward egress's target component position

The snake should trail AWAY from where the network is. We compute the unit vector from the client to its first forward-egress target, negate it, and lay sprites along that vector.

- [ ] **Step 1: Extend `updateClientSnake` signature**

In `src/dashboard/render/topology-renderer.ts`:

```ts
updateClientSnake?(
  clientId: ComponentId,
  packets: ReadonlyArray<{ id: string; type: string; count: number }>,
  options?: { trailDirection?: { dx: number; dy: number } },
): void;
```

`trailDirection` is a unit vector. If omitted, snake-layer uses leftward as before.

- [ ] **Step 2: Use the direction in snake-layer**

In `src/dashboard/render/cyberpunk/snake-layer.ts`, update the `update()` method to accept the direction option and use it for sprite positioning:

```ts
update(
  clientId: ComponentId,
  packets: ReadonlyArray<SnakePacket>,
  options: { trailDirection: { dx: number; dy: number } } = { trailDirection: { dx: -1, dy: 0 } },
): void {
  // ... existing setup
  for (let i = 0; i < visible.length; i += 1) {
    const sprite = state.sprites[i];
    if (!sprite) continue;
    const offset = (i + 1) * TRAIL_SPACING_PX;
    sprite.x = options.trailDirection.dx * offset;
    sprite.y = options.trailDirection.dy * offset - 8;
    // ... rest unchanged
  }
}
```

(Drop the hard-coded `-((i+1) * TRAIL_SPACING_PX)` and `-8`.)

- [ ] **Step 3: Update CyberpunkTopologyRenderer.updateClientSnake to thread the option**

```ts
updateClientSnake(clientId: ComponentId, packets: ReadonlyArray<{...}>, options?: {...}): void {
  this.snakeLayer?.update(clientId, packets, options ?? { trailDirection: { dx: -1, dy: 0 } });
}
```

- [ ] **Step 4: Compute direction in adapter**

In `src/dashboard/sim-demo/sim-to-renderer.ts`, when calling `updateClientSnake`, look up the first forward egress and the target component's grid position, compute the unit vector from client → target, and pass its negation as `trailDirection`.

The adapter doesn't currently have access to grid positions. Two options:
- (a) Pass positions into the adapter at construction and store them.
- (b) Use sim's connection topology only (find first forward egress's target ComponentId; ask renderer for its world position via `renderer.worldToScreen()` or similar).

Use (a) — cleaner and simpler. Update the adapter constructor:

```ts
constructor(
  private readonly sim: Sim,
  private readonly renderer: TopologyRenderer,
  private readonly positions: Map<ComponentId, { x: number; y: number }>,
) {}
```

Update `physics-demo.ts` to pass positions:

```ts
const adapter = new SimToRendererAdapter(sim, renderer, positions);
```

In `syncFrame`, compute direction per client:

```ts
for (const client of this.sim.clients.values()) {
  const clientPos = this.positions.get(client.id);
  let trailDirection = { dx: -1, dy: 0 };
  if (clientPos) {
    for (const conn of this.sim.connections.values()) {
      if (conn.from.componentId === client.id && conn.direction === "forward") {
        const targetPos = this.positions.get(conn.to.componentId);
        if (targetPos) {
          const dx = targetPos.x - clientPos.x;
          const dy = targetPos.y - clientPos.y;
          const len = Math.hypot(dx, dy);
          if (len > 0) trailDirection = { dx: -dx / len, dy: -dy / len };
        }
        break;
      }
    }
  }
  this.renderer.updateClientSnake?.(client.id, client.snake.map(...), { trailDirection });
}
```

- [ ] **Step 5: Update adapter test**

The adapter test boots without positions. Update `tests/unit/dashboard/sim-to-renderer-adapter.test.ts` to pass an empty `Map<ComponentId, {x,y}>` to the constructor.

- [ ] **Step 6: Run + commit**

```bash
pnpm test tests/unit/dashboard/ 2>&1 | tail -10
# expect all passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(render): snake trails away from client's first forward egress"
```

---

## Task 3: Cache slot chips

**Files:**
- Modify: `src/sim/capabilities/caching.ts` — add public `getSnapshot()` method
- Modify: `src/dashboard/render/topology-renderer.ts` — extend `ComponentUpdate` with `cacheKeys?: ReadonlyArray<string>`
- Modify: `src/dashboard/render/cyberpunk/component-layer.ts` — render chip strip
- Modify: `src/dashboard/sim-demo/sim-to-renderer.ts` — push cache snapshot per frame

Cache shows up to 8 chips below it, each labeled with the last 3 chars of the key hash. Front of array = most recent.

- [ ] **Step 1: Expose cache snapshot**

In `src/sim/capabilities/caching.ts`, add a public method:

```ts
getSnapshot(): { keys: ReadonlyArray<string> } {
  return { keys: [...this.slots] };
}
```

- [ ] **Step 2: Extend ComponentUpdate**

In `src/dashboard/render/topology-renderer.ts`:

```ts
export interface ComponentUpdate {
  utilization?: number;
  condition?: number;
  pendingCount?: number;
  gridPosition?: { x: number; y: number };
  cacheKeys?: ReadonlyArray<string>;
}
```

- [ ] **Step 3: Render cache chips in component-layer**

In `src/dashboard/render/cyberpunk/component-layer.ts`, add a `chipStrip` Container per component (lazy — only created when `cacheKeys` is first set on a component). Each chip is a small rounded rect with text.

Place the chip strip beneath the component sprite (e.g. `y = +24` in local coordinates). Chip width ~24px, gap 2px. Show up to 8 chips.

```ts
// In update() or wherever ComponentUpdate is applied:
if (update.cacheKeys !== undefined) {
  this.applyCacheKeys(state, update.cacheKeys);
}

// Helper:
private applyCacheKeys(state: ComponentState, keys: ReadonlyArray<string>): void {
  if (!state.chipStrip) {
    state.chipStrip = new Container();
    state.chipStrip.y = 24;
    state.container.addChild(state.chipStrip);
  }
  // Clear and repaint
  state.chipStrip.removeChildren();
  const visible = keys.slice(0, 8);
  for (let i = 0; i < visible.length; i += 1) {
    const x = (i - visible.length / 2) * 22;
    const chip = new Graphics().roundRect(-10, -6, 20, 12, 3).fill({ color: 0x223344, alpha: 0.85 });
    chip.x = x;
    const label = new Text({
      text: shortKey(visible[i]!),
      style: { fontFamily: "monospace", fontSize: 8, fill: 0xaadddd },
    });
    label.anchor.set(0.5);
    chip.addChild(label);
    state.chipStrip.addChild(chip);
  }
}
```

`shortKey(key)` returns the last 3 characters of the key string for compact display:

```ts
function shortKey(k: string): string {
  return k.length <= 3 ? k : k.slice(-3);
}
```

(Adjust to match the existing component-layer state shape — `state.chipStrip` is a new optional field; add it to the type definition.)

- [ ] **Step 4: Wire updateComponent path in cyberpunk renderer**

The existing `updateComponent` flow already accepts a `ComponentUpdate`. Make sure `cacheKeys` propagates through to the layer's `applyCacheKeys`. May not need any code change if the layer already merges all `ComponentUpdate` fields.

- [ ] **Step 5: Adapter pushes cache snapshot per frame**

In `sim-to-renderer.ts`, in `syncFrame`, scan components for CachingCapability and push the snapshot:

```ts
for (const [id, comp] of this.sim.components.entries()) {
  for (const cap of comp.capabilities) {
    // Detect by id rather than instanceof to avoid coupling
    if (cap.id === "caching") {
      const snapshot = (cap as unknown as { getSnapshot(): { keys: ReadonlyArray<string> } }).getSnapshot();
      this.renderer.updateComponent(id, { cacheKeys: snapshot.keys });
    }
  }
}
```

This runs every frame — fine for the demo's small cache.

- [ ] **Step 6: Verify in browser**

Refresh. The cache component should show a strip of small chips below it. Initially empty (cold cache); fills up as response packets pass through.

- [ ] **Step 7: Run tests + commit**

```bash
pnpm test tests/unit/sim/ tests/unit/dashboard/ 2>&1 | tail -5
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(render): cache slot chip strip — visible cache contents under cache component"
```

---

## Task 4: Component utilization bar

**Files:**
- Modify: `src/dashboard/render/cyberpunk/component-layer.ts` — render bar (the existing `updateComponent` already accepts `utilization?: number`; we just need to render it)
- Modify: `src/dashboard/sim-demo/sim-to-renderer.ts` — compute utilization per second window and push

`utilization: 0..1` already exists on `ComponentUpdate`. The cyberpunk renderer might already use it for color tint — confirm by reading the layer. If not, add a thin horizontal bar below the sprite that fills red as utilization approaches 1.

The adapter computes utilization as `requestsProcessedThisSecond / capacityPerSecond` using a rolling 1-second window over events.

- [ ] **Step 1: Confirm component-layer reads `utilization`**

Read `src/dashboard/render/cyberpunk/component-layer.ts`. Find usage of `update.utilization`. If it's already used (e.g. for tint), you can either:
- (a) Reuse: utilization affects existing visual.
- (b) Add: render a dedicated capacity bar below the sprite for clarity.

Pick (b) — explicit bar is more readable than tint:

```ts
private applyUtilizationBar(state: ComponentState, utilization: number): void {
  if (!state.utilBar) {
    state.utilBar = new Graphics();
    state.utilBar.y = 14;
    state.container.addChild(state.utilBar);
  }
  state.utilBar.clear();
  const u = Math.max(0, Math.min(1, utilization));
  const w = 28;
  const h = 3;
  // Background
  state.utilBar.rect(-w / 2, 0, w, h).fill({ color: 0x223344, alpha: 0.6 });
  // Fill — green → yellow → red
  const fillColor = u < 0.6 ? 0x4ade80 : u < 0.85 ? 0xfacc15 : 0xef4444;
  state.utilBar.rect(-w / 2, 0, w * u, h).fill({ color: fillColor, alpha: 0.95 });
}
```

Call this from `update()` when `update.utilization !== undefined`.

(Add `utilBar?: Graphics` to the component state type.)

- [ ] **Step 2: Compute utilization in adapter**

In `sim-to-renderer.ts`, maintain a rolling window of `(simTime, componentId)` for processed events (terminate + respond-delivered). Each frame, update each component with `utilization = recent count / capacityPerSecond`.

Simpler approach: per-component, track a 1-second sum:

```ts
private readonly recentProcessed: Map<ComponentId, { simTime: number; count: number }[]> = new Map();
```

In `syncFrame`, before updating components:

```ts
for (const ev of this.sim.lastStepEvents) {
  if (ev.kind !== "terminate" && ev.kind !== "respond-delivered") continue;
  const arr = this.recentProcessed.get(ev.componentId) ?? [];
  arr.push({ simTime: this.sim.simTime, count: 1 });
  this.recentProcessed.set(ev.componentId, arr);
}

const cutoff = this.sim.simTime - 1;
for (const [id, arr] of this.recentProcessed) {
  while (arr.length > 0 && arr[0]!.simTime < cutoff) arr.shift();
  const comp = this.sim.components.get(id);
  const cap = comp?.bucket ? this.bucketCapacity.get(id) : null;
  if (!cap) continue;
  const processed = arr.length;
  this.renderer.updateComponent(id, { utilization: Math.min(1, processed / cap) });
}
```

The `bucketCapacity` map needs to be built once at construction (sim doesn't currently expose `capacityPerSecond` but we can capture it from the SimComponent constructor option — easiest: store it during component registration in `physics-demo.ts` and pass to adapter).

Actually simpler: extend `SimComponent` to expose `capacityPerSecond` as a public readonly. Add:

```ts
// in src/sim/component.ts:
readonly capacityPerSecond: number | null;
constructor(opts: SimComponentOptions) {
  // ... existing
  this.capacityPerSecond = opts.capacityPerSecond ?? null;
}
```

Then adapter just reads `comp.capacityPerSecond` directly.

- [ ] **Step 3: Verify in browser**

Refresh. Components with `capacityPerSecond` (server, db) should show utilization bars. Server (no cap → null) shows nothing. DB at 30/sec should show ~5/30 = ~17% (most reads are cached) — bar mostly empty.

- [ ] **Step 4: Run tests + commit**

```bash
pnpm test tests/unit/sim/ tests/unit/dashboard/ 2>&1 | tail -5
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(render): component utilization bar (rolling 1s window)"
```

---

## Task 5: Flash accumulation throttling

**Files:**
- Modify: `src/dashboard/sim-demo/sim-to-renderer.ts` — buffer drop/revenue events into 200ms windows
- Test: `tests/unit/dashboard/sim-to-renderer-adapter.test.ts` — add throttling test

At Wave 10 intensities (or even Wave 5), `flashResponded`/`flashDrop` could fire many times per second per component. Batching into ~200ms windows keeps signal density without strobing.

Implementation: per (componentId, kind) bucket, accumulate event counts. Every 200ms (in `syncFrame` based on a simple wall-clock tracker), flush buckets — emit one flash per (componentId, kind) with intensity proportional to accumulated count (or just one flash regardless of count, with the count surfaced via flash visual size if the renderer supports it).

For Stage G MVP, emit **at most one flash per (componentId, kind) per 200ms window**. This caps flash frequency at 5/sec per component-kind pair, which is plenty.

- [ ] **Step 1: Modify adapter**

In `src/dashboard/sim-demo/sim-to-renderer.ts`, add per-component throttle state:

```ts
private readonly lastFlashAt: Map<string, number> = new Map(); // key = `${componentId}:${kind}`
private readonly flashWindowMs = 200;
```

Replace the inline flash dispatch with a throttled call:

```ts
private maybeFlash(componentId: ComponentId, kind: "drop" | "responded"): void {
  const key = `${componentId}:${kind}`;
  const now = performance.now();
  const last = this.lastFlashAt.get(key) ?? 0;
  if (now - last < this.flashWindowMs) return;
  this.lastFlashAt.set(key, now);
  if (kind === "drop") this.renderer.flashDrop(componentId);
  else this.renderer.flashResponded(componentId);
}
```

Update the event-handling loop:

```ts
for (const ev of this.sim.lastStepEvents) {
  if (ev.kind === "drop") this.maybeFlash(ev.componentId, "drop");
  else if (ev.kind === "terminate" || ev.kind === "respond-delivered") {
    this.maybeFlash(ev.componentId, "responded");
  }
}
```

- [ ] **Step 2: Add test**

In `tests/unit/dashboard/sim-to-renderer-adapter.test.ts`, add a test that pushes 10 drop events in succession via `sim.lastStepEvents.push(...)` then calls `syncFrame()` 10 times rapidly. The MockRenderer should record at most ~1-2 dropsFlashed calls (depends on whether the test runs fast enough to be within 200ms).

Actually, since the throttle is wall-clock-based via `performance.now()`, the test is hard to make deterministic. Instead, expose a `flashWindowMs` option on the adapter and set it to 0 for the existing tests (no throttle), then add a separate test with a known window:

```ts
it("throttles flashes within the window", () => {
  const { sim } = boot();
  const renderer = new MockRenderer();
  const adapter = new SimToRendererAdapter(sim, renderer, new Map(), { flashWindowMs: 1000 });
  // Push 5 drop events on the same component
  for (let i = 0; i < 5; i += 1) {
    sim.lastStepEvents.push({ kind: "drop", componentId: "b" as ComponentId, reason: "x", count: 1 });
  }
  adapter.syncFrame();
  // First syncFrame fires once (window starts)
  expect(renderer.dropsFlashed).toEqual(["b"]);
  // Second syncFrame within window — no new flash
  for (let i = 0; i < 5; i += 1) {
    sim.lastStepEvents.push({ kind: "drop", componentId: "b" as ComponentId, reason: "x", count: 1 });
  }
  adapter.syncFrame();
  expect(renderer.dropsFlashed).toEqual(["b"]);
});
```

(Update existing tests to either pass `flashWindowMs: 0` if needed, or accept that they'll see only one flash per component within the test's wall-clock duration.)

The existing `flashDrop` test just pushes one event and expects one flash — that still passes regardless of throttle.

- [ ] **Step 3: Constructor signature change**

```ts
export type SimToRendererAdapterOptions = {
  readonly flashWindowMs?: number;  // default 200
};

constructor(
  private readonly sim: Sim,
  private readonly renderer: TopologyRenderer,
  private readonly positions: Map<ComponentId, { x: number; y: number }>,
  options: SimToRendererAdapterOptions = {},
) {
  this.flashWindowMs = options.flashWindowMs ?? 200;
}
```

`physics-demo.ts` doesn't need to change (uses default).

- [ ] **Step 4: Run + commit**

```bash
pnpm test tests/unit/dashboard/ 2>&1 | tail -10
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(dashboard): flash accumulation throttling — 200ms window per component-kind"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full test regression**

```bash
pnpm test tests/unit/sim/ tests/unit/dashboard/ tests/integration/sim/ 2>&1 | tail -10
```

Expected all green.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: only pre-existing noise.

- [ ] **Step 3: Manual browser verification**

Refresh the demo. Verify:
- Two visible lanes per twin pair (forward below, back above)
- Snake trails AWAY from the network (off-screen left for the linear topology)
- Cache shows chips of currently-cached keys, building up as response packets pass through
- DB shows a utilization bar (~17% filled in steady state)
- Flashes feel "rhythmic" not "strobing" — at most one flash per component every 200ms

- [ ] **Step 4: No commit (verification only)**

---

## Completion

Stage G ships:
- Two-lane edges (forward/back visually separated)
- Snake direction = away from first egress
- Cache slot chips
- Component utilization bar
- Flash accumulation throttling

After this, the demo is "game-feeling." Next plans are 4b (Waves 6-10 with new capabilities) or Plan 6 (switchover + delete old engine).

## Self-review notes

- All five tasks are renderer/adapter changes. Sim core untouched.
- `addConnection` and `updateClientSnake` get optional new params — existing call sites unchanged.
- `SimComponent.capacityPerSecond` becomes public — minor breaking change but no caller depends on it being private.
- `CachingCapability.getSnapshot()` is a new public method — additive.
- Flash throttling makes one of the existing adapter tests still pass because it pushes only one event before checking, but a new test covers the throttle behavior with multiple events.
- LB split-burst animation is intentionally NOT in this plan — the demo doesn't have an LB topology yet. Add it when Plan 4b or a follow-up demo introduces LB.

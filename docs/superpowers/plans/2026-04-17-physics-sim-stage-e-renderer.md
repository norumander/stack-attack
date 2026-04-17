# Physics Sim — Stage E (Iso Renderer Integration MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the physics sim visible. Wire `src/sim/` into the existing iso renderer (`CyberpunkTopologyRenderer`) via a new adapter, a minimal HTML entry point, and a browser-side fixed-step driver. At the end, `pnpm dev` + navigate to `/physics-sim.html` shows a Wave-3-cache-rescue topology with packets animating, snake trailing behind the client, and drop/revenue flashes.

**Architecture:** One-way dependency: sim → adapter → renderer. The adapter subscribes to sim.activePackets each frame, maintains a packet→dot mapping, and calls existing `TopologyRenderer` methods (`spawnRequestDot`, `flashDrop`, `flashResponded`). One small extension: `updateClientSnake` method on `TopologyRenderer` for the diegetic queue behind clients. Browser driver runs `requestAnimationFrame` with an accumulator that drains wall-clock delta in fixed 1/60s sim steps.

**Tech Stack:** TypeScript, Pixi v8, Vite. No changes to the existing sandbox/TD dashboard. Everything new goes under `src/dashboard/sim-demo/` with a separate Vite entry.

**Working directory:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`

**Stage D precondition:** 59 sim tests + 6 wave integration tests pass. HEAD is the final Plan 4 commit.

**Scope cuts (deferred to Plan 7 polish):**
- Cache slot chip strip on cache components
- Capacity utilization bars
- Two-lane edges (request lane below, response lane above)
- LB split-burst / merge-converge animations
- Flash accumulation throttling
- Full sandbox/TD dashboard integration

---

## File Structure

**Created:**

```
src/dashboard/sim-demo/
  physics-demo.html              # Standalone HTML entry (separate Vite page)
  physics-demo.ts                # Bootstrap — build sim, renderer, driver
  topology-builder.ts            # Wave 3 cache-rescue topology constructor
  sim-to-renderer.ts             # Per-frame adapter (sim → renderer commands)
  browser-driver.ts              # requestAnimationFrame → fixed-step sim

src/dashboard/render/cyberpunk/
  snake-layer.ts                 # Trails up to 10 desaturated packet sprites behind a client

tests/unit/dashboard/
  sim-to-renderer-adapter.test.ts   # Adapter unit test with mock renderer
  browser-driver.test.ts            # Driver unit test with mock clock
```

**Modified:**

- `src/dashboard/render/topology-renderer.ts` — add `updateClientSnake(clientId, packets)` method
- `src/dashboard/render/cyberpunk-topology-renderer.ts` — implement `updateClientSnake`
- `vite.config.ts` (or whatever Vite config file exists) — register the new HTML entry
- `src/sim/index.ts` — potentially expose additional types the adapter needs

**Not touched:** `src/dashboard/main.ts`, `src/dashboard/td/`, `src/dashboard/td-mode.ts`, legacy engine.

---

## Task 1: Sim-to-renderer adapter

**Files:**
- Create: `src/dashboard/sim-demo/sim-to-renderer.ts`
- Test: `tests/unit/dashboard/sim-to-renderer-adapter.test.ts`

The adapter reads sim state each frame and issues renderer commands. It maintains a `Set<PacketId>` of packets already dispatched to the renderer so new packets → new dots. When a packet is no longer in `sim.activePackets`, it's considered retired — renderer dot animations complete on their own.

For flashes: scan `sim.lastStepEvents` each frame. Emit `flashDrop(componentId)` for drop events and `flashResponded(componentId)` for respond-delivered/terminate revenue events.

- [ ] **Step 1: Write failing test**

Create `tests/unit/dashboard/sim-to-renderer-adapter.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { SimToRendererAdapter } from "../../../src/dashboard/sim-demo/sim-to-renderer";
import type { TopologyRenderer, SpawnRequestDotArgs, ComponentUpdate, ConnectionUpdate, ComponentVisual, RendererPointerEvent } from "@dashboard/render/topology-renderer";
import type { ComponentId, ConnectionId, PortId, RequestId } from "@core/types/ids";
import type { Request } from "@sim/types";

class MockRenderer implements TopologyRenderer {
  spawnedDots: SpawnRequestDotArgs[] = [];
  dropsFlashed: ComponentId[] = [];
  respondedFlashed: ComponentId[] = [];
  // implement remaining interface methods as no-ops
  async mount(): Promise<void> {}
  destroy(): void {}
  resize(): void {}
  addComponent(_id: ComponentId, _visual: ComponentVisual): void {}
  removeComponent(): void {}
  updateComponent(_id: ComponentId, _u: ComponentUpdate): void {}
  addConnection(): void {}
  removeConnection(): void {}
  updateConnection(_id: ConnectionId, _u: ConnectionUpdate): void {}
  spawnRequestDot(args: SpawnRequestDotArgs): void { this.spawnedDots.push(args); }
  flashOverload(id: ComponentId): void { this.dropsFlashed.push(id); }
  flashDrop(id: ComponentId): void { this.dropsFlashed.push(id); }
  flashResponded(id: ComponentId): void { this.respondedFlashed.push(id); }
  queueFlashOnRequestArrival(): void {}
  setSelected(): void {}
  setPlacementGhost(): void {}
  setConnectionMode(): void {}
  hitTest(): null { return null; }
  screenToGrid(): { x: number; y: number } { return { x: 0, y: 0 }; }
  worldToScreen(): { x: number; y: number } { return { x: 0, y: 0 }; }
  onPointerDown(_cb: (ev: RendererPointerEvent) => void): () => void { return () => {}; }
  onPointerMove(_cb: (ev: RendererPointerEvent) => void): () => void { return () => {}; }
  onConnectionPointerDown(): () => void { return () => {}; }
  onComponentDragEnd(): () => void { return () => {}; }
  updateClientSnake(): void {}  // method added in Task 4
}

function mkRead(): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("SimToRendererAdapter", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot() {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({
      id: "b" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 100,
    });
    const ef = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: b.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.1, twinId: "eb" as ConnectionId, direction: "forward",
    });
    const eb = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: b.id, portId: "p" as PortId },
      to: { componentId: a.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.1, twinId: "ef" as ConnectionId, direction: "back",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(ef);
    sim.addConnection(eb);
    return { sim, ef, eb };
  }

  it("spawns a renderer dot for each new in-flight packet", () => {
    const { sim, ef } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer);
    sim.spawnPacket(makePacket({ requests: [mkRead()], edgeId: ef.id, speed: ef.speed, spawnedAt: 0, direction: "forward" }));
    adapter.syncFrame();
    expect(renderer.spawnedDots).toHaveLength(1);
    expect(renderer.spawnedDots[0]!.connectionId).toBe(ef.id);
    expect(renderer.spawnedDots[0]!.durationMs).toBeGreaterThan(0);
  });

  it("does not re-spawn dots for packets already tracked", () => {
    const { sim, ef } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer);
    sim.spawnPacket(makePacket({ requests: [mkRead()], edgeId: ef.id, speed: ef.speed, spawnedAt: 0, direction: "forward" }));
    adapter.syncFrame();
    adapter.syncFrame();
    adapter.syncFrame();
    expect(renderer.spawnedDots).toHaveLength(1);
  });

  it("fires flashDrop on drop events", () => {
    const { sim, ef } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer);
    // Inject a drop event directly:
    sim.lastStepEvents.push({ kind: "drop", componentId: "b" as ComponentId, reason: "test", count: 1 });
    adapter.syncFrame();
    expect(renderer.dropsFlashed).toEqual(["b"]);
  });

  it("fires flashResponded on respond-delivered events", () => {
    const { sim } = boot();
    const renderer = new MockRenderer();
    const adapter = new SimToRendererAdapter(sim, renderer);
    sim.lastStepEvents.push({ kind: "respond-delivered", componentId: "a" as ComponentId, revenue: 5, latencySeconds: 0.2 });
    adapter.syncFrame();
    expect(renderer.respondedFlashed).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Implement `src/dashboard/sim-demo/sim-to-renderer.ts`**

```ts
import type { Sim } from "@sim/sim";
import type { TopologyRenderer } from "@dashboard/render/topology-renderer";
import type { PacketId } from "@sim/types";

/**
 * Bridges physics sim state → iso renderer each frame.
 *
 * Responsibilities:
 * - Spawn a renderer dot when a new sim packet appears on an edge.
 * - Emit flash events from sim.lastStepEvents.
 * - Update the client snake (wired in Task 4).
 *
 * Call syncFrame() every render frame (typically from requestAnimationFrame).
 */
export class SimToRendererAdapter {
  private readonly trackedPackets: Set<PacketId> = new Set();

  constructor(
    private readonly sim: Sim,
    private readonly renderer: TopologyRenderer,
  ) {}

  syncFrame(): void {
    // Spawn dots for newly-tracked packets
    for (const packet of this.sim.activePackets) {
      if (this.trackedPackets.has(packet.id)) continue;
      this.trackedPackets.add(packet.id);
      const remainingProgress = 1 - packet.progress;
      const durationMs = (remainingProgress / packet.speed) * 1000;
      this.renderer.spawnRequestDot({
        connectionId: packet.edgeId,
        requestId: packet.requests[0]?.id ?? (packet.id as unknown as ReturnType<typeof packetIdToRequestId>),
        requestType: inferRequestType(packet),
        durationMs,
        count: packet.requests.length,
      });
    }

    // Garbage-collect tracked packets no longer active
    const activeIds = new Set<PacketId>(this.sim.activePackets.map((p) => p.id));
    for (const id of this.trackedPackets) {
      if (!activeIds.has(id)) this.trackedPackets.delete(id);
    }

    // Flash events
    for (const ev of this.sim.lastStepEvents) {
      if (ev.kind === "drop") this.renderer.flashDrop(ev.componentId);
      else if (ev.kind === "terminate" || ev.kind === "respond-delivered") {
        this.renderer.flashResponded(ev.componentId);
      }
    }

    // Snake (Task 5)
    for (const client of this.sim.clients.values()) {
      this.renderer.updateClientSnake?.(client.id, client.snake);
    }
  }
}

function packetIdToRequestId(_id: PacketId): never { throw new Error("unused helper"); }

function inferRequestType(packet: import("@sim/types").Packet): string {
  const first = packet.requests[0];
  if (!first) return "api_read";
  if (first.stream !== undefined) return "stream";
  if (first.requiresAuth) return "auth_required";
  if (first.isLarge) return "static_asset";
  if (first.isWrite) return "api_write";
  if (first.isAsync) return "batch";
  return "api_read";
}
```

Note on `inferRequestType`: the existing `SpawnRequestDotArgs.requestType` string is used by the renderer to color-code the dot. Mapping sim attributes to legacy type names keeps the existing color palette functional.

- [ ] **Step 3: Add `@dashboard/*` path alias if missing**

Check `tsconfig.json`: look for `@dashboard/*` in `paths`. If missing, add:

```json
"@dashboard/*": ["src/dashboard/*"],
```

And mirror in `vitest.config.ts` if it declares aliases.

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test tests/unit/dashboard/sim-to-renderer-adapter.test.ts 2>&1 | tail -15`

Expected: 4 tests passing. The `updateClientSnake` method is not yet declared on `TopologyRenderer` — the `?.` optional call in the adapter handles this, and the test's mock declares a no-op implementation.

- [ ] **Step 5: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(dashboard): SimToRendererAdapter — bridges sim to iso renderer"
```

---

## Task 2: Browser driver (fixed-step sim loop)

**Files:**
- Create: `src/dashboard/sim-demo/browser-driver.ts`
- Test: `tests/unit/dashboard/browser-driver.test.ts`

Canonical fixed-timestep pattern: accumulate wall-clock delta, drain in 1/60s chunks, stop if too far behind (to avoid death spiral). Each chunk calls `sim.step(1/60)`.

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/dashboard/browser-driver.test.ts
import { describe, it, expect } from "vitest";
import { Sim } from "@sim/sim";
import { BrowserDriver } from "../../../src/dashboard/sim-demo/browser-driver";

describe("BrowserDriver", () => {
  it("drains wall-clock delta in fixed 1/60s sim steps", () => {
    const sim = new Sim({ seed: 1 });
    const driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    // Drive 100ms of wall-clock time. Expected: 6 full steps (6 × 16.67ms = 100ms).
    const stepsTaken = driver.tick(100);
    expect(stepsTaken).toBe(6);
    expect(sim.simTime).toBeCloseTo(6 / 60, 6);
  });

  it("accumulates leftover delta between ticks", () => {
    const sim = new Sim({ seed: 1 });
    const driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    expect(driver.tick(10)).toBe(0); // 10ms < 16.67ms, no step yet
    expect(driver.tick(10)).toBe(1); // 20ms total, 1 step fires
  });

  it("caps catch-up to avoid death spiral", () => {
    const sim = new Sim({ seed: 1 });
    const driver = new BrowserDriver(sim, { stepSeconds: 1 / 60, maxStepsPerTick: 4 });
    // 1000ms wall-clock would be 60 steps; cap is 4.
    expect(driver.tick(1000)).toBe(4);
  });
});
```

- [ ] **Step 2: Implement `src/dashboard/sim-demo/browser-driver.ts`**

```ts
import type { Sim } from "@sim/sim";

export type BrowserDriverOptions = {
  readonly stepSeconds: number;     // typically 1/60
  readonly maxStepsPerTick?: number; // catch-up cap (default 6)
};

/**
 * Wall-clock → fixed-step sim driver. Call tick(deltaMs) once per
 * requestAnimationFrame. Returns number of sim steps executed this tick.
 */
export class BrowserDriver {
  private accumulatedMs = 0;
  private readonly stepMs: number;
  private readonly maxSteps: number;

  constructor(private readonly sim: Sim, opts: BrowserDriverOptions) {
    this.stepMs = opts.stepSeconds * 1000;
    this.maxSteps = opts.maxStepsPerTick ?? 6;
  }

  tick(deltaMs: number): number {
    this.accumulatedMs += deltaMs;
    let steps = 0;
    while (this.accumulatedMs >= this.stepMs && steps < this.maxSteps) {
      this.sim.step(this.stepMs / 1000);
      this.accumulatedMs -= this.stepMs;
      steps += 1;
    }
    return steps;
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm test tests/unit/dashboard/browser-driver.test.ts 2>&1 | tail -10
# expect 3 passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(dashboard): BrowserDriver — fixed-step sim loop"
```

---

## Task 3: Topology builder (Wave 3 cache-rescue hardcoded)

**Files:**
- Create: `src/dashboard/sim-demo/topology-builder.ts`

Builds the Client → Server → Cache → DB topology with twin connections and grid positions. No test — this is a wiring helper; correctness is verified by the demo itself.

- [ ] **Step 1: Implement**

```ts
// src/dashboard/sim-demo/topology-builder.ts
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

export type DemoTopology = {
  sim: Sim;
  // Grid positions for the renderer
  positions: Map<ComponentId, { x: number; y: number }>;
};

const WAVE_3: WaveDef = {
  intensity: 50,
  packetRate: 10,
  duration: 60, // long-running demo
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

export function buildWave3CacheRescue(seed: number): DemoTopology {
  const sim = new Sim({ seed });
  const ts = new TrafficSource(WAVE_3, makeSimRng(seed));
  const client = new SimClient({
    id: "client" as ComponentId,
    capabilities: [],
    packetRate: WAVE_3.packetRate,
    trafficSource: ts,
    waveStartTime: 0,
    waveEndTime: WAVE_3.duration,
  });
  const server = new SimComponent({ id: "server" as ComponentId, capabilities: [new ForwardingCapability()] });
  const cache = new SimComponent({
    id: "cache" as ComponentId,
    capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: 1 })],
  });
  const db = new SimComponent({
    id: "db" as ComponentId,
    capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
    capacityPerSecond: 30,
  });
  sim.addClient(client);
  sim.addComponent(server);
  sim.addComponent(cache);
  sim.addComponent(db);

  const wire = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
    new SimConnection({
      id: id as ConnectionId,
      from: { componentId: from, portId: "p" as PortId },
      to: { componentId: to, portId: "p" as PortId },
      bandwidth: 300, latencySeconds: 0.5, twinId: twin as ConnectionId, direction: dir,
    });
  sim.addConnection(wire("cs", client.id, server.id, "forward", "sc"));
  sim.addConnection(wire("sc", server.id, client.id, "back", "cs"));
  sim.addConnection(wire("sk", server.id, cache.id, "forward", "ks"));
  sim.addConnection(wire("ks", cache.id, server.id, "back", "sk"));
  sim.addConnection(wire("kd", cache.id, db.id, "forward", "dk"));
  sim.addConnection(wire("dk", db.id, cache.id, "back", "kd"));

  const positions = new Map<ComponentId, { x: number; y: number }>([
    [client.id, { x: 0, y: 0 }],
    [server.id, { x: 3, y: 0 }],
    [cache.id, { x: 6, y: 0 }],
    [db.id, { x: 9, y: 0 }],
  ]);

  return { sim, positions };
}
```

Note: `latencySeconds: 0.5` on edges — half-second travel so packets are visibly in-flight. The wave tests used `1/60` which is too fast for the human eye to track.

- [ ] **Step 2: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(dashboard): Wave 3 cache-rescue topology builder"
```

---

## Task 4: Extend TopologyRenderer with `updateClientSnake` + implement in Cyberpunk renderer

**Files:**
- Modify: `src/dashboard/render/topology-renderer.ts` (add method signature)
- Create: `src/dashboard/render/cyberpunk/snake-layer.ts`
- Modify: `src/dashboard/render/cyberpunk-topology-renderer.ts` (create layer + wire method)

The snake-layer draws up to 10 desaturated packet sprites in a line behind the client sprite. Direction: away from the client's first forward egress (fallback: leftward). For MVP, a simple left-direction line works.

- [ ] **Step 1: Add method to `TopologyRenderer` interface**

Edit `src/dashboard/render/topology-renderer.ts`. Add to the interface:

```ts
  /**
   * Update the visible "snake" of upcoming packets queued at a client.
   * Renderer displays up to the first 10 packets trailing behind the
   * client sprite (desaturated). Implementations may no-op if snake is
   * not supported.
   */
  updateClientSnake?(clientId: ComponentId, packets: ReadonlyArray<{ id: string; type: string; count: number }>): void;
```

(Optional method — existing flat renderer can ignore.)

- [ ] **Step 2: Implement `src/dashboard/render/cyberpunk/snake-layer.ts`**

```ts
import { Container, Sprite, Text } from "pixi.js";
import type { ComponentId } from "@core/types/ids";
import type { PacketTextureMap } from "./packet-layer";
import type { ComponentLayer } from "./component-layer";

export type SnakePacket = { readonly id: string; readonly type: string; readonly count: number };

type ClientSnakeState = {
  readonly container: Container;
  readonly sprites: Sprite[]; // up to 10
  readonly labels: (Text | null)[]; // corresponds to sprites
};

const TRAIL_SPACING_PX = 24;
const MAX_VISIBLE = 10;

export class SnakeLayer {
  readonly container: Container;
  private readonly states: Map<ComponentId, ClientSnakeState> = new Map();

  constructor(
    private readonly componentLayer: ComponentLayer,
    private readonly textures: PacketTextureMap,
  ) {
    this.container = new Container();
  }

  update(clientId: ComponentId, packets: ReadonlyArray<SnakePacket>): void {
    let state = this.states.get(clientId);
    const clientState = this.componentLayer.get(clientId);
    if (!clientState) {
      this.dispose(clientId);
      return;
    }
    if (!state) {
      const container = new Container();
      this.container.addChild(container);
      state = { container, sprites: [], labels: [] };
      this.states.set(clientId, state);
    }
    state.container.x = clientState.container.x;
    state.container.y = clientState.container.y;

    const visible = packets.slice(0, MAX_VISIBLE);
    // Remove excess sprites
    while (state.sprites.length > visible.length) {
      const s = state.sprites.pop()!;
      state.container.removeChild(s);
      s.destroy();
      const lbl = state.labels.pop();
      lbl?.destroy();
    }
    // Add missing sprites
    while (state.sprites.length < visible.length) {
      const idx = state.sprites.length;
      const tex = this.textures.get(visible[idx]!.type) ?? this.textures.get("api_read")!;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.alpha = 0.45; // desaturated
      state.container.addChild(sprite);
      state.sprites.push(sprite);
      state.labels.push(null);
    }
    // Position + update each sprite
    for (let i = 0; i < visible.length; i += 1) {
      const sprite = state.sprites[i]!;
      // Trail to the left, fading slightly more toward the tail
      sprite.x = -((i + 1) * TRAIL_SPACING_PX);
      sprite.y = -8;
      sprite.alpha = Math.max(0.15, 0.5 - i * 0.035);
      // Swap texture if type changed
      const tex = this.textures.get(visible[i]!.type);
      if (tex && sprite.texture !== tex) sprite.texture = tex;
      // Count label (shown when count >= 5)
      const count = visible[i]!.count;
      let label = state.labels[i];
      if (count >= 5) {
        if (!label) {
          label = new Text({ text: `x${count}`, style: { fontFamily: "monospace", fontSize: 10, fill: 0xaaaaaa } });
          label.anchor.set(0.5, 1);
          label.y = -14;
          sprite.addChild(label);
          state.labels[i] = label;
        } else {
          label.text = `x${count}`;
        }
      } else if (label) {
        label.destroy();
        state.labels[i] = null;
      }
    }
  }

  dispose(clientId: ComponentId): void {
    const state = this.states.get(clientId);
    if (!state) return;
    this.container.removeChild(state.container);
    for (const s of state.sprites) s.destroy();
    for (const l of state.labels) l?.destroy();
    state.container.destroy();
    this.states.delete(clientId);
  }

  cleanup(): void {
    for (const id of this.states.keys()) this.dispose(id);
  }
}
```

- [ ] **Step 3: Wire snake-layer into CyberpunkTopologyRenderer**

Modify `src/dashboard/render/cyberpunk-topology-renderer.ts`:

Add import:
```ts
import { SnakeLayer } from "./cyberpunk/snake-layer";
```

Add private field near other layers:
```ts
private snakeLayer: SnakeLayer | null = null;
```

In the `mount` method, after `packetLayer` is created:
```ts
this.snakeLayer = new SnakeLayer(this.componentLayer, this.packetTextures);
world.addChild(this.snakeLayer.container);
```

In `destroy`:
```ts
this.snakeLayer?.cleanup();
this.snakeLayer = null;
```

Add the method:
```ts
updateClientSnake(clientId: ComponentId, packets: ReadonlyArray<{ id: string; type: string; count: number }>): void {
  this.snakeLayer?.update(clientId, packets);
}
```

- [ ] **Step 4: Check that `ComponentLayer.get(id)` exists**

If it doesn't (grep for `get(id` in `src/dashboard/render/cyberpunk/component-layer.ts`), add one. It should return the `{ container, ...}` state object. If the existing `.all()` iterates `[id, state]` tuples, a corresponding `.get(id)` that returns `state | undefined` is trivial. If it's already there under a different name, use that.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck 2>&1 | tail -15`

Expected: only pre-existing pull-from-buffers noise.

- [ ] **Step 6: Sim regression** (nothing sim-side changed, but verify)

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -5`

Expected: 59+ passing.

- [ ] **Step 7: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(render): SnakeLayer — trails queued packets behind clients"
```

---

## Task 5: Bootstrap page (HTML + TS entry)

**Files:**
- Create: `src/dashboard/sim-demo/physics-demo.html`
- Create: `src/dashboard/sim-demo/physics-demo.ts`
- Modify: `vite.config.ts` (register additional input entry)

- [ ] **Step 1: Create the HTML**

```html
<!-- src/dashboard/sim-demo/physics-demo.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BrainLift — Physics Sim Demo</title>
  <link rel="stylesheet" href="../styles.css" />
  <style>
    html, body { margin: 0; padding: 0; background: #0a1420; color: #ccddee; font-family: monospace; }
    #canvas-host { position: absolute; inset: 0; }
    #stats { position: absolute; top: 12px; left: 12px; background: #122030; padding: 8px 12px; border-radius: 6px; font-size: 12px; line-height: 1.6; }
  </style>
</head>
<body>
  <div id="canvas-host"></div>
  <div id="stats">
    <div>Physics-sim demo — Wave 3 cache-rescue</div>
    <div>sim time: <span id="stat-sim-time">0.0</span>s</div>
    <div>packets in flight: <span id="stat-active">0</span></div>
    <div>snake length: <span id="stat-snake">0</span></div>
    <div>responded: <span id="stat-responded">0</span> · drops: <span id="stat-drops">0</span> · revenue: <span id="stat-revenue">0</span></div>
  </div>
  <script type="module" src="./physics-demo.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Create the TS entry**

```ts
// src/dashboard/sim-demo/physics-demo.ts
import { CyberpunkTopologyRenderer } from "@dashboard/render/cyberpunk-topology-renderer";
import { buildWave3CacheRescue } from "./topology-builder";
import { SimToRendererAdapter } from "./sim-to-renderer";
import { BrowserDriver } from "./browser-driver";

async function main(): Promise<void> {
  const host = document.getElementById("canvas-host");
  if (!host) throw new Error("canvas-host missing");

  const { sim, positions } = buildWave3CacheRescue(7);
  const renderer = new CyberpunkTopologyRenderer();
  await renderer.mount(host);
  renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () => renderer.resize(window.innerWidth, window.innerHeight));

  // Register components with the renderer
  for (const [id, comp] of sim.components.entries()) {
    const pos = positions.get(id);
    if (!pos) continue;
    const type = comp.capabilities[0]?.id ?? "client";
    const displayName = id;
    renderer.addComponent(id, { type: normalizeType(type), displayName, gridPosition: pos });
  }
  for (const [id, conn] of sim.connections.entries()) {
    if (conn.direction !== "forward") continue; // draw only forward curve; back lane is Plan 7
    renderer.addConnection(id, conn.from.componentId, conn.to.componentId);
  }

  const adapter = new SimToRendererAdapter(sim, renderer);
  const driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });

  const statSimTime = document.getElementById("stat-sim-time")!;
  const statActive = document.getElementById("stat-active")!;
  const statSnake = document.getElementById("stat-snake")!;
  const statResponded = document.getElementById("stat-responded")!;
  const statDrops = document.getElementById("stat-drops")!;
  const statRevenue = document.getElementById("stat-revenue")!;
  let responded = 0, drops = 0, revenue = 0;

  let lastTime = performance.now();
  function frame(now: number): void {
    const delta = now - lastTime;
    lastTime = now;
    driver.tick(delta);
    for (const ev of sim.lastStepEvents) {
      if (ev.kind === "drop") drops += ev.count;
      if (ev.kind === "respond-delivered" || ev.kind === "terminate") {
        responded += 1;
        revenue += ev.revenue;
      }
    }
    adapter.syncFrame();
    statSimTime.textContent = sim.simTime.toFixed(1);
    statActive.textContent = String(sim.activePackets.length);
    const client = sim.clients.values().next().value;
    statSnake.textContent = String(client?.snake.length ?? 0);
    statResponded.textContent = String(responded);
    statDrops.textContent = String(drops);
    statRevenue.textContent = String(revenue);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function normalizeType(capId: string): string {
  // Map capability ids to renderer type keys (tile sprites).
  if (capId === "forwarding") return "server";
  if (capId === "caching") return "data_cache";
  if (capId === "processing") return "database";
  return "client";
}

void main();
```

- [ ] **Step 3: Register HTML entry in Vite config**

Check `vite.config.ts`. If the build config has an `input` map under `build.rollupOptions.input`, add `physics-demo: path.resolve(__dirname, "src/dashboard/sim-demo/physics-demo.html")`. If there's no explicit input, Vite should pick up the file via dev server regardless.

Run `pnpm dev` and navigate to `http://localhost:5173/src/dashboard/sim-demo/physics-demo.html` to verify.

- [ ] **Step 4: Manual verification (browser test)**

Run the dev server and verify:

```bash
pnpm dev
# Navigate to http://localhost:5173/src/dashboard/sim-demo/physics-demo.html
```

Expected visuals:
- 4 tiles on a line: client, server, cache, db
- Packets spawn at client and animate along edges to server, then cache, then db (or respond back from cache on hits)
- Stats box in top-left shows sim time advancing, active packet count rising and falling, responded/drops accumulating
- After a few seconds, a snake of up to 10 desaturated packet sprites is visible trailing behind the client

If any of these don't work, debug before committing.

- [ ] **Step 5: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(dashboard): physics-sim demo page — visible Wave 3 cache rescue"
```

---

## Task 6: Final regression + documentation note

- [ ] **Step 1: Full test regression**

Run:

```bash
pnpm test tests/unit/sim/ 2>&1 | tail -5
pnpm test tests/unit/dashboard/ 2>&1 | tail -5
pnpm test tests/integration/sim/ 2>&1 | tail -5
```

Expected all green.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | tail -5`

Expected only pre-existing noise.

- [ ] **Step 3: Commit note** (no code change — optional small README update)

Update `docs/claude/implementation-status.md` to mention Stage E is shipped. One-line addition.

If no change, skip the commit.

---

## Completion

Plan 5 ships:
- Browser driver (fixed-step sim loop with accumulator + catch-up cap)
- Adapter (sim state → renderer commands per frame)
- Topology builder (hardcoded Wave 3 cache-rescue)
- Snake layer (trailing packet sprites behind clients)
- Bootstrap page (`physics-demo.html` + TS entry)
- End-to-end verification: `pnpm dev` shows sim running in browser

## Self-review notes

- The adapter uses `packet.requests[0].id` as the renderer's `requestId` — if the packet has zero requests (e.g. merged response packet from LB), we fall back to the packet id. This is fine because the flash-on-arrival queue is not wired up for merges in this stage.
- Snake rendering uses desaturated (alpha 0.15–0.5) sprites to distinguish "upcoming" from "live." Fine visual default; tuning is Plan 7.
- Travel durations on demo edges are 500ms — visibly slow enough to see packets move. The wave tests ran at 16ms because throughput was the concern.
- The demo page does NOT wire up pointer events, selection, or placement — those are dashboard features this plan doesn't touch.
- `componentLayer.get(id)` is assumed to exist. If it doesn't, Task 4 adds it; if it does but under a different name, adapt accordingly.

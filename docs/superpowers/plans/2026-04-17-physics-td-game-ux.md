# Physics TD Game UX (Plan 6a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the physics sim playable as a TD game. New entry point at `/physics-td.html` with: build/simulate phase loop, palette-driven component placement, click-to-connect, READY-to-start-wave, SLA-driven win/loss flow, multi-wave campaign progression. Reuses the existing cyberpunk HUD chrome (wave pill, briefing panel, palette strip, READY button, loss modal, info panel) by writing to the hidden `#td-hud-*` mirror divs the HUD already observes.

**Architecture:** `PhysicsCampaignController` owns wave/economy/phase state and exposes `tryPlace(type, gridPos)` / `tryConnect(sourceId, targetId)` / `ready()` / `retry()`. A new `physics-td.ts` bootstrap wires the controller to the iso renderer, sim, browser driver, and HUD callbacks. The old sandbox/TD dashboard at `/` keeps working untouched. Plan 6b deletes it later.

**Working directory:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`

**Precondition:** 124 tests passing, sim demo at `/sim-demo/physics-demo.html` works, all Stage A–E + G + 4b shipped. HEAD `db5c28c`.

**Scope cuts (deferred):**
- **Briefing card content polish** — uses minimal text initially; rich narrative/diagnose comes later
- **Component info panel** — basic capabilities + budget cost; live stats deferred
- **Waves 7 + 10** — campaign ships waves 1, 2, 3, 5 (skipping 4 for first campaign — can add). 6/8/9 already have integration tests but require multi-zone support deferred until Plan 4c
- **Sandbox tools, charts, chaos panel, scenario IO** — gone, replaced by the focused TD-only UX
- **Mobile / touch UX** — desktop only

---

## File Structure

**Created:**

```
src/dashboard/physics-td/
  physics-td.html               # New HTML entry — loads cyberpunk HUD + iso renderer
  physics-td.ts                 # Bootstrap: wires controller, sim, renderer, HUD
  campaign-controller.ts        # PhysicsCampaignController — state machine + economy
  component-factory.ts          # palette type → SimComponent + cost + tile type
  waves.ts                      # Catalog of 4 waves with WaveDef + briefing text + cost budget
  placement-ux.ts               # Palette click → ghost → grid click → place
  connect-ux.ts                 # Click source → click target → mint twin pair
  hud-bridge.ts                 # Writes to hidden #td-hud-* divs that cyberpunk-hud.ts mirrors

tests/unit/dashboard/physics-td/
  campaign-controller.test.ts
  component-factory.test.ts
```

**Modified:**

- `vite.config.ts` — register the new HTML entry (add to rollup input)

**Not touched:** `src/dashboard/main.ts`, `src/dashboard/td/*`, `src/dashboard/td-mode.ts`, `src/dashboard/topologies.ts`, `src/dashboard/cyberpunk-hud.ts` (we use it as-is via the mirror pattern).

---

## Task 1: PhysicsCampaignController

**Files:**
- Create: `src/dashboard/physics-td/campaign-controller.ts`
- Test: `tests/unit/dashboard/physics-td/campaign-controller.test.ts`

State machine:
- Phases: `"build" | "simulate" | "won" | "lost" | "campaign-complete"`
- Tracks: `currentWaveIndex`, `budget`, `placedComponents: Set<ComponentId>`, `placedConnections: Set<ConnectionId>`
- Methods: `tryPlace`, `tryConnect`, `ready`, `onWaveEnd`, `retry`, `nextWave`, `reset`

The controller does NOT directly manipulate the Sim. It holds *intents* — actually placing components is done by the bootstrap which observes controller events and applies them to both sim + renderer.

For Stage 6a MVP, use a callback pattern instead of an event emitter:

```ts
type CampaignCallbacks = {
  onPlaced(type: string, componentId: ComponentId, gridPos: { x: number; y: number }): void;
  onConnected(sourceId: ComponentId, targetId: ComponentId, forwardId: ConnectionId, backId: ConnectionId): void;
  onPhaseChange(phase: Phase, waveIndex: number): void;
  onBudgetChange(budget: number): void;
};
```

### Step 1: Write failing test

Create `tests/unit/dashboard/physics-td/campaign-controller.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { PhysicsCampaignController } from "../../../../src/dashboard/physics-td/campaign-controller";
import type { ComponentId } from "@core/types/ids";

describe("PhysicsCampaignController", () => {
  function makeController() {
    const callbacks = {
      placed: [] as Array<{ type: string; gridPos: { x: number; y: number } }>,
      phaseChanges: [] as Array<{ phase: string; waveIndex: number }>,
      budgetChanges: [] as number[],
    };
    const controller = new PhysicsCampaignController({
      waves: [
        { id: "test-1", startBudget: 500 },
        { id: "test-2", startBudget: 700 },
      ],
      componentCosts: new Map([["server", 100], ["data_cache", 150]]),
      callbacks: {
        onPlaced: (type, _id, gridPos) => callbacks.placed.push({ type, gridPos }),
        onConnected: () => {},
        onPhaseChange: (phase, waveIndex) => callbacks.phaseChanges.push({ phase, waveIndex }),
        onBudgetChange: (b) => callbacks.budgetChanges.push(b),
      },
    });
    return { controller, callbacks };
  }

  it("starts in build phase at wave 0 with starting budget", () => {
    const { controller } = makeController();
    expect(controller.phase).toBe("build");
    expect(controller.currentWaveIndex).toBe(0);
    expect(controller.budget).toBe(500);
  });

  it("tryPlace deducts cost and fires onPlaced + onBudgetChange", () => {
    const { controller, callbacks } = makeController();
    const result = controller.tryPlace("server", { x: 1, y: 1 });
    expect(result.ok).toBe(true);
    expect(controller.budget).toBe(400);
    expect(callbacks.placed).toHaveLength(1);
    expect(callbacks.placed[0]).toEqual({ type: "server", gridPos: { x: 1, y: 1 } });
    expect(callbacks.budgetChanges).toEqual([400]);
  });

  it("tryPlace fails when budget insufficient", () => {
    const { controller, callbacks } = makeController();
    controller.tryPlace("server", { x: 1, y: 1 });
    controller.tryPlace("server", { x: 2, y: 1 });
    controller.tryPlace("server", { x: 3, y: 1 });
    controller.tryPlace("server", { x: 4, y: 1 });
    controller.tryPlace("server", { x: 5, y: 1 });
    const result = controller.tryPlace("server", { x: 6, y: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_budget");
    expect(controller.budget).toBe(0);
    expect(callbacks.placed).toHaveLength(5);
  });

  it("ready() transitions build → simulate", () => {
    const { controller, callbacks } = makeController();
    controller.ready();
    expect(controller.phase).toBe("simulate");
    expect(callbacks.phaseChanges.at(-1)).toEqual({ phase: "simulate", waveIndex: 0 });
  });

  it("onWaveEnd(passed=true) → won phase, then nextWave advances", () => {
    const { controller, callbacks } = makeController();
    controller.ready();
    controller.onWaveEnd(true);
    expect(controller.phase).toBe("won");
    controller.nextWave();
    expect(controller.currentWaveIndex).toBe(1);
    expect(controller.phase).toBe("build");
    expect(controller.budget).toBe(700);
    expect(callbacks.phaseChanges.map((p) => p.phase)).toEqual(["simulate", "won", "build"]);
  });

  it("onWaveEnd(passed=false) → lost phase, retry resets to current wave start", () => {
    const { controller, callbacks } = makeController();
    controller.tryPlace("server", { x: 1, y: 1 });
    expect(controller.budget).toBe(400);
    controller.ready();
    controller.onWaveEnd(false);
    expect(controller.phase).toBe("lost");
    controller.retry();
    expect(controller.phase).toBe("build");
    expect(controller.budget).toBe(500);
    expect(callbacks.phaseChanges.map((p) => p.phase)).toEqual(["simulate", "lost", "build"]);
  });

  it("nextWave on the last wave triggers campaign-complete", () => {
    const { controller } = makeController();
    controller.ready();
    controller.onWaveEnd(true);
    controller.nextWave();
    controller.ready();
    controller.onWaveEnd(true);
    controller.nextWave();
    expect(controller.phase).toBe("campaign-complete");
  });
});
```

### Step 2: Implement `src/dashboard/physics-td/campaign-controller.ts`

```ts
import type { ComponentId, ConnectionId } from "@core/types/ids";

export type Phase = "build" | "simulate" | "won" | "lost" | "campaign-complete";

export type WaveSlot = {
  readonly id: string;
  readonly startBudget: number;
};

export type PlaceResult =
  | { readonly ok: true; readonly componentId: ComponentId }
  | { readonly ok: false; readonly reason: "insufficient_budget" | "unknown_type" };

export type ConnectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "self_connect" | "already_connected" };

export type CampaignCallbacks = {
  onPlaced(type: string, componentId: ComponentId, gridPos: { x: number; y: number }): void;
  onConnected(sourceId: ComponentId, targetId: ComponentId, forwardId: ConnectionId, backId: ConnectionId): void;
  onPhaseChange(phase: Phase, waveIndex: number): void;
  onBudgetChange(budget: number): void;
};

export type CampaignOptions = {
  readonly waves: ReadonlyArray<WaveSlot>;
  readonly componentCosts: ReadonlyMap<string, number>;
  readonly callbacks: CampaignCallbacks;
};

let nextComponentIdCounter = 0;
let nextConnectionIdCounter = 0;

function mintComponentId(): ComponentId {
  nextComponentIdCounter += 1;
  return `c${String(nextComponentIdCounter).padStart(6, "0")}` as ComponentId;
}

function mintConnectionId(): ConnectionId {
  nextConnectionIdCounter += 1;
  return `conn${String(nextConnectionIdCounter).padStart(6, "0")}` as ConnectionId;
}

export class PhysicsCampaignController {
  phase: Phase = "build";
  currentWaveIndex = 0;
  budget: number;
  readonly placedComponents: Set<ComponentId> = new Set();
  readonly placedConnections: Set<string> = new Set(); // key = sourceId + ":" + targetId

  constructor(private readonly opts: CampaignOptions) {
    this.budget = opts.waves[0]?.startBudget ?? 0;
  }

  tryPlace(type: string, gridPos: { x: number; y: number }): PlaceResult {
    if (this.phase !== "build") return { ok: false, reason: "insufficient_budget" }; // re-use reason for simplicity
    const cost = this.opts.componentCosts.get(type);
    if (cost === undefined) return { ok: false, reason: "unknown_type" };
    if (this.budget < cost) return { ok: false, reason: "insufficient_budget" };
    this.budget -= cost;
    const id = mintComponentId();
    this.placedComponents.add(id);
    this.opts.callbacks.onPlaced(type, id, gridPos);
    this.opts.callbacks.onBudgetChange(this.budget);
    return { ok: true, componentId: id };
  }

  tryConnect(sourceId: ComponentId, targetId: ComponentId): ConnectResult {
    if (this.phase !== "build") return { ok: false, reason: "self_connect" };
    if (sourceId === targetId) return { ok: false, reason: "self_connect" };
    const key = `${sourceId as unknown as string}:${targetId as unknown as string}`;
    if (this.placedConnections.has(key)) return { ok: false, reason: "already_connected" };
    this.placedConnections.add(key);
    const forwardId = mintConnectionId();
    const backId = mintConnectionId();
    this.opts.callbacks.onConnected(sourceId, targetId, forwardId, backId);
    return { ok: true };
  }

  ready(): void {
    if (this.phase !== "build") return;
    this.phase = "simulate";
    this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex);
  }

  onWaveEnd(passed: boolean): void {
    if (this.phase !== "simulate") return;
    this.phase = passed ? "won" : "lost";
    this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex);
  }

  nextWave(): void {
    if (this.phase !== "won") return;
    this.currentWaveIndex += 1;
    if (this.currentWaveIndex >= this.opts.waves.length) {
      this.phase = "campaign-complete";
      this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex - 1);
      return;
    }
    this.budget = this.opts.waves[this.currentWaveIndex]!.startBudget;
    this.phase = "build";
    this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex);
    this.opts.callbacks.onBudgetChange(this.budget);
  }

  retry(): void {
    if (this.phase !== "lost") return;
    // Note: bootstrap is responsible for clearing placedComponents/Connections
    // from sim + renderer. Controller just resets economy and phase.
    this.budget = this.opts.waves[this.currentWaveIndex]!.startBudget;
    this.placedComponents.clear();
    this.placedConnections.clear();
    this.phase = "build";
    this.opts.callbacks.onPhaseChange(this.phase, this.currentWaveIndex);
    this.opts.callbacks.onBudgetChange(this.budget);
  }
}
```

### Step 3: Run + commit

```bash
pnpm test tests/unit/dashboard/physics-td/campaign-controller.test.ts 2>&1 | tail -10
# expect 7 passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(physics-td): PhysicsCampaignController — phase + economy state machine"
```

---

## Task 2: Component factory

**Files:**
- Create: `src/dashboard/physics-td/component-factory.ts`
- Test: `tests/unit/dashboard/physics-td/component-factory.test.ts`

Maps palette type strings → SimComponent constructor calls. Each entry knows: cost, sprite type for renderer, capabilities to instantiate, capacity (if processing).

For MVP, six types matching the existing palette:
- `server` — ForwardingCapability (forwards reads/writes to first egress)
- `database` — ProcessingCapability { perWrite: 5, perRead: 2 }, capacity 30
- `data_cache` — CachingCapability { capacity: 32, revenuePerRead: 2 }
- `load_balancer` — LoadBalancerCapability
- `cdn` — CachingCapability { capacity: 24, revenuePerRead: 1 }
- `api_gateway` — GatewayCapability { revenuePerAuth: 4 }

These are simple defaults; the wave catalog tunes things via revenue ratios in WaveDef. The factory's `revenuePerWrite` etc. should be wave-driven later — for MVP they're hardcoded.

### Step 1: Write failing test

Create `tests/unit/dashboard/physics-td/component-factory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COMPONENT_FACTORY, COMPONENT_COSTS, buildSimComponent } from "../../../../src/dashboard/physics-td/component-factory";
import type { ComponentId } from "@core/types/ids";

describe("component-factory", () => {
  it("knows costs for the six MVP component types", () => {
    expect(COMPONENT_COSTS.get("server")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("database")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("data_cache")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("load_balancer")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("cdn")).toBeGreaterThan(0);
    expect(COMPONENT_COSTS.get("api_gateway")).toBeGreaterThan(0);
  });

  it("buildSimComponent for server returns a SimComponent with ForwardingCapability", () => {
    const comp = buildSimComponent("server", "s1" as ComponentId);
    expect(comp).toBeDefined();
    expect(comp!.id).toBe("s1");
    expect(comp!.capabilities[0]?.id).toBe("forwarding");
  });

  it("buildSimComponent for database has capacity bucket and processing cap", () => {
    const comp = buildSimComponent("database", "db1" as ComponentId);
    expect(comp).toBeDefined();
    expect(comp!.bucket).not.toBeNull();
    expect(comp!.capabilities[0]?.id).toBe("processing");
  });

  it("returns null for unknown type", () => {
    const comp = buildSimComponent("unknown_thing", "x" as ComponentId);
    expect(comp).toBeNull();
  });
});
```

### Step 2: Implement `src/dashboard/physics-td/component-factory.ts`

```ts
import type { ComponentId } from "@core/types/ids";
import { SimComponent } from "@sim/component";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { GatewayCapability } from "@sim/capabilities/gateway";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";

export const COMPONENT_COSTS: ReadonlyMap<string, number> = new Map([
  ["server", 100],
  ["database", 200],
  ["data_cache", 150],
  ["load_balancer", 175],
  ["cdn", 200],
  ["api_gateway", 250],
]);

/** Sprite type used by the renderer to pick the iso tile graphic. */
export const COMPONENT_SPRITE_TYPE: ReadonlyMap<string, string> = new Map([
  ["server", "server"],
  ["database", "database"],
  ["data_cache", "data_cache"],
  ["load_balancer", "load_balancer"],
  ["cdn", "cdn"],
  ["api_gateway", "api_gateway"],
]);

export const COMPONENT_FACTORY: ReadonlyArray<string> = [
  "server", "database", "data_cache", "load_balancer", "cdn", "api_gateway",
];

export function buildSimComponent(type: string, id: ComponentId): SimComponent | null {
  switch (type) {
    case "server":
      return new SimComponent({ id, capabilities: [new ForwardingCapability()] });
    case "database":
      return new SimComponent({
        id,
        capabilities: [new ProcessingCapability({ revenuePerWrite: 5, revenuePerRead: 2 })],
        capacityPerSecond: 30,
      });
    case "data_cache":
      return new SimComponent({
        id,
        capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: 2 })],
      });
    case "load_balancer":
      return new SimComponent({
        id,
        capabilities: [new LoadBalancerCapability()],
      });
    case "cdn":
      return new SimComponent({
        id,
        capabilities: [new CachingCapability({ capacity: 24, revenuePerRead: 1 })],
      });
    case "api_gateway":
      return new SimComponent({
        id,
        capabilities: [new GatewayCapability({ revenuePerAuth: 4 })],
      });
    default:
      return null;
  }
}
```

### Step 3: Run + commit

```bash
pnpm test tests/unit/dashboard/physics-td/component-factory.test.ts 2>&1 | tail -10
# expect 4 passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(physics-td): component factory — palette type → SimComponent"
```

---

## Task 3: Wave catalog

**Files:**
- Create: `src/dashboard/physics-td/waves.ts`

Hand-tuned 4-wave campaign. Each entry: WaveDef + SLA + briefing text + starting budget.

### Implementation

```ts
// src/dashboard/physics-td/waves.ts
import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { ComponentId } from "@core/types/ids";

export type CampaignWave = {
  readonly id: string;
  readonly title: string;
  readonly briefing: string;       // shown in briefing panel
  readonly wave: WaveDef;
  readonly sla: SLAThresholds;
  readonly startBudget: number;
};

const CLIENT_ID = "client" as ComponentId;

export const CAMPAIGN_WAVES: ReadonlyArray<CampaignWave> = [
  {
    id: "w1",
    title: "Wave 1 — First Light",
    briefing: "10 reads/sec, no writes. A lone Server can handle this. Budget for one Server, one Database (optional).",
    wave: {
      intensity: 10,
      packetRate: 1,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "uniform", spaceSize: 50 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
    startBudget: 200,
  },
  {
    id: "w2",
    title: "Wave 2 — Read/Write Mix",
    briefing: "20 req/sec with 30% writes. Writes need to reach the Database; reads can be served by the Server's response.",
    wave: {
      intensity: 20,
      packetRate: 2,
      duration: 8,
      composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "uniform", spaceSize: 50 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
    startBudget: 400,
  },
  {
    id: "w3",
    title: "Wave 3 — DB Saturation",
    briefing: "30 reads/sec hot keys. Database alone will saturate. A Data Cache between Server and DB absorbs the hot-key traffic.",
    wave: {
      intensity: 30,
      packetRate: 3,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
    startBudget: 250,
  },
  {
    id: "w5",
    title: "Wave 5 — Auth Wall",
    briefing: "60 req/sec with 25% auth-required. Place an API Gateway in front to terminate auth before it touches the read path.",
    wave: {
      intensity: 60,
      packetRate: 5,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0.25, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 2, perStream: 0 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.8, maxAvgLatencySeconds: 2, maxDropRate: 0.2 },
    startBudget: 350,
  },
];
```

### Commit

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(physics-td): 4-wave campaign catalog with briefings + SLAs"
```

---

## Task 4: HTML entry + bootstrap

**Files:**
- Create: `src/dashboard/physics-td/physics-td.html`
- Create: `src/dashboard/physics-td/physics-td.ts`
- Create: `src/dashboard/physics-td/hud-bridge.ts`
- Modify: `vite.config.ts` (register entry)

### Step 1: HTML entry

`src/dashboard/physics-td/physics-td.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BrainLift — Physics TD</title>
  <link rel="stylesheet" href="../styles.css" />
  <link rel="stylesheet" href="../cyberpunk-hud.css" />
  <style>
    html, body { margin: 0; padding: 0; background: #0a1420; color: #ccddee; font-family: monospace; overflow: hidden; }
    #canvas-host { position: absolute; inset: 0; }
    /* Hidden mirror divs that cyberpunk-hud.ts observes — physics-td.ts writes to these. */
    .td-hud-mirror { display: none; }
  </style>
</head>
<body>
  <div id="canvas-host"></div>

  <!-- Mirror divs that the existing cyberpunk HUD observes. The HUD's
       MutationObserver watches these for text changes and reflects them
       into its own visible cyberpunk-styled DOM. -->
  <div class="td-hud-mirror">
    <div id="td-hud-wave">1 of 4</div>
    <div id="td-hud-phase">build</div>
    <div id="td-hud-budget">$200</div>
    <div id="td-status">Build phase — place components and click READY</div>
    <!-- Briefing card -->
    <div id="td-briefing-title">Wave 1 — First Light</div>
    <div id="td-briefing-traffic"></div>
    <div id="td-briefing-budget"></div>
    <div id="td-briefing-threshold"></div>
    <div id="td-briefing-components"></div>
    <!-- Loss modal -->
    <div id="td-loss-modal" hidden>
      <div id="td-loss-modal-title">Wave LOST</div>
      <p id="td-loss-modal-detail"></p>
      <button id="td-retry-btn">Retry Wave</button>
      <button id="td-reset-btn">Reset Campaign</button>
    </div>
    <!-- Info panel -->
    <div id="td-info-panel" hidden>
      <button id="td-info-panel-close">×</button>
      <div id="td-info-panel-header"></div>
      <div id="td-info-panel-description"></div>
      <ul id="td-info-panel-caps"></ul>
      <div id="td-info-panel-stats"></div>
    </div>
    <!-- Dev wave selector (HUD shows this; we'll wire it later) -->
    <select id="td-dev-wave-select"></select>
    <!-- READY button (HUD has its own; this is the mirror target) -->
    <button id="td-ready-btn">READY</button>
    <!-- Palette buttons (HUD reads these to decide what to show) -->
    <button class="td-palette-btn" data-type="server">+ Server $100</button>
    <button class="td-palette-btn" data-type="database">+ Database $200</button>
    <button class="td-palette-btn" data-type="data_cache">+ Data Cache $150</button>
    <button class="td-palette-btn" data-type="load_balancer">+ Load Balancer $175</button>
    <button class="td-palette-btn" data-type="cdn">+ CDN $200</button>
    <button class="td-palette-btn" data-type="api_gateway">+ API Gateway $250</button>
  </div>

  <script type="module" src="./physics-td.ts"></script>
</body>
</html>
```

URL must include `?renderer=iso` for the cyberpunk HUD to activate. We'll force it from the bootstrap.

### Step 2: HUD bridge

`src/dashboard/physics-td/hud-bridge.ts`:

```ts
/**
 * Pushes physics-td state into the hidden mirror divs that cyberpunk-hud.ts
 * observes. The HUD itself reflects these into its visible chrome.
 *
 * If the HUD is not active (no ?renderer=iso flag), these writes still
 * happen — the mirror divs are display:none, no visual harm.
 */

export function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function setStatus(text: string): void {
  setText("td-status", text);
}

export function setWavePill(currentWave: number, totalWaves: number): void {
  setText("td-hud-wave", `${currentWave} of ${totalWaves}`);
}

export function setPhase(phase: string): void {
  setText("td-hud-phase", phase);
}

export function setBudget(budget: number): void {
  setText("td-hud-budget", `$${budget}`);
}

export function setBriefing(title: string, body: string): void {
  setText("td-briefing-title", title);
  setText("td-briefing-traffic", body);
  setText("td-briefing-budget", "");
  setText("td-briefing-threshold", "");
  setText("td-briefing-components", "");
}

export function showLossModal(detail: string): void {
  const modal = document.getElementById("td-loss-modal");
  if (modal) modal.hidden = false;
  setText("td-loss-modal-detail", detail);
}

export function hideLossModal(): void {
  const modal = document.getElementById("td-loss-modal");
  if (modal) modal.hidden = true;
}
```

### Step 3: Bootstrap (skeleton — full wiring in later tasks)

`src/dashboard/physics-td/physics-td.ts`:

```ts
// Force cyberpunk HUD activation (depends on ?renderer=iso URL flag).
if (!new URLSearchParams(window.location.search).has("renderer")) {
  const url = new URL(window.location.href);
  url.searchParams.set("renderer", "iso");
  window.location.replace(url.toString());
}

import { activateCyberpunkHud } from "@dashboard/cyberpunk-hud";
import { CyberpunkTopologyRenderer } from "@dashboard/render/cyberpunk-topology-renderer";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { PhysicsCampaignController } from "./campaign-controller";
import { COMPONENT_COSTS } from "./component-factory";
import { CAMPAIGN_WAVES } from "./waves";
import * as hud from "./hud-bridge";
import type { ComponentId } from "@core/types/ids";

async function main(): Promise<void> {
  activateCyberpunkHud();

  const host = document.getElementById("canvas-host");
  if (!host) throw new Error("canvas-host missing");

  const renderer = new CyberpunkTopologyRenderer();
  await renderer.mount(host);
  renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () => renderer.resize(window.innerWidth, window.innerHeight));

  // Sim placeholder — real wave-driven sim per build phase comes in Task 5+.
  const sim = new Sim({ seed: 1 });

  const controller = new PhysicsCampaignController({
    waves: CAMPAIGN_WAVES.map((w) => ({ id: w.id, startBudget: w.startBudget })),
    componentCosts: COMPONENT_COSTS,
    callbacks: {
      onPlaced: (type, id, gridPos) => {
        // Wired in Task 5
        console.log("placed", type, id, gridPos);
      },
      onConnected: (sourceId, targetId, forwardId, backId) => {
        // Wired in Task 6
        console.log("connected", sourceId, targetId, forwardId, backId);
      },
      onPhaseChange: (phase, waveIndex) => {
        const wave = CAMPAIGN_WAVES[waveIndex];
        hud.setPhase(phase);
        hud.setWavePill(waveIndex + 1, CAMPAIGN_WAVES.length);
        if (phase === "build" && wave) {
          hud.setBriefing(wave.title, wave.briefing);
          hud.setStatus("Build phase — place components and click READY");
          hud.hideLossModal();
        } else if (phase === "simulate") {
          hud.setStatus("Wave running…");
        } else if (phase === "won") {
          hud.setStatus("Wave WON — click NEXT to advance");
        } else if (phase === "lost") {
          hud.showLossModal("SLA failed — try a different topology");
        } else if (phase === "campaign-complete") {
          hud.setStatus("Campaign complete — well played!");
        }
      },
      onBudgetChange: (b) => hud.setBudget(b),
    },
  });

  // Initial paint
  hud.setWavePill(1, CAMPAIGN_WAVES.length);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hud.setBriefing(CAMPAIGN_WAVES[0]!.title, CAMPAIGN_WAVES[0]!.briefing);

  // Keep references alive
  void sim;
  void renderer;
}

void main();
```

### Step 4: Vite config

Read `vite.config.ts`. If `build.rollupOptions.input` exists as a map, add:

```ts
"physics-td": resolve(__dirname, "src/dashboard/physics-td/physics-td.html"),
```

If no explicit input map, dev server auto-discovers; production build will need this added later.

### Step 5: Verify dev server picks it up

```bash
# Dev server is already running on :5173 from the previous demo. If not:
# cd /Users/.../.worktrees/physics-sim && pnpm dev (background)
curl -sI 'http://localhost:5173/dashboard/physics-td/physics-td.html?renderer=iso' | head -5
# expect 200
```

(You may need to use the actual served path — try `/sim-demo/physics-demo.html` for reference; the path may be `/dashboard/...` or `/src/dashboard/...`.)

### Step 6: Commit

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(physics-td): bootstrap entry + HUD bridge — wave/phase/budget readouts wired"
```

At this point: opening the page shows the cyberpunk HUD with wave pill, budget, briefing for Wave 1 — but no placement, no READY action yet. Those come next.

---

## Task 5: Placement UX

**Files:**
- Create: `src/dashboard/physics-td/placement-ux.ts`
- Modify: `src/dashboard/physics-td/physics-td.ts` (wire onPlaced + palette buttons)

Click a palette button → enter "placing" mode → renderer shows a ghost following the cursor → click on the grid → controller.tryPlace → bootstrap creates SimComponent + adds to renderer.

### Step 1: Implement `src/dashboard/physics-td/placement-ux.ts`

```ts
import type { TopologyRenderer } from "@dashboard/render/topology-renderer";
import type { Sim } from "@sim/sim";
import type { PhysicsCampaignController } from "./campaign-controller";
import { buildSimComponent, COMPONENT_SPRITE_TYPE, COMPONENT_COSTS } from "./component-factory";
import { setStatus } from "./hud-bridge";
import type { ComponentId } from "@core/types/ids";

export class PlacementUX {
  private placingType: string | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly renderer: TopologyRenderer,
    private readonly controller: PhysicsCampaignController,
  ) {
    this.renderer.onPointerMove((ev) => {
      if (!this.placingType) return;
      this.renderer.setPlacementGhost(this.placingType, { x: ev.screenX, y: ev.screenY });
    });
    this.renderer.onPointerDown((ev) => {
      if (!this.placingType) return;
      const grid = this.renderer.screenToGrid(ev.screenX, ev.screenY);
      const result = this.controller.tryPlace(this.placingType, grid);
      if (!result.ok) {
        setStatus(`Cannot place: ${result.reason}`);
      }
      // Stay in placing mode for fast multi-place; click elsewhere or palette to clear
    });
  }

  enterPlacingMode(type: string): void {
    if (!COMPONENT_COSTS.has(type)) return;
    this.placingType = type;
    setStatus(`Placing ${type} — click grid to place, palette button again to cancel`);
  }

  exitPlacingMode(): void {
    this.placingType = null;
    this.renderer.setPlacementGhost(null, null);
    setStatus("Build phase — place components and click READY");
  }

  /** Apply a successful tryPlace by minting the SimComponent + adding to renderer. */
  applyPlacement(type: string, componentId: ComponentId, gridPos: { x: number; y: number }): void {
    const comp = buildSimComponent(type, componentId);
    if (!comp) return;
    this.sim.addComponent(comp);
    const sprite = COMPONENT_SPRITE_TYPE.get(type) ?? "server";
    this.renderer.addComponent(componentId, {
      type: sprite,
      displayName: `${type}-${(componentId as unknown as string).slice(-3)}`,
      gridPosition: gridPos,
    });
  }
}
```

### Step 2: Wire palette + apply in bootstrap

In `src/dashboard/physics-td/physics-td.ts`:

```ts
import { PlacementUX } from "./placement-ux";
// ...

// After renderer + sim + controller created:
const placement = new PlacementUX(sim, renderer, controller);

// Wire palette buttons
document.querySelectorAll<HTMLButtonElement>(".td-palette-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const type = btn.dataset.type;
    if (type) placement.enterPlacingMode(type);
  });
});

// Wire onPlaced callback to actually mint + render
controller.opts.callbacks.onPlaced = (type, id, gridPos) => placement.applyPlacement(type, id, gridPos);
```

(Note: this requires `controller.opts` to be public, OR pass placement.applyPlacement INTO the controller's callbacks at construction. Refactor to pass at construction.)

Refactor: define the callbacks AFTER placement is created. Move PlacementUX construction before the controller, and pass placement.applyPlacement into the controller callbacks.

### Step 3: Verify in browser

Refresh. Click "+ Server $100" — status bar should say "Placing server…". Click on the grid — Server appears, budget drops to $100. Click "+ Data Cache $150" — placing mode for cache. Click grid — placed, but budget is now $-50 (negative) — verify we don't allow that... actually `tryPlace` rejects insufficient budget so this should fail with "Cannot place: insufficient_budget".

### Step 4: Commit

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(physics-td): placement UX — palette → ghost → grid click → SimComponent"
```

---

## Task 6: Connection draw UX

**Files:**
- Create: `src/dashboard/physics-td/connect-ux.ts`
- Modify: `src/dashboard/physics-td/physics-td.ts` (wire onConnected)

Click a placed component → enter "connecting" mode (source highlighted) → click second component → controller.tryConnect → mint twin pair in sim and renderer.

The renderer already has `setSelected` and `setConnectionMode` hooks. We use `setSelected` to highlight the source.

### Implementation

`src/dashboard/physics-td/connect-ux.ts`:

```ts
import { SimConnection } from "@sim/connection";
import type { TopologyRenderer } from "@dashboard/render/topology-renderer";
import type { Sim } from "@sim/sim";
import type { PhysicsCampaignController } from "./campaign-controller";
import { setStatus } from "./hud-bridge";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

export class ConnectUX {
  private source: ComponentId | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly renderer: TopologyRenderer,
    private readonly controller: PhysicsCampaignController,
    private readonly placementUxIsActive: () => boolean,
  ) {
    this.renderer.onPointerDown((ev) => {
      if (this.placementUxIsActive()) return; // placement claims pointer events first
      if (!ev.hit) {
        // Click empty space cancels selection
        if (this.source) this.cancel();
        return;
      }
      if (this.source === null) {
        this.source = ev.hit.componentId;
        this.renderer.setSelected(this.source);
        this.renderer.setConnectionMode(true);
        setStatus(`Connecting from ${this.source} — click another component to wire`);
        return;
      }
      const target = ev.hit.componentId;
      if (target === this.source) {
        this.cancel();
        return;
      }
      const result = this.controller.tryConnect(this.source, target);
      if (!result.ok) {
        setStatus(`Cannot connect: ${result.reason}`);
      }
      this.cancel();
    });
  }

  applyConnection(sourceId: ComponentId, targetId: ComponentId, forwardId: ConnectionId, backId: ConnectionId): void {
    const forward = new SimConnection({
      id: forwardId,
      from: { componentId: sourceId, portId: "p" as PortId },
      to: { componentId: targetId, portId: "p" as PortId },
      bandwidth: 500, latencySeconds: 0.5, twinId: backId, direction: "forward",
    });
    const back = new SimConnection({
      id: backId,
      from: { componentId: targetId, portId: "p" as PortId },
      to: { componentId: sourceId, portId: "p" as PortId },
      bandwidth: 500, latencySeconds: 0.5, twinId: forwardId, direction: "back",
    });
    this.sim.addConnection(forward);
    this.sim.addConnection(back);
    this.renderer.addConnection(forwardId, sourceId, targetId, { direction: "forward" });
    this.renderer.addConnection(backId, targetId, sourceId, { direction: "back" });
  }

  private cancel(): void {
    this.source = null;
    this.renderer.setSelected(null);
    this.renderer.setConnectionMode(false);
    setStatus("Build phase — place components and click READY");
  }
}
```

### Wire in bootstrap

```ts
const connect = new ConnectUX(sim, renderer, controller, () => /* placing? */ false);
// In controller callbacks:
onConnected: (sId, tId, fId, bId) => connect.applyConnection(sId, tId, fId, bId),
```

The `placementUxIsActive` predicate prevents palette clicks from being misinterpreted as connect-source clicks. Implement by exposing `placement.isPlacing()` getter.

### Commit

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(physics-td): connect UX — click two components to mint twin pair"
```

---

## Task 7: READY → simulate transition + sim driver

**Files:**
- Modify: `src/dashboard/physics-td/physics-td.ts`

When READY is clicked: 
1. The Client component must be added to the sim (with TrafficSource for the current wave)
2. Phase transitions to simulate (controller.ready())
3. BrowserDriver starts ticking the sim
4. Adapter syncs frame
5. After wave duration + drain, evaluate SLA and call controller.onWaveEnd

### Implementation

In `physics-td.ts`, add:

```ts
import { SimClient } from "@sim/client";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { BrowserDriver } from "@dashboard/sim-demo/browser-driver";
import { SimToRendererAdapter } from "@dashboard/sim-demo/sim-to-renderer";
import { runWaveMetrics } from "./wave-runner"; // see below

let driver: BrowserDriver | null = null;
let adapter: SimToRendererAdapter | null = null;
let waveStartTime = 0;
let drainEndTime = 0;
let metricsAccum = { responded: 0, terminated: 0, drops: 0, totalRevenue: 0, latencySum: 0, latencyCount: 0, totalPackets: 0 };
const seenPacketIds = new Set<string>();

document.getElementById("td-ready-btn")!.addEventListener("click", () => {
  if (controller.phase !== "build") return;
  const wave = CAMPAIGN_WAVES[controller.currentWaveIndex];
  if (!wave) return;
  // Mint the Client and add to sim
  const ts = new TrafficSource(wave.wave, makeSimRng(42 + controller.currentWaveIndex));
  const client = new SimClient({
    id: "client" as ComponentId,
    capabilities: [],
    packetRate: wave.wave.packetRate,
    trafficSource: ts,
    waveStartTime: 0,
    waveEndTime: wave.wave.duration,
  });
  sim.addClient(client);
  renderer.addComponent(client.id, { type: "client", displayName: "client", gridPosition: { x: -2, y: 0 } });
  // Note: player must already have a connection from client's chosen position to first component
  // OR we could also auto-connect client to first placed component — for MVP, require the player to wire it

  // Build adapter + driver
  adapter = new SimToRendererAdapter(sim, renderer, new Map());
  driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
  waveStartTime = performance.now();
  drainEndTime = waveStartTime + (wave.wave.duration + 3) * 1000;
  metricsAccum = { responded: 0, terminated: 0, drops: 0, totalRevenue: 0, latencySum: 0, latencyCount: 0, totalPackets: 0 };
  seenPacketIds.clear();

  controller.ready();
});

// Frame loop
let lastFrame = performance.now();
function frame(now: number): void {
  const delta = now - lastFrame;
  lastFrame = now;
  if (driver && adapter) {
    driver.tick(delta);
    for (const p of sim.activePackets) {
      const id = p.id as unknown as string;
      if (!seenPacketIds.has(id) && p.parentId === null) {
        seenPacketIds.add(id);
        metricsAccum.totalPackets += 1;
      }
    }
    for (const ev of sim.lastStepEvents) {
      if (ev.kind === "drop") metricsAccum.drops += ev.count;
      else if (ev.kind === "terminate") {
        metricsAccum.terminated += 1;
        metricsAccum.totalRevenue += ev.revenue;
        metricsAccum.latencySum += ev.latencySeconds;
        metricsAccum.latencyCount += 1;
      } else if (ev.kind === "respond-delivered") {
        metricsAccum.responded += 1;
        metricsAccum.totalRevenue += ev.revenue;
        metricsAccum.latencySum += ev.latencySeconds;
        metricsAccum.latencyCount += 1;
      }
    }
    adapter.syncFrame();

    if (now >= drainEndTime) {
      // Wave done — evaluate SLA
      const wave = CAMPAIGN_WAVES[controller.currentWaveIndex]!;
      const avgLatency = metricsAccum.latencyCount > 0 ? metricsAccum.latencySum / metricsAccum.latencyCount : 0;
      const totalResolved = metricsAccum.responded + metricsAccum.terminated;
      const denom = Math.max(1, metricsAccum.totalPackets);
      const availability = totalResolved / denom;
      const dropRate = metricsAccum.drops / denom;
      const passed =
        availability >= wave.sla.availability &&
        avgLatency <= wave.sla.maxAvgLatencySeconds &&
        dropRate <= wave.sla.maxDropRate;
      driver = null;
      adapter = null;
      controller.onWaveEnd(passed);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

(Placeholder for retry/next-wave click handlers — add to retry button + add a NEXT button if not present.)

### Commit

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(physics-td): READY transition + sim driver + SLA evaluation on wave end"
```

---

## Task 8: Loss/win modals + retry + next-wave

**Files:**
- Modify: `src/dashboard/physics-td/physics-td.ts`

Wire the retry button and add a "next wave" trigger.

```ts
document.getElementById("td-retry-btn")!.addEventListener("click", () => {
  if (controller.phase !== "lost") return;
  // Clear sim + renderer state
  for (const id of [...controller.placedComponents]) {
    sim.components.delete(id);
    renderer.removeComponent(id);
  }
  // Connections too
  // ... iterate sim.connections and remove from both
  for (const id of [...sim.connections.keys()]) {
    sim.connections.delete(id);
    renderer.removeConnection(id);
  }
  // Reset client too (it was added on READY)
  const clientId = "client" as ComponentId;
  if (sim.components.has(clientId)) {
    sim.components.delete(clientId);
    sim.clients.delete(clientId);
    renderer.removeComponent(clientId);
  }
  controller.retry();
});

// On "won" phase, immediately advance to next wave (no manual NEXT for MVP)
const origPhaseChange = ... // wrap the existing onPhaseChange
// Easiest: wire in the phase callback directly:
// when phase becomes "won", call controller.nextWave() after a 2s celebration delay
// For MVP, just advance immediately:
const originalCallbacks = controller.opts.callbacks;
// Wrap onPhaseChange:
controller.opts.callbacks.onPhaseChange = (phase, idx) => {
  originalCallbacks.onPhaseChange(phase, idx);
  if (phase === "won") {
    setTimeout(() => controller.nextWave(), 1500);
  }
};

document.getElementById("td-reset-btn")!.addEventListener("click", () => {
  // For MVP, just reload the page
  window.location.reload();
});
```

(The "wrap the controller callbacks" pattern is hacky. Refactor in Task 9 if time permits.)

### Commit

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(physics-td): retry + auto-advance after win + reset"
```

---

## Task 9: End-to-end manual verification

- [ ] **Step 1: Tests + typecheck**

```bash
pnpm test tests/unit/sim/ tests/unit/dashboard/ tests/integration/sim/ 2>&1 | tail -10
pnpm typecheck 2>&1 | tail -5
```

Expected all green.

- [ ] **Step 2: Browser verification**

Navigate to `http://localhost:5173/dashboard/physics-td/physics-td.html?renderer=iso` (or whatever the actual served path is — adjust if Vite reports differently).

Expected:
- Cyberpunk HUD visible: wave pill ("01 / 04"), budget ($200), briefing panel
- Click "+ Server $100" — palette enters placing mode
- Click on the grid — Server appears, budget drops to $100
- Click another Server (no budget) — should fail with "Cannot place: insufficient_budget"
- Click placed Server — selected highlight appears, status: "Connecting from..."
- Click another component — connection mints (twin pair visible if a second component exists)
- Click READY — Client appears, sim runs, packets flow
- After wave duration + drain — either NEXT WAVE briefing appears (win) or LOSS MODAL appears (fail)
- Click RETRY on loss — components clear, build phase resumes

- [ ] **Step 3: No commit (verification only)**

If any of the above doesn't work, debug and report.

---

## Completion

Plan 6a yields:
- PhysicsCampaignController with phase + economy state machine
- Component factory (6 placeable types)
- 4-wave campaign catalog
- Placement UX (palette → ghost → grid → place)
- Connect UX (click two components → mint twin pair)
- READY transition + sim driver + SLA evaluation
- Loss modal + retry + auto-advance after win
- New entry point at `/dashboard/physics-td/physics-td.html?renderer=iso`

The old dashboard at `/` keeps working off the legacy engine.

## Self-review notes

- **Mirror DOM pattern is intentional shortcut.** The cyberpunk HUD (`cyberpunk-hud.ts`, 612 lines) uses MutationObserver to react to text changes in hidden divs. Rather than refactoring the HUD to take state via a clean controller API, we just write to the hidden divs and let the HUD reflect. Plan 6b can replace this with a proper controller API if the HUD's complexity warrants the rewrite.
- **No multi-wave persistence between waves.** After winning Wave 1 → advance to Wave 2 build phase, the placed components stay (the sim and renderer keep them), and the budget resets to Wave 2's startBudget. The player adds onto their topology rather than rebuilding from scratch each wave. Matches the original game's design.
- **Client component is minted on READY** with a hardcoded grid position `(-2, 0)` and the player must already have the component at the start of their topology connected to that position. For Wave 1, the player places a single Server to the right of (-2, 0) and the system needs them to also draw a connection from Client → Server. **The connect UX as designed only connects player-placed components — Client isn't placeable.** For MVP we'll either (a) auto-connect Client to the leftmost-placed component, or (b) make Client placeable with cost 0 from the palette. Option (a) is more usable; default to it in Task 7's `addClient` step: after adding client, auto-mint a connection from client to the closest placed component.
- **Wave 4 (CDN) skipped from the catalog** because the inline CDNDispatcher capability used in the wave 4 integration test isn't a registered factory — players would need a way to filter `isLarge` in the topology, which requires either (a) building a "CDN" component that uses a dispatcher capability internally, or (b) skipping. (a) is cheap — the component-factory could give CDN a CachingCapability that conditionally caches, but for MVP we skip to keep the surface tight.
- **No auto-routing or layout assistance.** The player must manually arrange components and draw connections. Future polish: snap-to-grid hints, visual indicator of connected vs unconnected components.
- **Pixel-art CDN/Gateway sprites assumed.** The component-layer should already have these in `packetTextures` (or whatever the equivalent map is for component sprites). If sprites are missing, the renderer either crashes or draws blanks — verify in browser.

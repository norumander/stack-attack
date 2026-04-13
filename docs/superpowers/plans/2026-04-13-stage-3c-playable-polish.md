# Stage 3c Playable Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Wave 1–3 learning arc into a playable MVP with a Pixi-based topology renderer, per-request dot visualization, teaching surfaces (briefing card, component info panel, post-wave diagnosis), and a one-line Wave 3 cache-rescue unblocker.

**Architecture:** Engine plumbing lands first (additive changes to state, metrics, events — no Pixi). Then Pixi v8 is introduced behind a `TopologyRenderer` interface; the dashboard's DOM topology gets fully replaced with a Pixi canvas while DOM chrome (palette, HUD, modals, charts) stays DOM. Teaching surfaces and visual polish layer on top.

**Tech Stack:** TypeScript strict + ESM (bundler module resolution, `.js` extensions on `.ts` sources), Vitest, Vite dev server, Pixi.js v8 (new dependency), `pnpm` package manager.

**North-star done-criteria:** A fresh player, given no tutorial, can win Waves 1–2 on first try, lose Wave 3 once, read the diagnosis, and win Wave 3 on second try — without asking "what just happened" or "what does this component do."

**Scope fence:** See `docs/superpowers/specs/2026-04-13-stage-3c-playable-polish-design.md` for the full spec. Everything in that doc's "Out" section stays out.

**Slices:**
- **Slice 1:** Engine plumbing (tasks 1.1–1.8)
- **Slice 2:** Pixi infrastructure (tasks 2.1–2.3)
- **Slice 3:** Pixi renderer + adapter (tasks 3.1–3.11)
- **Slice 4:** Dashboard cutover (tasks 4.1–4.5)
- **Slice 5:** Teaching surfaces (tasks 5.1–5.10)
- **Slice 6:** Visual polish details (tasks 6.1–6.4)
- **Slice 7:** Self-playtest, tune, CLAUDE.md update, merge (tasks 7.1–7.5)

**Baseline before starting:** `pnpm test` green (582 tests), `pnpm typecheck` green, worktree `feature/stage-3c-spec` with the spec already committed. Each slice ends with `pnpm test && pnpm typecheck` green before moving on.

---

## Slice 1 — Engine plumbing

Pure engine/state/type changes. No Pixi. No dashboard changes. All additive. After Slice 1, the engine is ready to feed a renderer but the dashboard is untouched.

### Task 1.1: `state.lastTickEvents` field + `Engine.tick()` clear

**Files:**
- Modify: `src/core/state/simulation-state.ts` — add field + write-through in `appendEvent`
- Modify: `src/core/engine/engine.ts` — clear at start of `tick()`
- Test: `tests/unit/engine-last-tick-events.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/engine-last-tick-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state.js";
import { Engine } from "@core/engine/engine.js";
import { NoOpModeController } from "@harness/noop-mode-controller.js";
import { makeComponent, makeConnection } from "@harness/fixtures.js";
import { RespondingCapability } from "@harness/test-capabilities.js";
import { computeVisitOrder } from "@core/engine/visit-order.js";
import type { RequestId, ComponentId } from "@core/types/ids.js";

describe("state.lastTickEvents", () => {
  it("is an empty array on a fresh state", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(state.lastTickEvents).toEqual([]);
  });

  it("accumulates events during a tick and clears at the start of the next", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const server = makeComponent({
      id: "s1" as ComponentId,
      type: "server",
      capabilities: [new RespondingCapability("resp")],
    });
    state.placeComponent(server);
    state.visitOrder.push(...computeVisitOrder(state.components));

    // Seed a pending request so injectTraffic has no-op, but processing has work.
    state.enqueuePending(server.id, {
      id: "r1" as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: server.id,
      createdAt: 0,
      ttl: 10,
      originZone: "default",
      streamDuration: null,
      streamBandwidth: null,
    });

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: server.id,
      intensity: 0,
      requestType: "api_read",
    });

    engine.tick(mc);

    // After tick 0: lastTickEvents holds whatever was emitted this tick
    // (ENTERED from any traffic + RESPONDED from the processed request).
    const tick0Events = [...state.lastTickEvents];
    expect(tick0Events.length).toBeGreaterThan(0);
    expect(tick0Events.some((e) => e.type === "RESPONDED")).toBe(true);

    // Run a second, quiet tick. lastTickEvents must be cleared at the start,
    // then re-populated only with this tick's events (likely empty).
    engine.tick(mc);
    for (const ev of state.lastTickEvents) {
      expect(ev.tick).toBe(1); // only tick=1 events
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec && pnpm test tests/unit/engine-last-tick-events.test.ts`
Expected: FAIL — `state.lastTickEvents` is undefined.

- [ ] **Step 3: Add the field and write-through in `simulation-state.ts`**

Open `src/core/state/simulation-state.ts`. Find line 21 (`readonly requestLog`) and add after line 21 (right after the `requestLog` field):

```ts
  readonly lastTickEvents: RequestEvent[] = [];
```

Then find the existing `appendEvent` method (line 60) and update it to push to both:

```ts
  appendEvent(requestId: RequestId, event: RequestEvent): void {
    const arr = this.requestLog.get(requestId) ?? [];
    arr.push(event);
    this.requestLog.set(requestId, arr);
    this.lastTickEvents.push(event);
  }
```

- [ ] **Step 4: Clear `lastTickEvents` at the start of `Engine.tick()`**

Open `src/core/engine/engine.ts`. Find the `tick()` method (line 64). Add one line at the top of the method body, before `this.steps.injectTraffic`:

```ts
  tick(modeController: ModeController): void {
    this.state.lastTickEvents.length = 0;                        // clear per-tick view
    this.steps.injectTraffic(this.state, modeController);        // step 1
    // ... rest unchanged
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/unit/engine-last-tick-events.test.ts`
Expected: PASS (both test cases).

Then run the full suite to confirm no regressions:
Run: `pnpm test`
Expected: PASS (583 tests — 582 baseline + 1 new).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(core): stage-3c task 1.1 — state.lastTickEvents per-tick view

Adds a per-tick event array that accumulates during Engine.tick() via
write-through in state.appendEvent, and clears at the start of the next
tick. Used by the Stage 3c Pixi renderer adapter to drive per-request
dot animations.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: `TickMetrics.perConnection` snapshot

**Files:**
- Modify: `src/core/types/metrics.ts` — add optional `perConnection` field
- Modify: `src/core/engine/metrics-builder.ts` — populate from `connectionLoadThisTick`
- Test: `tests/unit/metrics-per-connection.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/metrics-per-connection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state.js";
import { recordMetrics } from "@core/engine/metrics-builder.js";
import type { ConnectionId } from "@core/types/ids.js";

describe("TickMetrics.perConnection", () => {
  it("snapshots connectionLoadThisTick into metrics", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    state.connectionLoadThisTick.set("c1" as ConnectionId, 42);
    state.connectionLoadThisTick.set("c2" as ConnectionId, 7);

    recordMetrics(state);

    const metrics = state.metricsHistory[state.metricsHistory.length - 1]!;
    expect(metrics.perConnection).toBeDefined();
    expect(metrics.perConnection!.get("c1" as ConnectionId)?.loadThisTick).toBe(42);
    expect(metrics.perConnection!.get("c2" as ConnectionId)?.loadThisTick).toBe(7);
  });

  it("produces an empty perConnection map when no loads are recorded", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    recordMetrics(state);
    const metrics = state.metricsHistory[state.metricsHistory.length - 1]!;
    expect(metrics.perConnection).toBeDefined();
    expect(metrics.perConnection!.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm test tests/unit/metrics-per-connection.test.ts`
Expected: FAIL — `metrics.perConnection` is undefined.

- [ ] **Step 3: Add optional `perConnection` field to `TickMetrics`**

Open `src/core/types/metrics.ts`. Add to the interface:

```ts
import type { ComponentId, ConnectionId } from "./ids.js";

export interface TickMetrics {
  readonly tick: number;
  readonly requestsProcessed: number;
  readonly requestsResolved: number;
  readonly requestsDropped: number;
  readonly requestsOverloaded: number;
  readonly requestsBackpressured: number;
  readonly requestsTimedOut: number;
  readonly revenueEarned: number;
  readonly upkeepPaid: number;
  readonly avgLatency: number;
  readonly perComponent: ReadonlyMap<
    ComponentId,
    {
      processed: number;
      dropped: number;
      overloaded: number;
      backpressured: number;
      condition: number;
      timedOut: number;
      pendingAtEndOfTick: number;
      blockedAtEndOfTick: number;
      instanceCount: number;
    }
  >;
  readonly perConnection?: ReadonlyMap<
    ConnectionId,
    { readonly loadThisTick: number }
  >;
}
```

- [ ] **Step 4: Populate `perConnection` in `metrics-builder.ts`**

Open `src/core/engine/metrics-builder.ts`. Before the `state.metricsHistory.push(snapshot);` line at the bottom, build the map and include it:

```ts
  // Snapshot per-connection load BEFORE step 9 clears connectionLoadThisTick.
  const perConnection = new Map<
    ConnectionId,
    { readonly loadThisTick: number }
  >();
  for (const [connId, load] of state.connectionLoadThisTick) {
    perConnection.set(connId, { loadThisTick: load });
  }

  const snapshot: TickMetrics = {
    tick: state.currentTick,
    requestsProcessed: sumProcessed,
    requestsResolved: resolvedCount,
    requestsDropped: sumDropped,
    requestsOverloaded: sumOverloaded,
    requestsBackpressured: sumBackpressured,
    requestsTimedOut: sumTimedOut,
    revenueEarned: state.revenueEarnedThisTick,
    upkeepPaid: state.upkeepPaidThisTick,
    avgLatency,
    perComponent,
    perConnection,
  };
```

Add `ConnectionId` import at the top of the file:

```ts
import type { ComponentId, ConnectionId } from "../types/ids.js";
```

- [ ] **Step 5: Run the test and confirm pass**

Run: `pnpm test tests/unit/metrics-per-connection.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `pnpm test`
Expected: PASS (all existing tests still green; 4 existing tests that construct `TickMetrics` literals are unaffected because `perConnection` is optional).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(core): stage-3c task 1.2 — TickMetrics.perConnection snapshot

Adds optional perConnection field to TickMetrics, populated in
metrics-builder.ts by copying state.connectionLoadThisTick before step
9 clears it. Enables the Stage 3c Pixi renderer adapter to drive
connection-line opacity based on load without reading live
per-tick counters.

Field is optional so the four existing tests that construct TickMetrics
literals (tick-metrics-shape, mode-types, sandbox-mode-controller,
sandbox-metrics-snapshot) don't need updating.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: `FORWARDED` event `metadata.requestType`

**Files:**
- Modify: `src/core/engine/deliver-staged.ts:314-329` — engine-side FORWARDED
- Modify: `src/capabilities/forwarding/forwarding-capability.ts:84-98` — source-side FORWARDED
- Test: `tests/unit/forwarded-event-metadata.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/forwarded-event-metadata.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state.js";
import { Engine } from "@core/engine/engine.js";
import { NoOpModeController } from "@harness/noop-mode-controller.js";
import { makeComponent, makeConnection, makePort } from "@harness/fixtures.js";
import { ForwardingCapability as HarnessForwarding } from "@harness/test-capabilities.js";
import { RespondingCapability } from "@harness/test-capabilities.js";
import type { ComponentId, ConnectionId, RequestId, PortId } from "@core/types/ids.js";

describe("FORWARDED events carry metadata.requestType", () => {
  it("engine target-side FORWARDED has metadata.requestType from the request", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const source = makeComponent({
      id: "src" as ComponentId,
      type: "client",
      capabilities: [new HarnessForwarding("fwd")],
      ports: [makePort({ id: "p-out" as PortId, direction: "egress", capacity: 4 })],
    });
    const target = makeComponent({
      id: "tgt" as ComponentId,
      type: "server",
      capabilities: [new RespondingCapability("resp")],
      ports: [makePort({ id: "p-in" as PortId, direction: "ingress", capacity: 4 })],
    });
    state.placeComponent(source);
    state.placeComponent(target);
    const conn = makeConnection({
      id: "c1" as ConnectionId,
      source: { componentId: source.id, portId: "p-out" as PortId },
      target: { componentId: target.id, portId: "p-in" as PortId },
    });
    state.addConnection(conn);

    state.enqueuePending(source.id, {
      id: "r1" as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: source.id,
      createdAt: 0,
      ttl: 10,
      originZone: "default",
      streamDuration: null,
      streamBandwidth: null,
    });

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: source.id,
      intensity: 0,
      requestType: "api_read",
    });
    engine.tick(mc);

    const forwardedEvents = state.lastTickEvents.filter((e) => e.type === "FORWARDED");
    expect(forwardedEvents.length).toBeGreaterThan(0);
    for (const ev of forwardedEvents) {
      expect(ev.metadata).toBeDefined();
      expect((ev.metadata as { requestType?: string }).requestType).toBe("api_read");
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm test tests/unit/forwarded-event-metadata.test.ts`
Expected: FAIL — `ev.metadata` is undefined.

- [ ] **Step 3: Update engine-side FORWARDED emit in `deliver-staged.ts`**

Open `src/core/engine/deliver-staged.ts`. Find the FORWARD case around line 322-329:

```ts
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: conn.target.componentId,
        capabilityId: null,
        connectionId,
        type: "FORWARDED",
        latencyAdded: 0,
      });
```

Change to:

```ts
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: conn.target.componentId,
        capabilityId: null,
        connectionId,
        type: "FORWARDED",
        latencyAdded: 0,
        metadata: { requestType: request.type },
      });
```

- [ ] **Step 4: Update production `ForwardingCapability` source-side FORWARDED emit**

Open `src/capabilities/forwarding/forwarding-capability.ts`. Find the `process` method around line 84:

```ts
  process(_request: Request, context: ProcessContext): ProcessResult {
    this.forwardedCount += 1;
    const events = this.emitForwardedEvent
      ? [
          {
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "FORWARDED" as const,
            latencyAdded: 0,
          },
        ]
      : [];
    return { outcome: { kind: "FORWARD" }, sideEffects: [], events };
  }
```

Rename `_request` to `request` (drop underscore — it's now used) and add metadata:

```ts
  process(request: Request, context: ProcessContext): ProcessResult {
    this.forwardedCount += 1;
    const events = this.emitForwardedEvent
      ? [
          {
            tick: context.currentTick,
            componentId: context.componentId,
            capabilityId: this.id,
            connectionId: null,
            type: "FORWARDED" as const,
            latencyAdded: 0,
            metadata: { requestType: request.type },
          },
        ]
      : [];
    return { outcome: { kind: "FORWARD" }, sideEffects: [], events };
  }
```

- [ ] **Step 5: Run the test and confirm pass**

Run: `pnpm test tests/unit/forwarded-event-metadata.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `pnpm test`
Expected: PASS. Note — existing integration tests that filter FORWARDED events by `capabilityId !== null` are not affected; they don't assert on `metadata`.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(core): stage-3c task 1.3 — FORWARDED events carry metadata.requestType

Both FORWARDED emit sites (engine target-side in deliver-staged.ts and
source-side in ForwardingCapability) now include metadata.requestType
sourced from the originating Request. The Stage 3c renderer adapter
uses this to color per-request dots by type without needing a separate
RequestId→type map.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: `SERVER_ENTRY.p-in.capacity: 1 → 2`

**Files:**
- Modify: `src/modes/td/td-component-entries.ts:28` — capacity bump
- Test: `tests/unit/server-port-capacity.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/server-port-capacity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SERVER_ENTRY } from "@modes/td/td-component-entries.js";

describe("SERVER_ENTRY.p-in capacity", () => {
  it("has capacity 2 so Wave 3 cache-rescue can land two connections on p-in", () => {
    const pIn = SERVER_ENTRY.ports.find((p) => p.id === "p-in");
    expect(pIn).toBeDefined();
    expect(pIn!.capacity).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm test tests/unit/server-port-capacity.test.ts`
Expected: FAIL — capacity is 1.

- [ ] **Step 3: Bump capacity**

Open `src/modes/td/td-component-entries.ts`. Find line 28:

```ts
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 1, connections: [] },
```

Change to:

```ts
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm test tests/unit/server-port-capacity.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite sanity**

Run: `pnpm test`
Expected: PASS. The `campaign-headless.test.ts` still passes because its 2-server hack topology still works under the new capacity (capacity: 2 is a strict relaxation of 1). Task 1.5 will rewrite that test to use the simpler topology.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(td): stage-3c task 1.4 — SERVER_ENTRY p-in capacity 1 → 2

Unblocks Wave 3 cache-rescue without the 2-server hack. Now the intended
topology (Client→Server direct for writes + Client→Cache→Server for
reads) can land both connections on a single Server's p-in.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.5: Rewrite `campaign-headless.test.ts` Wave 3 to single-server cache rescue

**Files:**
- Modify: `tests/integration/td/campaign-headless.test.ts:114-145` — drop w3Server, wire Cache → w1Server

- [ ] **Step 1: Read the current test Wave 3 section**

Run: `sed -n '95,150p' tests/integration/td/campaign-headless.test.ts` (or read the file directly)

You should see the Wave 3 section where it places a `w3Server` and wires `Client → w3Cache → w3Server → w2Db`.

- [ ] **Step 2: Rewrite the Wave 3 block to use single server**

Open `tests/integration/td/campaign-headless.test.ts`. Replace the section from line 114 (the comment block `// === Wave 3: Cache + second Server rescue ===`) through line 145 (the `expect(w3Outcome.verdict).toBe("win");` line) with:

```ts
    // === Wave 3: Cache rescue on a single Server ===
    // After the SERVER_ENTRY p-in capacity bump (1→2), the intended
    // architectural lesson works with one Server:
    //   Client → w1Server (writes, already wired from Wave 1)
    //   Client → w3Cache → w1Server (new read branch; lands on p-in slot 2)
    //   w1Server → w2Db (writes to DB, already wired from Wave 2)
    // w1Server now serves both the Client direct edge AND the cache branch
    // through its single (capacity-2) ingress port. Cache absorbs repeated
    // reads (pool 15 vs capacity 10 → ~67% hit rate), the uncached reads
    // and all writes fall through to w1Server which has the capacity.
    expect(tdc.getCurrentWave()).toBe(WAVE_3);
    const w3Cache = tdc.tryPlace(state, "cache", { x: 1, y: 1 }, null);
    expect(w3Cache.ok).toBe(true);
    if (!w3Cache.ok) throw new Error("w3Cache placement failed");

    expect(
      tdc.tryConnect(state, client.id, w3Cache.componentId).ok,
    ).toBe(true);
    expect(
      tdc.tryConnect(state, w3Cache.componentId, w1Server.componentId).ok,
    ).toBe(true);

    tdc.advancePhase(state); // build → simulate
    state.recomputeVisitOrder();
    runUntilDrained(state, tdc, engine);
    tdc.advancePhase(state); // simulate → assess
    const w3Outcome = tdc.evaluateOutcome(tdc.getCurrentWaveMetrics(state));
    expect(w3Outcome.verdict).toBe("win");
```

Note: the variable `w1Server` must already exist from Wave 1's section above. If Wave 1 didn't capture it, rename accordingly — check lines 60-80 of the test for the variable name used for the Wave 1 Server placement. It's likely `w1Server` or `wave1Server`.

- [ ] **Step 3: Run the integration test**

Run: `pnpm test tests/integration/td/campaign-headless.test.ts`
Expected: PASS.

If it fails with `port_capacity_exceeded`, double-check Task 1.4 was applied correctly.
If it fails with too many drops, the cache rescue isn't absorbing enough reads — the test may need a tuning pass in Slice 7. Do not tune here; report the failure and wait for Slice 7.

- [ ] **Step 4: Full suite**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
refactor(td-test): stage-3c task 1.5 — campaign-headless W3 single-server rescue

After SERVER_ENTRY.p-in.capacity bump (1→2), Wave 3 cache-rescue works
with a single Server. Drops the w3Server second-Server hack and wires
Client→Cache→w1Server directly. w1Server serves both the original
Client→Server edge (writes) and the new Cache→Server edge (uncached
reads) through its capacity-2 ingress port.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.6: Extend `ComponentRegistryEntry` with optional `longDescription` + `capabilitiesHuman`

**Files:**
- Modify: `src/core/registry/component-registry.ts` — add optional interface fields
- Modify: `src/modes/td/td-component-entries.ts` — populate fields on 5 TD entries
- Test: `tests/unit/component-descriptions.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/component-descriptions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
} from "@modes/td/td-component-entries.js";

const TD_ENTRIES = [
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
];

describe("TD component entries have long descriptions and capability bullets", () => {
  it.each(TD_ENTRIES.map((e) => [e.name, e]))(
    "%s has non-empty longDescription",
    (_name, entry) => {
      expect(entry.longDescription).toBeDefined();
      expect(entry.longDescription!.length).toBeGreaterThan(20);
    },
  );

  it.each(TD_ENTRIES.map((e) => [e.name, e]))(
    "%s has at least 2 capability bullets",
    (_name, entry) => {
      expect(entry.capabilitiesHuman).toBeDefined();
      expect(entry.capabilitiesHuman!.length).toBeGreaterThanOrEqual(2);
      for (const bullet of entry.capabilitiesHuman!) {
        expect(bullet.length).toBeGreaterThan(5);
      }
    },
  );
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm test tests/unit/component-descriptions.test.ts`
Expected: FAIL — fields are undefined.

- [ ] **Step 3: Add the optional fields to `ComponentRegistryEntry`**

Open `src/core/registry/component-registry.ts`. Find the `ComponentRegistryEntry` interface (search for `interface ComponentRegistryEntry` or `type ComponentRegistryEntry`). Add two optional fields:

```ts
export interface ComponentRegistryEntry {
  type: string;
  name: string;
  description: string;
  /** Stage 3c+: 1-2 paragraph role explanation for the TD info panel. */
  longDescription?: string;
  /** Stage 3c+: human-readable capability bullets for the TD info panel. */
  capabilitiesHuman?: string[];
  // ... all other existing fields unchanged
}
```

- [ ] **Step 4: Populate the fields on all 5 TD entries**

Open `src/modes/td/td-component-entries.ts`. For each of the 5 entries (`SERVER_ENTRY`, `DATABASE_ENTRY`, `CACHE_ENTRY`, `LOAD_BALANCER_ENTRY`, `CLIENT_ENTRY`), add `longDescription` and `capabilitiesHuman` fields. Use real architecture terminology — no game jargon.

For `SERVER_ENTRY` (after the existing `description` field on line 21):

```ts
  description: "Handles incoming requests. The workhorse of your architecture.",
  longDescription:
    "A Server accepts requests from clients, processes them, and returns responses. " +
    "It can also forward writes to a downstream database. Without a database wired in, " +
    "write requests have nowhere to land and get dropped. Throughput is capped per tick — " +
    "under sustained load beyond that cap the server sheds traffic rather than queue it.",
  capabilitiesHuman: [
    "Processes API reads directly (returns a response)",
    "Forwards writes to a downstream database",
    "Emits health metrics each tick",
    "Throughput: 20 reads + 12 write-forwards per tick at tier 1",
  ],
```

For `DATABASE_ENTRY`:

```ts
  description: "Persists data so your servers don't have to remember everything.",
  longDescription:
    "A Database accepts write requests from servers and stores them durably. It has its " +
    "own throughput budget independent of the servers in front of it, so adding a database " +
    "relieves write pressure on servers. Databases don't forward anywhere — they're a terminal " +
    "sink for writes in your pipeline.",
  capabilitiesHuman: [
    "Stores writes durably (responds to write requests)",
    "Higher write throughput than a server (25/tick at tier 1)",
    "Emits health metrics each tick",
  ],
```

For `CACHE_ENTRY`:

```ts
  description: "Remembers recent responses so your database doesn't get hammered twice.",
  longDescription:
    "A Cache intercepts reads before they reach your server. If the cache has seen the same " +
    "read recently (a 'hit'), it responds immediately — no load on your server. If it hasn't " +
    "(a 'miss'), it forwards the request downstream and remembers the response for next time. " +
    "Caches help most when reads repeat; they help least when every read is unique.",
  capabilitiesHuman: [
    "Responds directly on cache hit (fast path)",
    "Forwards misses to downstream server",
    "Absorbs repeated reads — effective when traffic has hot keys",
    "Does not help write traffic",
  ],
```

For `LOAD_BALANCER_ENTRY`:

```ts
  description: "Splits traffic across multiple servers so no single one gets overwhelmed.",
  longDescription:
    "A Load Balancer sits in front of multiple servers and splits incoming traffic across " +
    "them. It has no throughput cap of its own — the bottleneck moves to whichever server " +
    "is slowest. Useful when one server isn't enough but you don't want to cache. Only works " +
    "if you actually connect multiple servers behind it.",
  capabilitiesHuman: [
    "Distributes requests across connected downstream targets",
    "Picks healthier servers first (condition-weighted)",
    "Falls back to round-robin when all targets are saturated",
    "Unbounded throughput (bottleneck is downstream)",
  ],
```

For `CLIENT_ENTRY`:

```ts
  description: "Traffic entry point. Forwards requests into the architecture.",
  longDescription:
    "The Client is the entry point for all user traffic. Traffic injection lands here; " +
    "the Client then forwards each request to whatever it's connected to. A Client " +
    "with no outbound connection silently drops all traffic.",
  capabilitiesHuman: [
    "Entry point for user traffic",
    "Forwards all requests to connected downstream components",
    "No internal processing — pass-through only",
  ],
```

- [ ] **Step 5: Run the test and confirm pass**

Run: `pnpm test tests/unit/component-descriptions.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `pnpm test`
Expected: PASS. The 14 sandbox entries in `src/core/registry/component-entries.ts` are untouched — the new fields are optional, so typecheck stays green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(td): stage-3c task 1.6 — longDescription + capabilitiesHuman on TD entries

Extends ComponentRegistryEntry with two optional fields (longDescription,
capabilitiesHuman) and populates them for the 5 TD entries (Client,
Server, Database, Cache, Load Balancer). The 14 sandbox entries in
component-entries.ts are intentionally left untouched — sandbox mode
doesn't consume these in Stage 3c.

Consumed by the TD-mode component info panel and pre-wave briefing card
in later Stage 3c slices.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.7: Slice 1 push

- [ ] **Step 1: Final slice-boundary check**

Run: `pnpm test && pnpm typecheck`
Expected: all 587 tests pass (582 baseline + 5 new), typecheck clean.

- [ ] **Step 2: Push the branch**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec push -u origin feature/stage-3c-spec
```

Expected: branch pushed to origin.

Slice 1 complete. Engine is ready to feed a Pixi renderer. Dashboard unchanged.

---

## Slice 2 — Pixi infrastructure

Install Pixi, declare the renderer interface, land the isolation invariant test. No implementation yet.

### Task 2.1: Install Pixi v8

**Files:**
- Modify: `package.json` (via pnpm)
- Modify: `pnpm-lock.yaml` (via pnpm)

- [ ] **Step 1: Install pixi.js**

Run: `cd /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec && pnpm add pixi.js`
Expected: pixi.js ^8.x added to `dependencies` in `package.json`, lockfile updated.

- [ ] **Step 2: Verify install**

Run: `node -e "console.log(require('pixi.js/package.json').version)"`
Expected: a version string starting with `8.`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (no code imports Pixi yet).

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add package.json pnpm-lock.yaml
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
chore(deps): stage-3c task 2.1 — add pixi.js v8

New runtime dependency for the Stage 3c topology renderer. Bundled into
the dashboard only; engine code (src/core, src/capabilities) must not
import pixi — enforced by the engine-pixi-isolation invariant test in
task 2.3.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Create `TopologyRenderer` interface

**Files:**
- Create: `src/dashboard/render/topology-renderer.ts`

- [ ] **Step 1: Create the interface file**

Create `src/dashboard/render/topology-renderer.ts`:

```ts
import type { ComponentId, ConnectionId } from "@core/types/ids.js";

/**
 * Stage 3c renderer interface. The dashboard depends on this — NOT on pixi.js
 * directly. The only file that imports pixi is pixi-topology-renderer.ts.
 *
 * Future components and mechanics extend the dashboard's use of this interface;
 * Pixi v8 (or any future renderer swap) is a single-file change.
 */
export interface TopologyRenderer {
  // ─ Lifecycle ──────────────────────────────────────────────────────────
  mount(container: HTMLElement): void;
  destroy(): void;
  resize(width: number, height: number): void;

  // ─ Components ─────────────────────────────────────────────────────────
  addComponent(id: ComponentId, visual: ComponentVisual): void;
  removeComponent(id: ComponentId): void;
  updateComponent(id: ComponentId, update: ComponentUpdate): void;

  // ─ Connections ────────────────────────────────────────────────────────
  addConnection(id: ConnectionId, sourceId: ComponentId, targetId: ComponentId): void;
  removeConnection(id: ConnectionId): void;
  updateConnection(id: ConnectionId, update: ConnectionUpdate): void;

  // ─ Requests (fire-and-forget animations) ──────────────────────────────
  spawnRequestDot(args: SpawnRequestDotArgs): void;

  // ─ One-shot feedback ──────────────────────────────────────────────────
  flashOverload(id: ComponentId): void;
  flashDrop(id: ComponentId): void;

  // ─ Selection + placement preview ──────────────────────────────────────
  setSelected(id: ComponentId | null): void;
  setPlacementGhost(type: string | null, screenPos: { x: number; y: number } | null): void;

  // ─ Input queries (screen-space ↔ world-space) ─────────────────────────
  hitTest(screenX: number, screenY: number): { componentId: ComponentId } | null;
  screenToGrid(screenX: number, screenY: number): { x: number; y: number };
  worldToScreen(gridPos: { x: number; y: number }): { x: number; y: number };

  // ─ Pointer events ─────────────────────────────────────────────────────
  onPointerDown(cb: (ev: RendererPointerEvent) => void): () => void;
  onPointerMove(cb: (ev: RendererPointerEvent) => void): () => void;
}

export interface ComponentVisual {
  type: string;                        // 'server' | 'database' | 'cache' | ...
  displayName: string;
  gridPosition: { x: number; y: number };
}

export interface ComponentUpdate {
  utilization?: number;   // 0..1 → color lerp (green → yellow → red)
  condition?: number;     // 0..1 → health ring arc length
  pendingCount?: number;  // displayed in the component label
  gridPosition?: { x: number; y: number };
}

export interface ConnectionUpdate {
  loadUtilization?: number; // 0..1 → line opacity / thickness
}

export interface SpawnRequestDotArgs {
  connectionId: ConnectionId;
  requestType: string;     // 'api_read' | 'api_write' | 'stream_init' | ...
  durationMs: number;      // travel time from source to target
}

export interface RendererPointerEvent {
  screenX: number;
  screenY: number;
  hit: { componentId: ComponentId } | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add src/dashboard/render/
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(dashboard): stage-3c task 2.2 — TopologyRenderer interface

Declares the abstraction the dashboard depends on. Future implementation
files (Pixi or otherwise) implement this interface; everything above
the renderer depends on the interface, never on pixi directly. This is
the seam that keeps the engine-pixi isolation invariant enforceable.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.3: engine-pixi isolation invariant test

**Files:**
- Test: `tests/unit/engine-pixi-isolation.test.ts` (NEW)

- [ ] **Step 1: Open the existing grep-invariant test for reference**

Run: `cat tests/unit/effective-latency.test.ts` and look at how it uses `readFileSync`/`readdirSync` to grep source files. Copy the pattern.

- [ ] **Step 2: Create the test**

Create `tests/unit/engine-pixi-isolation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCANNED_DIRS = ["src/core", "src/capabilities"] as const;

/** Recursively collect .ts source files (not test files) under `dir`. */
function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTsFiles(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("engine and capabilities do not import pixi.js", () => {
  it("no source file under src/core/** or src/capabilities/** imports from 'pixi.js'", () => {
    const offenders: string[] = [];
    for (const rel of SCANNED_DIRS) {
      const files = collectTsFiles(join(ROOT, rel));
      for (const file of files) {
        const content = readFileSync(file, "utf-8");
        // Match `from "pixi.js"` or `import "pixi.js"` (with any quote style).
        if (/\bfrom\s+["']pixi\.js["']|\bimport\s+["']pixi\.js["']/.test(content)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test and confirm pass**

Run: `pnpm test tests/unit/engine-pixi-isolation.test.ts`
Expected: PASS — no engine code imports pixi yet (and it should never).

- [ ] **Step 4: Full suite**

Run: `pnpm test`
Expected: PASS (588 tests).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add tests/unit/engine-pixi-isolation.test.ts
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
test(invariant): stage-3c task 2.3 — engine-pixi isolation

Grep-invariant test that scans src/core/** and src/capabilities/** for
imports of 'pixi.js'. Follows the same readFileSync/readdirSync pattern
as tests/unit/effective-latency.test.ts. Guarantees the Phase-1
framework-agnostic simulation layer never takes a Pixi dependency even
after Pixi lands in the dashboard.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Slice 2 complete. Pixi is installed, the interface is declared, the isolation invariant holds.

---

## Slice 3 — Pixi renderer + adapter

Build the Pixi implementation of `TopologyRenderer`, plus the pure helpers and the state-to-renderer adapter. The renderer is not yet wired to the live dashboard — Slice 4 handles that. Verification in Slice 3 is unit tests on pure helpers plus a typecheck-clean build.

**IMPORTANT for the implementer:** Pixi v8 has breaking changes from v7. Do NOT trust memorized v7 API patterns. When in doubt, consult the Pixi v8 docs at https://pixijs.com/8.x/guides. Concretely, Pixi v8 uses:
- `new Application()` returns an Application; call `await app.init({...})` to initialize (async init is new in v8).
- `Graphics` methods are now `graphics.rect(x, y, w, h).fill(color)` — NOT `graphics.beginFill(color).drawRect(...)` (v7).
- `Text` uses `new Text({ text, style })` (option object constructor).
- `Container.addChild(child)` is unchanged.
- `app.ticker.add(fn)` for per-frame callbacks.

### Task 3.1: `utilization-color.ts` pure function + test

**Files:**
- Create: `src/dashboard/render/utilization-color.ts`
- Test: `tests/unit/utilization-color.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/utilization-color.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { utilizationColor } from "../../src/dashboard/render/utilization-color.js";

describe("utilizationColor", () => {
  it("returns pure green at utilization 0", () => {
    expect(utilizationColor(0)).toBe(0x22c55e);
  });

  it("returns yellow-ish at utilization 0.7", () => {
    const c = utilizationColor(0.7);
    // Yellow-ish: high R, high G, low B
    const r = (c >> 16) & 0xff;
    const g = (c >> 8) & 0xff;
    const b = c & 0xff;
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeLessThan(100);
  });

  it("returns red at utilization 1.0 or above", () => {
    expect(utilizationColor(1.0)).toBe(0xef4444);
    expect(utilizationColor(1.5)).toBe(0xef4444);
  });

  it("clamps negative utilization to green", () => {
    expect(utilizationColor(-0.5)).toBe(0x22c55e);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm test tests/unit/utilization-color.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure function**

Create `src/dashboard/render/utilization-color.ts`:

```ts
/**
 * Maps a 0..1 utilization value to an RGB color in the
 * green → yellow → red gradient. Values outside [0, 1] clamp.
 *
 * Gradient anchors:
 *   0.0 → #22c55e (green)
 *   0.7 → #fbbf24 (yellow)
 *   1.0 → #ef4444 (red)
 *
 * Returns a 24-bit integer (0xRRGGBB) suitable for Pixi's Graphics.fill().
 */
export function utilizationColor(utilization: number): number {
  if (utilization <= 0) return 0x22c55e;
  if (utilization >= 1) return 0xef4444;

  const GREEN = [0x22, 0xc5, 0x5e] as const;
  const YELLOW = [0xfb, 0xbf, 0x24] as const;
  const RED = [0xef, 0x44, 0x44] as const;

  if (utilization <= 0.7) {
    // Interpolate green → yellow over [0, 0.7]
    const t = utilization / 0.7;
    return packRgb(
      lerp(GREEN[0], YELLOW[0], t),
      lerp(GREEN[1], YELLOW[1], t),
      lerp(GREEN[2], YELLOW[2], t),
    );
  }
  // Interpolate yellow → red over [0.7, 1.0]
  const t = (utilization - 0.7) / 0.3;
  return packRgb(
    lerp(YELLOW[0], RED[0], t),
    lerp(YELLOW[1], RED[1], t),
    lerp(YELLOW[2], RED[2], t),
  );
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm test tests/unit/utilization-color.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(dashboard): stage-3c task 3.1 — utilization-color helper

Pure function mapping 0..1 utilization to a 24-bit RGB color in the
green → yellow → red gradient. Used by the Pixi renderer to drive
per-component fill color based on per-tick load.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: `PixiTopologyRenderer` — lifecycle, mount, containers

**Files:**
- Create: `src/dashboard/render/pixi-topology-renderer.ts`

This is a larger task. The implementer writes the whole file at once because the pieces are tightly coupled. Run typecheck at the end.

- [ ] **Step 1: Create the Pixi renderer skeleton**

Create `src/dashboard/render/pixi-topology-renderer.ts`:

```ts
import { Application, Container, Graphics, Text } from "pixi.js";
import type {
  TopologyRenderer,
  ComponentVisual,
  ComponentUpdate,
  ConnectionUpdate,
  SpawnRequestDotArgs,
  RendererPointerEvent,
} from "./topology-renderer.js";
import { utilizationColor } from "./utilization-color.js";
import type { ComponentId, ConnectionId } from "@core/types/ids.js";

/** Pixels per grid cell. Matches the old DOM renderer's 40px scale. */
const GRID_CELL_PX = 40;
/** Half-width of a component sprite in pixels. */
const COMPONENT_HALF = 18;

/** Color palette for request dots by request type. */
const REQUEST_TYPE_COLORS: Record<string, number> = {
  api_read: 0x22d3ee,   // cyan
  api_write: 0xec4899,  // magenta
  stream_init: 0xfde047, // yellow
  default: 0x94a3b8,    // slate
};

interface ComponentRenderState {
  id: ComponentId;
  gridPosition: { x: number; y: number };
  displayName: string;
  sprite: Graphics;       // the colored rounded rect
  label: Text;
  ring: Graphics;         // health-condition ring
  container: Container;   // parent of sprite, label, ring
  utilization: number;
  condition: number;
  pendingCount: number;
}

interface ConnectionRenderState {
  id: ConnectionId;
  sourceId: ComponentId;
  targetId: ComponentId;
  line: Graphics;
  loadUtilization: number;
}

interface ActiveDot {
  graphic: Graphics;
  connectionId: ConnectionId;
  startMs: number;
  durationMs: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export class PixiTopologyRenderer implements TopologyRenderer {
  private app: Application | null = null;
  private world: Container | null = null;
  private connectionsLayer: Container | null = null;
  private dotsLayer: Container | null = null;
  private componentsLayer: Container | null = null;
  private selectionLayer: Container | null = null;
  private ghostLayer: Container | null = null;

  private readonly components = new Map<ComponentId, ComponentRenderState>();
  private readonly connections = new Map<ConnectionId, ConnectionRenderState>();

  private readonly dotPool: Graphics[] = [];
  private readonly activeDots: ActiveDot[] = [];
  private readonly DOT_POOL_INITIAL = 1000;

  private selectedId: ComponentId | null = null;
  private ghostType: string | null = null;
  private ghostScreenPos: { x: number; y: number } | null = null;
  private selectionRing: Graphics | null = null;
  private ghostSprite: Graphics | null = null;

  private pointerDownCallbacks: Array<(ev: RendererPointerEvent) => void> = [];
  private pointerMoveCallbacks: Array<(ev: RendererPointerEvent) => void> = [];
  private mountedContainer: HTMLElement | null = null;

  async mount(container: HTMLElement): Promise<void> {
    this.mountedContainer = container;
    const app = new Application();
    await app.init({
      resizeTo: container,
      background: 0x1a1d29,
      antialias: true,
    });
    container.appendChild(app.canvas);
    this.app = app;

    const world = new Container();
    app.stage.addChild(world);
    this.world = world;

    this.connectionsLayer = new Container();
    this.dotsLayer = new Container();
    this.componentsLayer = new Container();
    this.selectionLayer = new Container();
    this.ghostLayer = new Container();

    world.addChild(this.connectionsLayer);
    world.addChild(this.dotsLayer);
    world.addChild(this.componentsLayer);
    world.addChild(this.selectionLayer);
    world.addChild(this.ghostLayer);

    // Pre-allocate the dot pool
    for (let i = 0; i < this.DOT_POOL_INITIAL; i++) {
      this.dotPool.push(new Graphics());
    }

    // Per-frame ticker: animates dots, updates ghost position
    app.ticker.add(() => this.tickFrame());

    // Pointer events
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointerdown", (ev) => {
      const hit = this.hitTest(ev.global.x, ev.global.y);
      const pe: RendererPointerEvent = {
        screenX: ev.global.x,
        screenY: ev.global.y,
        hit,
      };
      for (const cb of this.pointerDownCallbacks) cb(pe);
    });
    app.stage.on("pointermove", (ev) => {
      const hit = this.hitTest(ev.global.x, ev.global.y);
      const pe: RendererPointerEvent = {
        screenX: ev.global.x,
        screenY: ev.global.y,
        hit,
      };
      for (const cb of this.pointerMoveCallbacks) cb(pe);
    });
  }

  destroy(): void {
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
    this.mountedContainer = null;
    this.components.clear();
    this.connections.clear();
    this.activeDots.length = 0;
    this.dotPool.length = 0;
  }

  resize(width: number, height: number): void {
    this.app?.renderer.resize(width, height);
  }

  // ─ Component management ─────────────────────────────────────────────────

  addComponent(id: ComponentId, visual: ComponentVisual): void {
    if (!this.componentsLayer) return;
    const container = new Container();
    const sprite = new Graphics();
    sprite.roundRect(-COMPONENT_HALF, -COMPONENT_HALF, COMPONENT_HALF * 2, COMPONENT_HALF * 2, 6);
    sprite.fill(0x22c55e);
    container.addChild(sprite);

    const label = new Text({
      text: visual.displayName,
      style: {
        fill: 0xffffff,
        fontSize: 11,
        fontFamily: "system-ui, sans-serif",
      },
    });
    label.anchor.set(0.5, 0.5);
    label.x = 0;
    label.y = COMPONENT_HALF + 8;
    container.addChild(label);

    const ring = new Graphics();
    container.addChild(ring);

    container.x = visual.gridPosition.x * GRID_CELL_PX;
    container.y = visual.gridPosition.y * GRID_CELL_PX;
    this.componentsLayer.addChild(container);

    this.components.set(id, {
      id,
      gridPosition: visual.gridPosition,
      displayName: visual.displayName,
      sprite,
      label,
      ring,
      container,
      utilization: 0,
      condition: 1,
      pendingCount: 0,
    });
  }

  removeComponent(id: ComponentId): void {
    const state = this.components.get(id);
    if (!state) return;
    state.container.destroy({ children: true });
    this.components.delete(id);
  }

  updateComponent(id: ComponentId, update: ComponentUpdate): void {
    const state = this.components.get(id);
    if (!state) return;
    if (update.gridPosition) {
      state.gridPosition = update.gridPosition;
      state.container.x = update.gridPosition.x * GRID_CELL_PX;
      state.container.y = update.gridPosition.y * GRID_CELL_PX;
    }
    if (update.utilization !== undefined) {
      state.utilization = update.utilization;
      const color = utilizationColor(update.utilization);
      state.sprite.clear();
      state.sprite.roundRect(
        -COMPONENT_HALF, -COMPONENT_HALF, COMPONENT_HALF * 2, COMPONENT_HALF * 2, 6,
      );
      state.sprite.fill(color);
    }
    if (update.condition !== undefined) {
      state.condition = update.condition;
      state.ring.clear();
      // Draw arc from top, clockwise, spanning condition * 2π
      const arcSpan = Math.max(0, Math.min(1, update.condition)) * Math.PI * 2;
      state.ring.arc(0, 0, COMPONENT_HALF + 4, -Math.PI / 2, -Math.PI / 2 + arcSpan);
      state.ring.stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
    }
    if (update.pendingCount !== undefined) {
      state.pendingCount = update.pendingCount;
      if (update.pendingCount > 0) {
        state.label.text = `${state.displayName} · ${update.pendingCount}`;
      } else {
        state.label.text = state.displayName;
      }
    }
  }

  // ─ Connection management ────────────────────────────────────────────────

  addConnection(id: ConnectionId, sourceId: ComponentId, targetId: ComponentId): void {
    if (!this.connectionsLayer) return;
    const line = new Graphics();
    this.connectionsLayer.addChild(line);
    this.connections.set(id, { id, sourceId, targetId, line, loadUtilization: 0 });
    this.redrawConnection(id);
  }

  removeConnection(id: ConnectionId): void {
    const state = this.connections.get(id);
    if (!state) return;
    state.line.destroy();
    this.connections.delete(id);
  }

  updateConnection(id: ConnectionId, update: ConnectionUpdate): void {
    const state = this.connections.get(id);
    if (!state) return;
    if (update.loadUtilization !== undefined) {
      state.loadUtilization = Math.max(0, Math.min(1, update.loadUtilization));
      this.redrawConnection(id);
    }
  }

  private redrawConnection(id: ConnectionId): void {
    const state = this.connections.get(id);
    if (!state) return;
    const source = this.components.get(state.sourceId);
    const target = this.components.get(state.targetId);
    if (!source || !target) return;
    const x1 = source.gridPosition.x * GRID_CELL_PX;
    const y1 = source.gridPosition.y * GRID_CELL_PX;
    const x2 = target.gridPosition.x * GRID_CELL_PX;
    const y2 = target.gridPosition.y * GRID_CELL_PX;
    const alpha = 0.3 + 0.7 * state.loadUtilization;
    const width = 2 + 2 * state.loadUtilization;
    state.line.clear();
    state.line.moveTo(x1, y1);
    state.line.lineTo(x2, y2);
    state.line.stroke({ color: 0x22c55e, width, alpha });
  }

  // ─ Request dots ─────────────────────────────────────────────────────────

  spawnRequestDot(args: SpawnRequestDotArgs): void {
    const conn = this.connections.get(args.connectionId);
    if (!conn || !this.dotsLayer) return;
    const source = this.components.get(conn.sourceId);
    const target = this.components.get(conn.targetId);
    if (!source || !target) return;

    const graphic = this.dotPool.pop() ?? this.growDotPool();
    const color = REQUEST_TYPE_COLORS[args.requestType] ?? REQUEST_TYPE_COLORS["default"]!;
    graphic.clear();
    this.drawDotShape(graphic, args.requestType, color);
    this.dotsLayer.addChild(graphic);

    const startX = source.gridPosition.x * GRID_CELL_PX;
    const startY = source.gridPosition.y * GRID_CELL_PX;
    const endX = target.gridPosition.x * GRID_CELL_PX;
    const endY = target.gridPosition.y * GRID_CELL_PX;
    graphic.x = startX;
    graphic.y = startY;

    this.activeDots.push({
      graphic,
      connectionId: args.connectionId,
      startMs: performance.now(),
      durationMs: Math.max(50, args.durationMs),
      startX,
      startY,
      endX,
      endY,
    });
  }

  private growDotPool(): Graphics {
    // eslint-disable-next-line no-console
    console.warn("[pixi-renderer] dot pool exhausted, growing dynamically");
    return new Graphics();
  }

  private drawDotShape(g: Graphics, requestType: string, color: number): void {
    // Circle for reads, square for writes, triangle for stream_init.
    if (requestType === "api_write") {
      g.rect(-3, -3, 6, 6).fill(color);
    } else if (requestType === "stream_init") {
      g.poly([0, -4, 4, 3, -4, 3]).fill(color);
    } else {
      g.circle(0, 0, 3).fill(color);
    }
  }

  // ─ Flashes ──────────────────────────────────────────────────────────────

  flashDrop(id: ComponentId): void {
    this.flashComponent(id, 0xef4444);
  }

  flashOverload(id: ComponentId): void {
    this.flashComponent(id, 0xfbbf24);
  }

  private flashComponent(id: ComponentId, color: number): void {
    const state = this.components.get(id);
    if (!state) return;
    const flash = new Graphics();
    flash.roundRect(
      -COMPONENT_HALF - 2, -COMPONENT_HALF - 2, (COMPONENT_HALF + 2) * 2, (COMPONENT_HALF + 2) * 2, 8,
    );
    flash.fill({ color, alpha: 0.7 });
    state.container.addChild(flash);
    const startMs = performance.now();
    const FLASH_MS = 180;
    const step = () => {
      const elapsed = performance.now() - startMs;
      if (elapsed >= FLASH_MS) {
        flash.destroy();
        this.app?.ticker.remove(step);
        return;
      }
      flash.alpha = 0.7 * (1 - elapsed / FLASH_MS);
    };
    this.app?.ticker.add(step);
  }

  // ─ Selection + ghost ────────────────────────────────────────────────────

  setSelected(id: ComponentId | null): void {
    this.selectedId = id;
    if (this.selectionRing) {
      this.selectionRing.destroy();
      this.selectionRing = null;
    }
    if (id === null || !this.selectionLayer) return;
    const state = this.components.get(id);
    if (!state) return;
    const ring = new Graphics();
    ring.circle(0, 0, COMPONENT_HALF + 8);
    ring.stroke({ color: 0x60a5fa, width: 3, alpha: 0.9 });
    ring.x = state.container.x;
    ring.y = state.container.y;
    this.selectionLayer.addChild(ring);
    this.selectionRing = ring;
  }

  setPlacementGhost(type: string | null, screenPos: { x: number; y: number } | null): void {
    this.ghostType = type;
    this.ghostScreenPos = screenPos;
    if (this.ghostSprite) {
      this.ghostSprite.destroy();
      this.ghostSprite = null;
    }
    if (!type || !screenPos || !this.ghostLayer) return;
    const ghost = new Graphics();
    ghost.roundRect(-COMPONENT_HALF, -COMPONENT_HALF, COMPONENT_HALF * 2, COMPONENT_HALF * 2, 6);
    ghost.fill({ color: 0x60a5fa, alpha: 0.35 });
    const grid = this.screenToGrid(screenPos.x, screenPos.y);
    ghost.x = grid.x * GRID_CELL_PX;
    ghost.y = grid.y * GRID_CELL_PX;
    this.ghostLayer.addChild(ghost);
    this.ghostSprite = ghost;
  }

  // ─ Input queries ────────────────────────────────────────────────────────

  hitTest(screenX: number, screenY: number): { componentId: ComponentId } | null {
    // Direct grid-space check against each component's bounding box.
    // Works because the world has no transform applied (pan/zoom deferred).
    for (const [id, state] of this.components) {
      const cx = state.container.x;
      const cy = state.container.y;
      if (
        screenX >= cx - COMPONENT_HALF &&
        screenX <= cx + COMPONENT_HALF &&
        screenY >= cy - COMPONENT_HALF &&
        screenY <= cy + COMPONENT_HALF
      ) {
        return { componentId: id };
      }
    }
    return null;
  }

  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: Math.round(screenX / GRID_CELL_PX),
      y: Math.round(screenY / GRID_CELL_PX),
    };
  }

  worldToScreen(gridPos: { x: number; y: number }): { x: number; y: number } {
    return {
      x: gridPos.x * GRID_CELL_PX,
      y: gridPos.y * GRID_CELL_PX,
    };
  }

  // ─ Pointer handlers ─────────────────────────────────────────────────────

  onPointerDown(cb: (ev: RendererPointerEvent) => void): () => void {
    this.pointerDownCallbacks.push(cb);
    return () => {
      const i = this.pointerDownCallbacks.indexOf(cb);
      if (i >= 0) this.pointerDownCallbacks.splice(i, 1);
    };
  }

  onPointerMove(cb: (ev: RendererPointerEvent) => void): () => void {
    this.pointerMoveCallbacks.push(cb);
    return () => {
      const i = this.pointerMoveCallbacks.indexOf(cb);
      if (i >= 0) this.pointerMoveCallbacks.splice(i, 1);
    };
  }

  // ─ Per-frame animation ──────────────────────────────────────────────────

  private tickFrame(): void {
    const now = performance.now();
    for (let i = this.activeDots.length - 1; i >= 0; i--) {
      const dot = this.activeDots[i]!;
      const t = (now - dot.startMs) / dot.durationMs;
      if (t >= 1) {
        // Retire: remove from layer, return to pool
        this.dotsLayer?.removeChild(dot.graphic);
        this.dotPool.push(dot.graphic);
        this.activeDots.splice(i, 1);
        continue;
      }
      dot.graphic.x = dot.startX + (dot.endX - dot.startX) * t;
      dot.graphic.y = dot.startY + (dot.endY - dot.startY) * t;
    }
  }
}
```

**Note about the `mount` method signature:** The `TopologyRenderer` interface declares `mount(container)` as synchronous (void return), but Pixi v8's `app.init()` is async. The implementer has two choices: (a) change the interface to `mount(container): Promise<void>`, or (b) fire `app.init()` and eat the promise, returning void from `mount` and relying on the dashboard to await an explicit `ready()` method. **Choice (a) is cleaner.** Update the interface in `topology-renderer.ts`:

```ts
mount(container: HTMLElement): Promise<void>;
```

And update the renderer's declaration to match (already shown as `async mount`).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. If the interface change to `Promise<void>` is missing, update it now.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: PASS. The new renderer file is not imported anywhere yet, so nothing executes it — typecheck is the only verification in this slice. The engine-pixi-isolation test continues to pass (the renderer is under `src/dashboard/`, not `src/core/`).

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(dashboard): stage-3c task 3.2 — PixiTopologyRenderer implementation

Full Pixi v8 implementation of TopologyRenderer. Covers lifecycle
(async mount, destroy, resize), component/connection add/update/remove,
pooled request dot animation with shape-by-type (circle/square/triangle),
drop/overload alpha-flash pulses, selection ring, placement ghost,
hit-testing, and pointer event delegation.

Not yet wired to the live dashboard — Slice 4 cutover handles that.
Typecheck clean, no test changes.

Interface `mount` is async (returns Promise<void>) because Pixi v8's
Application.init() is async. Updated TopologyRenderer interface to match.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.3: `state-to-renderer.ts` adapter

**Files:**
- Create: `src/dashboard/render/state-to-renderer.ts`

- [ ] **Step 1: Create the adapter**

Create `src/dashboard/render/state-to-renderer.ts`:

```ts
import type { TopologyRenderer } from "./topology-renderer.js";
import type { SimulationState } from "@core/state/simulation-state.js";
import type { TickMetrics } from "@core/types/metrics.js";
import { componentThroughputPerTick } from "@core/engine/throughput.js";
import { getEffectiveBandwidth } from "@core/engine/effective-bandwidth.js";
import { getEffectiveLatency } from "@core/engine/effective-bandwidth.js";

/**
 * Feeds the Pixi renderer from engine state after each tick.
 *
 * Invoked from SimLoop.onTick, AFTER engine.tick() returns. At that point:
 * - state.metricsHistory[last] holds this tick's TickMetrics.
 * - state.lastTickEvents holds every RequestEvent emitted this tick.
 * - Per-tick counters (connectionLoadThisTick, etc.) are already zeroed;
 *   read per-connection load out of TickMetrics.perConnection instead.
 */
export function applyTickToRenderer(
  state: SimulationState,
  renderer: TopologyRenderer,
  tickIntervalMs: number,
): void {
  const metrics: TickMetrics | undefined =
    state.metricsHistory[state.metricsHistory.length - 1];
  if (!metrics) return;

  // 1. Per-component updates: utilization, condition, pending count.
  for (const [id, comp] of state.components) {
    const m = metrics.perComponent.get(id);
    if (!m) continue;
    const throughput = componentThroughputPerTick(comp);
    const utilization = throughput > 0 ? m.processed / throughput : 0;
    renderer.updateComponent(id, {
      utilization: Math.min(1, utilization),
      condition: m.condition,
      pendingCount: m.pendingAtEndOfTick,
    });
  }

  // 2. Per-connection updates: load opacity.
  if (metrics.perConnection) {
    for (const [connId, connMetrics] of metrics.perConnection) {
      const bandwidth = getEffectiveBandwidth(state, connId);
      const loadUtilization = bandwidth > 0 ? connMetrics.loadThisTick / bandwidth : 0;
      renderer.updateConnection(connId, {
        loadUtilization: Math.min(1, loadUtilization),
      });
    }
  }

  // 3. Spawn request dots for this tick's FORWARDED events.
  //    Engine target-side FORWARDED events carry a connectionId; filter those.
  //    Source-side FORWARDED events from ForwardingCapability have
  //    connectionId: null and are intentionally skipped.
  for (const ev of state.lastTickEvents) {
    if (ev.type !== "FORWARDED") continue;
    if (ev.connectionId === null) continue;
    const requestType =
      (ev.metadata && (ev.metadata as { requestType?: string }).requestType) ?? "default";
    const latencyTicks = getEffectiveLatency(state, ev.connectionId);
    const durationMs = Math.max(50, latencyTicks * tickIntervalMs);
    renderer.spawnRequestDot({
      connectionId: ev.connectionId,
      requestType,
      durationMs,
    });
  }

  // 4. Drop + overload flashes.
  for (const ev of state.lastTickEvents) {
    if (ev.type === "DROPPED") renderer.flashDrop(ev.componentId);
    else if (ev.type === "OVERLOADED") renderer.flashOverload(ev.componentId);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. If `getEffectiveLatency` and `getEffectiveBandwidth` live in different files, adjust the imports. They're in `src/core/engine/effective-bandwidth.ts` per CLAUDE.md's Stage 2b gotcha note ("the sole `Connection.latency` reader").

- [ ] **Step 3: Full suite sanity**

Run: `pnpm test`
Expected: PASS. The adapter is not yet called from anywhere.

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(dashboard): stage-3c task 3.3 — state-to-renderer adapter

applyTickToRenderer() reads TickMetrics + state.lastTickEvents after
engine.tick() and drives: per-component utilization/condition/pending,
per-connection load opacity, per-FORWARDED-event request dot spawning,
and drop/overload flash pulses. Pure translation layer — no engine
dependencies beyond already-exposed read helpers.

Not yet wired. Slice 4 cuts over the dashboard to use this.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Slice 3 complete. Pixi renderer and adapter exist, typecheck clean, all tests pass. Dashboard is still using the DOM/SVG renderer.

---

## Slice 4 — Dashboard cutover

Replace the DOM topology renderer in `td-mode.ts` with the Pixi renderer + adapter. Delete the old SVG/DOM code. Manual smoke test against the done-criteria sentence.

This is the risky slice — the renderer is no longer safely unwired. Run `pnpm dev` and verify the dashboard visually after each step.

### Task 4.1: Replace topology rendering in `td-mode.ts`

**Files:**
- Modify: `src/dashboard/td-mode.ts` — delete DOM rerender, wire Pixi renderer

- [ ] **Step 1: Read the current td-mode.ts structure**

Open `src/dashboard/td-mode.ts` and identify the `createTDDashboard` factory, the inner `rerenderTopology` function, and the `onTopologyClick` handler. Understand where each lives before editing.

- [ ] **Step 2: Rewrite `td-mode.ts` to use the Pixi renderer**

Replace the entire contents of `src/dashboard/td-mode.ts` with a version that:
- Imports `PixiTopologyRenderer` from `./render/pixi-topology-renderer.js`, `TopologyRenderer` type from `./render/topology-renderer.js`, and `applyTickToRenderer` from `./render/state-to-renderer.js`.
- Imports the 5 TD component entries to build a `type → displayName` lookup.
- Keeps the `TDDashboard` interface but adds an `applyTick(state, tickIntervalMs)` method.
- Makes `createTDDashboard` async (awaits `renderer.mount`).
- Seeds the renderer with any pre-existing components/connections (the Client is placed before dashboard creation).
- Wires palette clicks, `renderer.onPointerDown`, and READY button.
- Subscribes `onPointerDown` to handle three cases (hit existing component → connect-or-info; empty while placing → tryPlace; empty while idle → cancel).
- Calls `renderer.addComponent`/`renderer.addConnection` on successful tryPlace/tryConnect.
- Keeps a minimal DOM status banner above the canvas with `pointerEvents: none` and `zIndex: 10` (the old `.td-status` element), updated via `rerenderTopology` and `updateRunningStatus`.
- Deletes ALL the old SVG line drawing, `.td-comp` div creation, and topology click handler code.

The full file content is ~200 lines and close-follows the Stage 3b `td-mode.ts` structure, with the renderer replacing the DOM rerender logic. An implementer can port the Stage 3b file mechanically:
1. Delete everything inside `rerenderTopology` that draws SVG/components.
2. Replace `topologyContainer.addEventListener("click", onTopologyClick)` with `renderer.onPointerDown(...)`.
3. Add renderer bootstrap (`new PixiTopologyRenderer()` + `await renderer.mount(topologyContainer)`).
4. Seed existing state (client already in `state.components`).
5. On successful `tryPlace`/`tryConnect`, call `renderer.addComponent`/`renderer.addConnection`.
6. Add `applyTick` method that calls `applyTickToRenderer`.
7. Update `destroy` to call `renderer.destroy()` and unsubscribe pointer handlers.

**Interface change:** The `TopologyRenderer.mount` method is declared synchronous but Pixi v8's `app.init()` is async. Update `src/dashboard/render/topology-renderer.ts` to declare `mount(container: HTMLElement): Promise<void>`. `PixiTopologyRenderer.mount` from Task 3.2 is already `async`, so this aligns the interface with the implementation.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: errors in `main.ts` because `createTDDashboard` is now async. Fix in Task 4.2.

---

### Task 4.2: Update `main.ts` to await `createTDDashboard` + drive per-tick renderer

**Files:**
- Modify: `src/dashboard/main.ts`

- [ ] **Step 1: Make `bootTDMode` async and await `createTDDashboard`**

Open `src/dashboard/main.ts`. Change `function bootTDMode(): void {` (line 663) to `async function bootTDMode(): Promise<void> {`. Inside the function, change `tdDashboard = createTDDashboard({...})` to `tdDashboard = await createTDDashboard({...})`.

Update the two boot call sites to handle the async nature:
- Line ~822 (`$modeTd.addEventListener("click", () => {`) — change callback to `async () => { ... await bootTDMode(); }`.
- Bottom-of-file line ~849 (`if (location.hash === "#mode=td") { ... bootTDMode(); }`) — leave the fire-and-forget call with a comment noting the promise is intentionally unhandled at module load.

- [ ] **Step 2: Wire per-tick renderer feed inside `tdOnTick`**

Find `function tdOnTick(controller, state)` (line 462). After the existing `tdDashboard?.updateRunningStatus(...)` call (~line 471), add a new line:

```ts
  tdDashboard?.applyTick(state, tdLoop?.tickInterval ?? 200);
```

This ensures per-tick renderer updates (utilization colors, request dots, flashes) fire on every tick.

- [ ] **Step 3: Typecheck + full test suite**

Run: `pnpm typecheck`
Expected: clean.

Run: `pnpm test`
Expected: all green. No unit tests exercise dashboard code.

- [ ] **Step 4: Manual smoke test — dev server boot**

Run: `pnpm dev` in one terminal. Open the browser to the Vite URL. Switch to TD mode.

Expected:
- Pixi canvas renders inside the topology area; the Client sprite is visible.
- Status banner "Click a palette button or click a component to start a connection" above the canvas.
- HUD shows "Wave 1 of 3" and "$500".

Common failure modes:
- Blank canvas → Pixi v8 async init not awaited, or container is 0×0 (check CSS `height` on the topology container).
- Clicks don't register → `app.stage.eventMode = "static"` missing, or hitArea not set.

- [ ] **Step 5: Manual smoke test — Wave 1 play**

1. Click "Server" in the palette. 2. Click an empty canvas cell — a Server sprite appears. 3. Click Client, then click Server — connection line appears. 4. Click READY. 5. Expected: cyan dots flow along the Client→Server edge, Server color stays green (load well within cap), win verdict.

If dots don't render: temporarily add `console.warn("spawned dot", args)` inside `PixiTopologyRenderer.spawnRequestDot` to verify the adapter is reaching it. If it is, the issue is in ticker animation; if not, the issue is in the adapter's event filter.

- [ ] **Step 6: Stop the dev server + verify DOM cleanup**

Stop `pnpm dev`. Verify no dead code remains:

Run: `grep -n "svgNs\|createElementNS\|\.td-comp " src/dashboard/td-mode.ts`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(dashboard): stage-3c task 4.1-4.2 — Pixi dashboard cutover

Replaces the DOM/SVG topology renderer in td-mode.ts with the Stage 3c
PixiTopologyRenderer. Click handlers route through renderer.onPointerDown
with renderer.hitTest and renderer.screenToGrid. Per-tick adapter
(applyTickToRenderer) is invoked from tdOnTick to drive request dot
animations, utilization color lerp, and drop/overload flashes.

createTDDashboard is now async (Pixi v8 Application.init() is async).
bootTDMode awaits it; top-level call sites fire-and-forget.

Old SVG line drawing + .td-comp div layout deleted. The DOM status
banner is kept as a pointerEvents:none overlay above the canvas.

Manual smoke tested: Wave 1 wins, request dots render, utilization
color lerp visible on the Server.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Slice 4 complete. The dashboard now runs Pixi for topology. No teaching surfaces yet — that's Slice 5.

---

## Slice 5 — Teaching surfaces

Pre-wave briefing card, component info panel, post-wave diagnosis. All DOM, all above the Pixi canvas.

### Task 5.1: Pre-wave briefing card HTML + CSS

**Files:**
- Modify: `src/dashboard/index.html` — add briefing card container
- Modify: `src/dashboard/styles.css` — add `.td-briefing` styles

- [ ] **Step 1: Add briefing card element to `index.html`**

Open `src/dashboard/index.html`. Find the TD-mode section (near `#td-hud`). Add:

```html
<div id="td-briefing" class="td-briefing" hidden>
  <div class="td-briefing__title" id="td-briefing-title">Wave</div>
  <div class="td-briefing__body">
    <div class="td-briefing__row"><span class="k">Traffic:</span> <span id="td-briefing-traffic"></span></div>
    <div class="td-briefing__row"><span class="k">Budget:</span> <span id="td-briefing-budget"></span></div>
    <div class="td-briefing__row"><span class="k">Threshold:</span> <span id="td-briefing-threshold"></span></div>
    <div class="td-briefing__row"><span class="k">Components:</span> <span id="td-briefing-components"></span></div>
  </div>
</div>
```

- [ ] **Step 2: Append CSS to `styles.css`**

```css
/* === TD pre-wave briefing === */
.td-briefing {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 260px;
  padding: 12px 14px;
  background: #1a1d29;
  border: 1px solid #2e3344;
  border-radius: 6px;
  color: #e1e4ed;
  font-size: 12px;
  z-index: 15;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.td-briefing[hidden] { display: none; }
.td-briefing__title { font-size: 14px; font-weight: 700; margin-bottom: 8px; color: #60a5fa; }
.td-briefing__row { margin-bottom: 4px; line-height: 1.5; }
.td-briefing__row .k { color: #8b8fa3; font-weight: 500; margin-right: 4px; }
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "feat(dashboard): stage-3c task 5.1 — briefing card HTML + CSS

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.2: `briefing-card.ts` renderer + wire on phase change

**Files:**
- Create: `src/dashboard/td/briefing-card.ts`
- Modify: `src/dashboard/td-mode.ts` — call on phase changes

- [ ] **Step 1: Create the module**

Create `src/dashboard/td/briefing-card.ts`:

```ts
import type { TDWaveDefinition } from "@modes/td/td-waves.js";
import {
  CLIENT_ENTRY, SERVER_ENTRY, DATABASE_ENTRY, CACHE_ENTRY, LOAD_BALANCER_ENTRY,
} from "@modes/td/td-component-entries.js";
import type { ComponentRegistryEntry } from "@core/registry/component-registry.js";

const ENTRY_BY_TYPE: Record<string, ComponentRegistryEntry> = {
  client: CLIENT_ENTRY,
  server: SERVER_ENTRY,
  database: DATABASE_ENTRY,
  cache: CACHE_ENTRY,
  load_balancer: LOAD_BALANCER_ENTRY,
};

export function renderBriefingCard(wave: TDWaveDefinition): void {
  const root = document.getElementById("td-briefing");
  const titleEl = document.getElementById("td-briefing-title");
  const trafficEl = document.getElementById("td-briefing-traffic");
  const budgetEl = document.getElementById("td-briefing-budget");
  const thresholdEl = document.getElementById("td-briefing-threshold");
  const componentsEl = document.getElementById("td-briefing-components");
  if (!root || !titleEl || !trafficEl || !budgetEl || !thresholdEl || !componentsEl) return;

  titleEl.textContent = `Wave ${wave.id} — ${wave.name}`;

  const compBits: string[] = [];
  for (const [type, weight] of wave.composition) {
    compBits.push(`${Math.round(weight * 100)}% ${type.replace("api_", "")}`);
  }
  trafficEl.textContent = `${wave.intensity} req/tick · ${compBits.join(", ")} · TTL ${wave.ttl} · ${wave.duration} ticks`;

  const revenueBits: string[] = [];
  for (const [type, rev] of wave.revenuePerRequestType) {
    revenueBits.push(`$${rev}/${type.replace("api_", "")}`);
  }
  budgetEl.textContent = `$${wave.startingBudget} starting · ${revenueBits.join(", ")}`;
  thresholdEl.textContent = `Drop rate < ${Math.round(wave.dropThreshold * 100)}%`;

  const componentNames = wave.availableComponents
    .map((t) => ENTRY_BY_TYPE[t]?.name ?? t)
    .join(" · ");
  componentsEl.textContent = componentNames;

  root.hidden = false;
}

export function hideBriefingCard(): void {
  const root = document.getElementById("td-briefing");
  if (root) root.hidden = true;
}
```

- [ ] **Step 2: Wire into `td-mode.ts` `refreshHud`**

Add import `import { renderBriefingCard, hideBriefingCard } from "./td/briefing-card.js";` to `td-mode.ts`.

In `refreshHud`, add briefing visibility calls: show during build phase, hide otherwise and hide when campaign complete.

- [ ] **Step 3: Typecheck + manual test**

Run: `pnpm typecheck` — expected clean.

Run: `pnpm dev`. Expected: briefing card visible top-right during Wave 1 build phase, showing "10 req/tick · 100% read · TTL 10 · 30 ticks" etc. Hides when READY is clicked. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "feat(dashboard): stage-3c task 5.2 — briefing card renderer + wiring

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.3: Component info panel HTML + CSS

**Files:**
- Modify: `src/dashboard/index.html` — add info panel container
- Modify: `src/dashboard/styles.css` — add panel styles

- [ ] **Step 1: Add the panel container to `index.html`**

```html
<div id="td-info-panel" class="td-info-panel" hidden>
  <button type="button" class="td-info-panel__close" id="td-info-panel-close">×</button>
  <div class="td-info-panel__header" id="td-info-panel-header"></div>
  <div class="td-info-panel__description" id="td-info-panel-description"></div>
  <div class="td-info-panel__section-title">Capabilities</div>
  <ul class="td-info-panel__caps" id="td-info-panel-caps"></ul>
  <div class="td-info-panel__section-title">Live stats</div>
  <div class="td-info-panel__stats" id="td-info-panel-stats"></div>
</div>
```

- [ ] **Step 2: Append CSS**

```css
.td-info-panel {
  position: fixed; right: 16px; top: 120px; width: 280px;
  max-height: calc(100vh - 160px); overflow-y: auto;
  padding: 14px 16px;
  background: #1a1d29; border: 1px solid #2e3344; border-radius: 8px;
  color: #e1e4ed; font-size: 12px; z-index: 20;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
.td-info-panel[hidden] { display: none; }
.td-info-panel__close {
  position: absolute; top: 6px; right: 8px;
  background: none; border: none; color: #8b8fa3; font-size: 18px;
  cursor: pointer; padding: 0; width: 20px; height: 20px; line-height: 16px;
}
.td-info-panel__close:hover { color: #e1e4ed; }
.td-info-panel__header { font-size: 16px; font-weight: 700; color: #60a5fa; margin-bottom: 8px; padding-right: 20px; }
.td-info-panel__description { line-height: 1.5; margin-bottom: 12px; color: #d1d5db; }
.td-info-panel__section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #8b8fa3; margin-top: 12px; margin-bottom: 6px; font-weight: 600; }
.td-info-panel__caps { list-style: disc inside; padding-left: 0; margin: 0; line-height: 1.6; }
.td-info-panel__stats { font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.6; }
.td-info-panel__stat-row { display: flex; justify-content: space-between; padding: 2px 0; }
.td-info-panel__stat-row .k { color: #8b8fa3; }
.td-info-panel__stat-row .v { color: #e1e4ed; }
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "feat(dashboard): stage-3c task 5.3 — info panel HTML + CSS

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.4: `component-info-panel.ts` renderer + wire to click + per-tick refresh

**Files:**
- Create: `src/dashboard/td/component-info-panel.ts`
- Modify: `src/dashboard/td-mode.ts` — show panel on component click, refresh stats per tick

- [ ] **Step 1: Create the module**

Create `src/dashboard/td/component-info-panel.ts`. The module exports three functions: `showComponentInfoPanel(id, state)`, `hideComponentInfoPanel()`, `updateComponentInfoPanelStats(id, state, metrics)`, and `getOpenInfoPanelComponentId()`.

Implementation notes:
- **Use `textContent` for the description, header, and stats rows.** NEVER use `innerHTML` with dynamic data — `textContent` is safe by default.
- For the capability bullets list, build `<li>` elements via `document.createElement("li")` and set their `.textContent`, then append to the `<ul>`. Clear the list first via `while (capsEl.firstChild) capsEl.removeChild(capsEl.firstChild)`.
- For the stats rows, build each row as two `<div>` children (label + value) inside a wrapper `<div class="td-info-panel__stat-row">`, set `textContent` on each. Clear and rebuild the stats container via `while`-loop removal.
- Read the component from `state.components.get(id)`, look up its TD entry from a local `type → entry` map (same pattern as Task 5.2), read `componentThroughputPerTick(comp)` from `@core/engine/throughput.js` to compute utilization percentage.
- `getOpenInfoPanelComponentId` reads `root.dataset["componentId"]` and returns it as a `ComponentId` or `null`.

- [ ] **Step 2: Wire into `td-mode.ts`**

Add imports:

```ts
import {
  showComponentInfoPanel,
  hideComponentInfoPanel,
  updateComponentInfoPanelStats,
  getOpenInfoPanelComponentId,
} from "./td/component-info-panel.js";
```

In the `renderer.onPointerDown` handler, when a component is hit and cursor is idle (not connecting, not placing), call `showComponentInfoPanel(id, state)` in addition to setting up the connect source. This gives "click a component → see info + start connecting" behavior.

Wire the close button (look up `#td-info-panel-close` after the renderer mounts):

```ts
const closeBtn = document.getElementById("td-info-panel-close");
closeBtn?.addEventListener("click", () => hideComponentInfoPanel());
```

In `applyTick`, after calling `applyTickToRenderer`, refresh panel stats if the panel is open:

```ts
function applyTick(state: SimulationState, tickIntervalMs: number): void {
  applyTickToRenderer(state, renderer, tickIntervalMs);
  const openId = getOpenInfoPanelComponentId();
  if (openId) {
    const metrics = state.metricsHistory[state.metricsHistory.length - 1] ?? null;
    updateComponentInfoPanelStats(openId, state, metrics);
  }
}
```

In `destroy`, remove the close button listener and hide the panel.

- [ ] **Step 3: Typecheck + manual test**

Run: `pnpm typecheck`
Run: `pnpm dev`. Click the Client in TD mode. Expected: info panel opens with "Client" header, long description, capability bullets, and live stats. Close via ×. Click another component and watch stats tick.

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "feat(dashboard): stage-3c task 5.4 — component info panel renderer + wiring

Clicking a component opens a right-side info panel with description,
capability bullets, and live-updating stats (utilization, throughput,
pending, drops, condition, tier). Panel is persistent until closed.
All DOM construction uses textContent / createElement — no innerHTML
with dynamic data.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.5: `diagnose-wave.ts` pure function + unit test

**Files:**
- Create: `src/dashboard/td/diagnose-wave.ts`
- Test: `tests/unit/diagnose-wave.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/diagnose-wave.test.ts`. The test imports `diagnoseWave` from `../../src/dashboard/td/diagnose-wave.js` and covers 5 cases:

1. **Default case:** minimal metrics (few drops, no saturation) → headline matches `/too many|check/i`.
2. **Process throughput bottleneck:** synthetic metrics where one component processes at 95%+ of its throughput for 5+ consecutive ticks with >5% total drop rate → headline matches `/overwhelmed/i`.
3. **Write routing gap:** synthetic wave with `composition: Map([["api_write", 0.3]])`, bottleneck component with no outbound edges to anything declaring `canHandle("api_write")`, bottleneck drop rate > 10% → hint matches `/persists|storage/i`.
4. **TTL timeouts:** metrics with sum(requestsTimedOut) / sum(total) > 0.10 → headline matches `/piling up/i`.
5. **Specificity ordering:** inputs that match BOTH routing gap AND throughput branches → routing gap wins.

Use `makeComponent` from `tests/harness/fixtures.ts` for real Components, `makeConnection` for real Connections. Use `RespondingCapability` from `@harness/test-capabilities` for the "accepts api_write" side.

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm test tests/unit/diagnose-wave.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `diagnoseWave`**

Create `src/dashboard/td/diagnose-wave.ts` implementing the `diagnoseWave` pure function per the spec's Feature 3 section.

Signature:

```ts
export interface Diagnosis {
  headline: string;
  symptom: string;
  hint: string | null;
}

export interface DiagnoseWaveArgs {
  wave: TDWaveDefinition;
  metrics: readonly TickMetrics[];
  components: ReadonlyMap<ComponentId, Component>;
  connections: ReadonlyMap<ConnectionId, Connection>;
}

export function diagnoseWave(args: DiagnoseWaveArgs): Diagnosis;
```

Algorithm:
1. Sum `requestsDropped`, `requestsProcessed`, `requestsTimedOut` across the wave's metrics.
2. Find the component with the highest cumulative drops across the wave → `bottleneckId`.
3. **Branch 1 (write routing gap):** if `wave.composition.get("api_write") > 0` AND the bottleneck has no reachable downstream component whose capabilities declare `canHandle("api_write")` AND bottleneck drop rate > 10%, return the routing-gap diagnosis.
4. **Branch 2 (process throughput):** if the bottleneck has `processed >= componentThroughputPerTick(comp) * 0.95` for 5+ consecutive ticks AND overall drop rate > 5%, return the throughput diagnosis.
5. **Branch 3 (TTL timeouts):** if `totalTimedOut / totalRequests > 0.10`, return the TTL diagnosis.
6. **Branch 4 (default):** generic "too many dropped" message.

For the reachability walk (write-acceptor check), do a BFS from `bottleneckId` over `connections` (source.componentId → target.componentId). At each visited non-origin component, iterate `comp.capabilities.values()` and call `cap.canHandle("api_write", {} as unknown)` — `canHandle` is declared on the `Capability` interface but may throw for capabilities that need a real context. Wrap the call in `try/catch` and treat throws as "does not handle."

Use `titleOf(type)` — a small helper that capitalizes the first letter and replaces underscores — for the component name in the headline/symptom.

- [ ] **Step 4: Run tests until all 5 pass**

Run: `pnpm test tests/unit/diagnose-wave.test.ts`
Expected: all 5 tests pass (no `it.todo`).

If a test fails, iterate on the implementation until it passes. The spec's branch ordering is the contract — don't reorder branches to make tests pass.

- [ ] **Step 5: Full suite**

Run: `pnpm test`
Expected: all green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(dashboard): stage-3c task 5.5 — diagnose-wave pure function

Post-wave diagnosis: four branches ordered by specificity (write routing
gap → process throughput → TTL timeouts → default). Hints point at
symptoms, never at solutions — the player draws the connection to
component descriptions themselves. Five-case unit test covers each
branch plus the specificity ordering.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.6: Wire diagnosis into loss modal + enrich win toast

**Files:**
- Modify: `src/dashboard/main.ts` — plug diagnosis into `showLossModal` and wave-win toast

- [ ] **Step 1: Import the diagnosis function**

Add at the top of `src/dashboard/main.ts`:

```ts
import { diagnoseWave, type Diagnosis } from "./td/diagnose-wave.js";
```

- [ ] **Step 2: Rewrite `showLossModal` to render diagnosis via safe DOM construction**

Open `src/dashboard/main.ts`, find `function showLossModal(outcome: OutcomeReport): void`. Replace its body with diagnosis-aware rendering using only `textContent` and `createElement` — NO `innerHTML`:

```ts
function showLossModal(outcome: OutcomeReport): void {
  const modal = document.getElementById("td-loss-modal");
  const title = document.getElementById("td-loss-modal-title");
  const detail = document.getElementById("td-loss-modal-detail");
  if (!modal || !title || !detail || !tdController || !tdState) return;
  const waveNum = tdController.getCurrentWaveIndex() + 1;
  title.textContent = `Wave ${waveNum} LOST`;

  const metrics = tdController.getCurrentWaveMetrics(tdState);
  const diagnosis = diagnoseWave({
    wave: tdController.getCurrentWave(),
    metrics,
    components: tdState.components,
    connections: tdState.connections,
  });

  // Clear previous content
  while (detail.firstChild) detail.removeChild(detail.firstChild);

  // Headline — red, bold
  const headlineEl = document.createElement("div");
  headlineEl.textContent = diagnosis.headline;
  headlineEl.style.fontWeight = "600";
  headlineEl.style.color = "#ef4444";
  headlineEl.style.marginBottom = "8px";
  detail.appendChild(headlineEl);

  // Symptom — body text
  const symptomEl = document.createElement("div");
  symptomEl.textContent = diagnosis.symptom;
  symptomEl.style.marginBottom = "8px";
  detail.appendChild(symptomEl);

  // Hint — optional, italic gray
  if (diagnosis.hint) {
    const hintEl = document.createElement("div");
    hintEl.textContent = diagnosis.hint;
    hintEl.style.color = "#8b8fa3";
    hintEl.style.fontStyle = "italic";
    detail.appendChild(hintEl);
  }

  // Outcome notes — small trailing annotation
  const notesEl = document.createElement("div");
  notesEl.textContent = outcome.notes.join(" · ");
  notesEl.style.marginTop = "12px";
  notesEl.style.color = "#8b8fa3";
  notesEl.style.fontSize = "11px";
  detail.appendChild(notesEl);

  const retryBtn = document.getElementById("td-retry-btn");
  if (retryBtn) retryBtn.textContent = `Retry Wave ${waveNum}`;
  modal.hidden = false;
}
```

- [ ] **Step 3: Enrich `showWaveResultToast` for wins**

Find `function showWaveResultToast(outcome: OutcomeReport): void`. The win branch currently uses `outcome.notes.join(" · ")`. Replace with a rich summary that pulls from wave metrics:

```ts
  const noteText = outcome.notes.join(" · ");
  if (outcome.verdict === "win" && tdController && tdState) {
    const metrics = tdController.getCurrentWaveMetrics(tdState);
    const totalResolved = metrics.reduce((s, m) => s + m.requestsResolved, 0);
    const totalDropped = metrics.reduce((s, m) => s + m.requestsDropped, 0);
    const totalRev = metrics.reduce((s, m) => s + m.revenueEarned, 0);
    const totalUpkeep = metrics.reduce((s, m) => s + m.upkeepPaid, 0);
    const denom = totalResolved + totalDropped;
    const servedPct = denom > 0 ? Math.round((totalResolved / denom) * 100) : 0;
    toast.textContent = `Wave WIN — ${servedPct}% served · $${totalRev} revenue · $${totalUpkeep} upkeep`;
  } else {
    toast.textContent = `Wave ${outcome.verdict.toUpperCase()} — ${noteText}`;
  }
```

- [ ] **Step 4: Typecheck + manual test**

Run: `pnpm typecheck` — expected clean.

Run: `pnpm dev`. Deliberately lose Wave 2 (place a Server, no Database, click READY). Expected: loss modal shows a diagnosis — headline about writes having nowhere to go, hint mentioning "persists." Win a wave and verify the rich toast summary.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
feat(dashboard): stage-3c task 5.6 — diagnosis in loss modal + rich win toast

Loss modal shows diagnoseWave() output (headline + symptom + hint). All
DOM construction uses textContent + createElement — no innerHTML with
dynamic content. Win toast shows servedPct + revenue + upkeep instead
of outcome.notes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Slice 5 complete. All three teaching surfaces live.

---

## Slice 6 — Visual polish details (verify Slice 3 work in live play)

Slice 3 implemented utilization color lerp, drop/overload flashes, connection load opacity, and health ring inside `PixiTopologyRenderer`. Slice 6 verifies they actually render correctly under live conditions.

### Task 6.1: Live-play polish verification

**Files:** none (verification-only, commit only if fixes are needed)

- [ ] **Step 1: Manual playtest**

Run: `pnpm dev`. In TD mode, play through Waves 1–3. Verify:

1. Server sprite shifts from green → yellow → red as load climbs (most visible during Wave 2 mid-traffic or Wave 3 lone-server run).
2. When the Server drops a request (Wave 2 without Database, Wave 3 lone-server), a red flash pulses on the Server sprite.
3. Connection lines get visibly more opaque and slightly thicker under load (Wave 3 with traffic).
4. Health ring around each component renders as a clockwise arc; under condition decay the arc shrinks.

- [ ] **Step 2: Debug if anything's missing**

If utilization color lerp isn't visible: check the adapter is passing `utilization` in `updateComponent` (not `undefined`). Add a temporary `console.warn("update", id, update)` inside the adapter to trace.

If flashes don't render: check the `DROPPED`/`OVERLOADED` events are actually in `state.lastTickEvents` (they should be). Add a temporary `console.warn("flashing", ev.type, ev.componentId)` inside the adapter's flash loop.

If connection opacity doesn't change: check `TickMetrics.perConnection` is being populated (Task 1.2). Check `getEffectiveBandwidth` returns a sensible non-zero number.

- [ ] **Step 3: Commit fixes (if any)**

If any fixes were made in step 2, commit with message `fix(dashboard): stage-3c task 6.1 — polish wiring fixups`.

If nothing needed fixing, skip the commit.

Slice 6 complete.

---

## Slice 7 — Self-playtest, tune, CLAUDE.md, merge

### Task 7.1: Done-criteria playtest

**Files:** none (verification)

- [ ] **Step 1: Reset and play fresh**

Run: `pnpm dev`. Open the dashboard, switch to TD mode, refresh the page with `#mode=td` hash.

- [ ] **Step 2: Execute the done-criteria playtest**

Walk through the six-step procedure from the spec's "Manual testing" section:

1. Wave 1: place Server, wire Client→Server, READY → expect WIN.
2. Wave 2 first attempt: click READY with just the Server → expect LOSS, diagnosis about writes.
3. Wave 2 retry: place Database, wire Server→Database, READY → expect WIN.
4. Wave 3 first attempt: click READY with Wave 2 topology → expect LOSS, diagnosis about throughput bottleneck.
5. Wave 3 second attempt: place Cache, wire Client→Cache, wire Cache→Server (both Client edges land on Server's capacity-2 `p-in`), READY → expect WIN.
6. Campaign complete modal appears.

If any step fails the expected outcome, root-cause it:
- Bug → fix + commit.
- Tuning → move to Task 7.2.

- [ ] **Step 3: Commit any bug fixes before tuning**

Use descriptive messages like `fix(dashboard): stage-3c task 7.1 — <what broke>`.

---

### Task 7.2: Wave tuning (if needed)

**Files:**
- Modify: `src/modes/td/td-waves.ts` — ONLY if Task 7.1 surfaced tuning needs

- [ ] **Step 1: Identify which wave needs tuning**

Common scenarios:
- Wave 3 first-attempt with Wave 2 topology actually wins (bottleneck isn't hard enough) → raise Wave 3 intensity or tighten dropThreshold.
- Wave 3 second-attempt with cache rescue doesn't win reliably → lower Wave 3 intensity, raise cache hit rate via `readKeyPoolSize`, or widen Cache pool.
- Wave 2 retry isn't quite winning → raise Wave 2 budget or relax dropThreshold.

- [ ] **Step 2: Make minimal adjustments, one knob at a time**

After each tune, re-run the full done-criteria playtest. Don't rewrite the progression — expect ±10-20% nudges.

- [ ] **Step 3: Run `campaign-headless` integration test**

Run: `pnpm test tests/integration/td/campaign-headless.test.ts`
Expected: PASS. If it fails, you've over-tuned.

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "tune(td-waves): stage-3c task 7.2 — wave tuning for playable feel

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7.3: Final full-suite run

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: ~590 tests pass (582 baseline + ~8 new).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Engine-pixi isolation sanity**

Run: `pnpm test tests/unit/engine-pixi-isolation.test.ts`
Expected: PASS (engine stays framework-agnostic).

---

### Task 7.4: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "### Stage 3c engine contract gotchas" section**

Find the existing "Post-3b cleanup pass gotchas" heading. Add ABOVE it (chronological order):

```markdown
### Stage 3c engine contract gotchas

- **`state.lastTickEvents` is the per-tick event view for the renderer.** `state.appendEvent` writes through to both `requestLog` (existing, unbounded) and `lastTickEvents` (per-tick). `Engine.tick()` clears it as its first statement, before step 1. Consumers running AFTER `engine.tick()` returns see exactly this-tick's events.
- **`TickMetrics.perConnection` is optional** — existing tests that construct `TickMetrics` literals without it stay compiling. The Stage 3c Pixi adapter reads it; non-dashboard consumers ignore it.
- **FORWARDED events carry `metadata.requestType`.** Both the engine's target-side emit (`deliver-staged.ts`) and `ForwardingCapability`'s source-side emit (when `emitForwardedEvent: true`) tag their events with `{ requestType: request.type }`. Used by the renderer adapter to color per-request dots without maintaining a separate id→type map.
- **`SERVER_ENTRY.p-in.capacity` is 2.** Wave 3 cache-rescue uses a single Server: Client→Server (writes) + Client→Cache→Server (reads) both land on `p-in`. The Stage 3b 2-server hack is gone from `campaign-headless.test.ts`.
- **`ComponentRegistryEntry` has optional `longDescription` + `capabilitiesHuman`.** TD entries populate them; the 14 sandbox entries in `src/core/registry/component-entries.ts` don't. Consumed by the TD info panel and briefing card.
- **Dashboard topology rendering is Pixi v8, not DOM.** `src/dashboard/render/pixi-topology-renderer.ts` owns the canvas. The dashboard depends on the `TopologyRenderer` interface in `src/dashboard/render/topology-renderer.ts`, not on `pixi.js` directly. `src/dashboard/render/state-to-renderer.ts` is the per-tick adapter that reads `TickMetrics` + `state.lastTickEvents` and drives component/connection/dot updates. `createTDDashboard` is now async because Pixi v8's `Application.init()` is async.
- **Engine-pixi isolation is a tested invariant.** `tests/unit/engine-pixi-isolation.test.ts` scans `src/core/**` and `src/capabilities/**` for `pixi.js` import specifiers. The test must stay green — the engine is framework-agnostic per the Phase 1 scope.
- **Info panel click vs connect flow:** clicking a component in TD build phase both opens the info panel AND initiates a connect (the component becomes the connect source). Click another component to complete the connection; click empty space to cancel.
- **Post-wave diagnosis lives in `src/dashboard/td/diagnose-wave.ts`.** Pure function, 4 branches ordered by specificity: write routing gap → process throughput → TTL timeouts → default. Hints point at symptoms, never at solutions.
- **All dashboard DOM construction with dynamic content uses `textContent` + `createElement`, never `innerHTML`.** XSS defense; enforced culturally.
```

- [ ] **Step 2: Update "Current stage" header**

Find `**Current stage:**` and update:

```markdown
**Current stage:** Phase 1, Stage 3c complete. TD mode is playable end-to-end with Pixi v8 topology rendering, per-request dot visualization, pre-wave briefing card, component info panel, and post-wave diagnosis. ~590 tests, typecheck clean.
```

- [ ] **Step 3: Add nav hub entries**

Find the "Design documents" section list and add:

```markdown
- **`docs/superpowers/specs/2026-04-13-stage-3c-playable-polish-design.md`** — Stage 3c playable polish contracts (Pixi renderer, teaching surfaces, SERVER p-in capacity bump, extended registry entry). Revised across 3 cold-audit rounds.
- **`docs/superpowers/plans/2026-04-13-stage-3c-playable-polish.md`** — Stage 3c implementation plan (~20 tasks across 7 slices).
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec add CLAUDE.md
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec commit -m "$(cat <<'EOF'
docs(claude-md): stage-3c complete — gotchas + nav hub

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.5: Push + finishing

- [ ] **Step 1: Push**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/stage-3c-spec push
```

- [ ] **Step 2: Offer finishing options**

Report completion to the human and offer: (a) merge to `main` directly, or (b) open a PR for review first. Use the `superpowers:finishing-a-development-branch` skill for structured guidance when they pick.

Stage 3c is complete when `main` contains this work and all ~590 tests are green.

---

## Spec-to-plan coverage

Every scope item from the spec maps to at least one task:

| Spec item | Plan task(s) |
|-----------|-------------|
| 1. Pixi v8 renderer for topology canvas | 2.1, 3.2, 4.1 |
| 2. `TopologyRenderer` interface | 2.2 |
| 3. Per-request dot visualization | 3.2, 3.3, 4.2 |
| 4. Per-component utilization color lerp | 3.1, 3.2, 3.3, 6.1 |
| 5. Drop/overload pulse | 3.2, 3.3, 6.1 |
| 6. Connection line opacity/thickness | 3.2, 3.3, 6.1 |
| 7. Pre-wave briefing card | 5.1, 5.2 |
| 8. Component info panel | 5.3, 5.4 |
| 9. Post-wave diagnosis | 5.5, 5.6 |
| 10. `SERVER_ENTRY.p-in` capacity 1→2 | 1.4, 1.5 |
| 11. Extend `ComponentRegistryEntry` | 1.6 |
| `state.lastTickEvents` plumbing | 1.1 |
| `TickMetrics.perConnection` plumbing | 1.2 |
| FORWARDED `metadata.requestType` | 1.3 |
| Engine-pixi isolation invariant | 2.3 |
| Campaign-headless single-server rescue | 1.5 |
| Done-criteria playtest | 7.1 |
| Tuning (if needed) | 7.2 |
| CLAUDE.md update | 7.4 |

**Cut items (per spec "Out" section):** multi-port disambiguation, `tryUpgrade`, `state.placeComponent` auto-refresh (Feature 5 cut in spec round 2), cross-wave carry-over, particle/sound/juice, tutorial modals, Pixi chrome, camera/zoom.

Plan complete.

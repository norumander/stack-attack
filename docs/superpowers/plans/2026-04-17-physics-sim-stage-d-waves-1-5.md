# Physics Sim — Stage D (Waves 1–5 re-authored) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-author Waves 1–5 as physics-sim integration tests. Each wave gets a test file asserting on SLA outcomes (availability, avg latency, drops, revenue) under a specific topology. Loss/win pairs validate the teaching arc: the "wrong" topology fails the SLA, the "right" topology passes.

**Architecture:** Add a small test harness (`runWave` + `evaluateSLA`) that factors out the step loop and metric accumulation. Extend `SimEvent` with latency timestamps so SLA measurement works without per-packet bookkeeping in each test. Add per-type revenue to `WaveDef`. Then author one integration test per win/lose case across five waves.

**Tech Stack:** TypeScript (strict), Vitest, pnpm. Continues in `src/sim/` + `tests/integration/sim/` (new directory for wave-level integration tests).

**Working directory for all tasks:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`

**Stage C precondition:** 57 sim tests pass, full capability roster available.

**Scope cut: Waves 6–10 (Queue/Worker volume, Streaming, GeoRouting, AutoScale) are NOT in this plan.** They need:
- CircuitBreaker (Wave 7) — not yet built
- AutoScale + chaos scheduling (Wave 10) — not yet built
- Full multi-zone traffic generation on TrafficSource (Wave 9) — partial in Stage C

Those land in Plan 4b after Stage E/F, when the renderer and wave-tuning feedback shape their remaining design.

---

## File Structure

**Created:**

```
src/sim/
  sla.ts                          # SLA types + evaluate function
  test-harness.ts                 # runWave(sim, wave, durationSeconds, options) → WaveMetrics

tests/integration/sim/
  waves/
    wave-1-reads.test.ts              # Client → Server: 10 req/sec reads, lone-server wins
    wave-2-reads-writes.test.ts       # Client → Server → DB: 70R/30W, writes routed to DB
    wave-3-lone-loses.test.ts         # Client → Server → DB: 50 req/sec hot reads, DB saturates
    wave-3-cache-rescue.test.ts       # Client → Server → Cache → DB: cache absorbs hot reads
    wave-4-cdn-rescue.test.ts         # Client → CDN → Server → Cache → DB with isLarge mix
    wave-5-gateway-rescue.test.ts     # Client → Gateway → Cache → LB → [Server,Server] → DB
```

**Modified:**

- `src/sim/types.ts` — add `latencySeconds` to `terminate` and `respond-delivered` SimEvents.
- `src/sim/sim.ts` — thread packet spawn time through to event emission so latency is a known quantity.
- `src/sim/wave.ts` — add `revenuePerWrite`, `revenuePerRead`, `revenuePerAuth`, `revenuePerStream` to `WaveDef` (currently those values are capability-local; wave-level defaults make tests readable).
- `src/sim/index.ts` — barrel exports for `sla.ts` and `test-harness.ts`.

---

## Task 1: Latency on events + event-source packet id

**Files:**
- Modify: `src/sim/types.ts` (extend SimEvent)
- Modify: `src/sim/sim.ts` (compute latency from packet.spawnedAt → simTime)
- Test: `tests/unit/sim/event-latency.test.ts`

Latency = `simTime - packet.spawnedAt` at the moment the terminate/respond-delivered event fires. For a respond-delivered, we want *end-to-end* latency: spawn-to-client-receipt, which is naturally `simTime - originalRequestPacket.spawnedAt`. For terminate (writes), same computation against the terminating packet's `spawnedAt` (which traces back to the original via the forward-leg chain — but since each forward creates a new packet with `spawnedAt: ctx.simTime`, we lose the original spawn time at each hop).

**Fix:** `spawnedAt` should propagate through forward-emits as the ORIGINAL spawn time, not reset each hop. Update capabilities to carry `packet.spawnedAt` onto child packets instead of `ctx.simTime`. Audit all capabilities:

- ForwardingCapability: child spawnedAt = parent spawnedAt (fix: was `ctx.simTime`)
- ProcessingCapability: response spawnedAt = parent spawnedAt  
- CachingCapability: children (hits + misses) spawnedAt = parent spawnedAt
- LoadBalancerCapability: children spawnedAt = parent spawnedAt
- GatewayCapability: child spawnedAt = parent spawnedAt
- GeoRoutingCapability: child spawnedAt = parent spawnedAt

- [ ] **Step 1: Update each capability to preserve parent.spawnedAt**

Edit each file in `src/sim/capabilities/`. In each child/response packet literal, replace `spawnedAt: ctx.simTime` with `spawnedAt: packet.spawnedAt`. Leave `spawnedAt` untouched in code that constructs packets NOT derived from an arriving packet (there isn't any in Stage C).

- [ ] **Step 2: Modify `src/sim/types.ts` to add latency field**

Update the two delivery events:

```ts
export type SimEvent =
  | { readonly kind: "drop"; readonly componentId: ComponentId; readonly reason: string; readonly count: number }
  | { readonly kind: "terminate"; readonly componentId: ComponentId; readonly revenue: number; readonly latencySeconds: number }
  | { readonly kind: "respond-delivered"; readonly componentId: ComponentId; readonly revenue: number; readonly latencySeconds: number };
```

- [ ] **Step 3: Update `src/sim/sim.ts` to emit latency**

For `terminate` events in applyOutcome:

```ts
case "terminate": {
  // The packet that terminated is the one being currently dispatched;
  // we compute latency from its spawn to sim.simTime.
  // Access the source packet via a small threading: applyOutcome receives
  // (outcome, componentId, terminatingPacket?). Easiest: pass the packet
  // alongside the outcome for the terminate case.
  // Implementation detail: add `sourcePacketSpawnedAt: number` parameter.
  this.lastStepEvents.push({
    kind: "terminate",
    componentId,
    revenue: outcome.revenue,
    latencySeconds: this.simTime - this.currentArrivalSpawnedAt,
  });
  return;
}
```

Add a private field `currentArrivalSpawnedAt: number = 0` on Sim. Update `dispatchArrival` to set it at the start:

```ts
private dispatchArrival(packet: Packet): void {
  this.currentArrivalSpawnedAt = packet.spawnedAt;
  // ...rest unchanged
```

Same treatment for `respond-delivered` at the back-leg:

```ts
this.lastStepEvents.push({
  kind: "respond-delivered",
  componentId: component.id,
  revenue,
  latencySeconds: this.simTime - packet.spawnedAt,
});
```

For the **LB merge** path, the merged response's `spawnedAt` should be the original pre-split packet's spawn time. In the merge emission, set:

```ts
const merged: Packet = {
  // ...
  spawnedAt: merge.originalSpawnedAt,  // NEW field on merge state
  // ...
};
```

Store `originalSpawnedAt` in the merge state when the split is applied:

```ts
case "split":
  this.mergeByParent.set(outcome.mergeKey, {
    // ...existing fields
    originalSpawnedAt: this.currentArrivalSpawnedAt,
  });
```

- [ ] **Step 4: Fix existing tests that pattern-match terminate/respond-delivered**

The new required field `latencySeconds` will break matchers like `expect(terms[0]).toMatchObject({ kind: "terminate", revenue: 12 })` only if they use strict equality. `toMatchObject` ignores extra properties, so most tests stay green. Typecheck may flag places where terminate/respond-delivered events are constructed as literals in tests. Find and fix:

```bash
cd /Users/normanettedgui/development/capstone/.worktrees/physics-sim
grep -rn 'kind: "terminate"' tests/unit/sim/ src/sim/
grep -rn 'kind: "respond-delivered"' tests/unit/sim/ src/sim/
```

For each literal construction, add `latencySeconds: 0` (or an appropriate value).

- [ ] **Step 5: Write test for latency measurement**

```ts
// tests/unit/sim/event-latency.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

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

describe("event latency", () => {
  beforeEach(() => resetIdCountersForTest());

  it("respond-delivered records end-to-end latency", () => {
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
    sim.spawnPacket(makePacket({ requests: [mkRead()], edgeId: ef.id, speed: ef.speed, spawnedAt: 0, direction: "forward" }));
    // 2 hops × 0.1s = 0.2s expected latency
    let delivered: { latencySeconds: number } | undefined;
    for (let i = 0; i < 30; i += 1) {
      sim.step(1 / 60);
      for (const ev of sim.lastStepEvents) {
        if (ev.kind === "respond-delivered") delivered = { latencySeconds: ev.latencySeconds };
      }
    }
    expect(delivered).toBeDefined();
    expect(delivered!.latencySeconds).toBeGreaterThan(0.15);
    expect(delivered!.latencySeconds).toBeLessThan(0.3);
  });
});
```

- [ ] **Step 6: Run — expect pass**

Run: `pnpm test tests/unit/sim/event-latency.test.ts 2>&1 | tail -10`

Expected: 1 passing.

- [ ] **Step 7: Full sim regression**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: 58 passing (57 prior + 1 new).

- [ ] **Step 8: Typecheck**

Run: `pnpm typecheck 2>&1 | tail -15`

Expected: only the pre-existing `pull-from-buffers.test.ts:81` error.

- [ ] **Step 9: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): latencySeconds on terminate + respond-delivered events"
```

---

## Task 2: Per-type revenue on `WaveDef`

**Files:**
- Modify: `src/sim/wave.ts`

Add per-type revenue defaults to `WaveDef` so integration tests can reference one config instead of wiring revenue into every capability:

```ts
export type WaveRevenue = {
  readonly perRead: number;
  readonly perWrite: number;
  readonly perAuth: number;
  readonly perStream: number;
};

export type WaveDef = {
  readonly intensity: number;
  readonly packetRate: number;
  readonly duration: number;
  readonly composition: WaveComposition;
  readonly keyDistribution: WaveKeyDistribution;
  readonly revenue: WaveRevenue;
  readonly streamConfig?: StreamConfig;
  readonly zoneDistribution?: ReadonlyMap<Zone, number>;
  readonly entryClients: ReadonlyArray<ComponentId>;
};
```

- [ ] **Step 1: Update `src/sim/wave.ts`** — add `WaveRevenue` type and `revenue: WaveRevenue` on `WaveDef`.

- [ ] **Step 2: Fix existing WaveDef literals**

```bash
grep -rn "composition: {" tests/unit/sim/ src/sim/
```

For each WaveDef literal, add:

```ts
revenue: { perRead: 1, perWrite: 1, perAuth: 1, perStream: 1 },
```

(These are placeholder values — wave-level tests override as needed.)

- [ ] **Step 3: Sim regression**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: still 58 passing.

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): WaveDef.revenue — per-type revenue defaults"
```

---

## Task 3: Test harness — `runWave` + `evaluateSLA`

**Files:**
- Create: `src/sim/sla.ts`
- Create: `src/sim/test-harness.ts`
- Modify: `src/sim/index.ts` (barrel)
- Test: `tests/unit/sim/test-harness.test.ts`

### Step 1: Implement `src/sim/sla.ts`

```ts
export type SLAThresholds = {
  readonly availability: number;    // fraction, e.g. 0.95
  readonly maxAvgLatencySeconds: number;
  readonly maxDropRate: number;     // fraction, e.g. 0.05
};

export type WaveMetrics = {
  readonly totalPackets: number;
  readonly responded: number;
  readonly terminated: number;
  readonly drops: number;
  readonly avgLatencySeconds: number;
  readonly totalRevenue: number;
};

export type SLAResult = {
  readonly passed: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly metrics: WaveMetrics;
};

export function evaluateSLA(metrics: WaveMetrics, sla: SLAThresholds): SLAResult {
  const reasons: string[] = [];
  const totalResolved = metrics.responded + metrics.terminated;
  const denom = Math.max(1, metrics.totalPackets);
  const availability = totalResolved / denom;
  const dropRate = metrics.drops / denom;
  if (availability < sla.availability) {
    reasons.push(`availability ${availability.toFixed(3)} < ${sla.availability}`);
  }
  if (metrics.avgLatencySeconds > sla.maxAvgLatencySeconds) {
    reasons.push(`avgLatency ${metrics.avgLatencySeconds.toFixed(3)}s > ${sla.maxAvgLatencySeconds}s`);
  }
  if (dropRate > sla.maxDropRate) {
    reasons.push(`dropRate ${dropRate.toFixed(3)} > ${sla.maxDropRate}`);
  }
  return { passed: reasons.length === 0, reasons, metrics };
}
```

### Step 2: Implement `src/sim/test-harness.ts`

```ts
import type { Sim } from "./sim";
import type { WaveMetrics } from "./sla";

export type RunWaveOptions = {
  readonly durationSeconds: number;
  readonly drainSeconds?: number;  // extra seconds after wave duration for in-flight packets to resolve
  readonly stepSeconds?: number;   // default 1/60
};

export function runWave(sim: Sim, opts: RunWaveOptions): WaveMetrics {
  const step = opts.stepSeconds ?? 1 / 60;
  const totalSimTime = opts.durationSeconds + (opts.drainSeconds ?? 2);
  const totalSteps = Math.ceil(totalSimTime / step);
  let responded = 0;
  let terminated = 0;
  let drops = 0;
  let totalRevenue = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let totalPackets = 0;
  const seenIds = new Set<string>();
  for (let i = 0; i < totalSteps; i += 1) {
    sim.step(step);
    for (const p of sim.activePackets) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        totalPackets += 1;
      }
    }
    for (const ev of sim.lastStepEvents) {
      if (ev.kind === "drop") drops += ev.count;
      if (ev.kind === "terminate") {
        terminated += 1;
        totalRevenue += ev.revenue;
        latencySum += ev.latencySeconds;
        latencyCount += 1;
      }
      if (ev.kind === "respond-delivered") {
        responded += 1;
        totalRevenue += ev.revenue;
        latencySum += ev.latencySeconds;
        latencyCount += 1;
      }
    }
  }
  const avgLatencySeconds = latencyCount > 0 ? latencySum / latencyCount : 0;
  return { totalPackets, responded, terminated, drops, avgLatencySeconds, totalRevenue };
}
```

### Step 3: Update barrel

Add to `src/sim/index.ts`:

```ts
export { evaluateSLA } from "./sla";
export type { SLAThresholds, WaveMetrics, SLAResult } from "./sla";
export { runWave } from "./test-harness";
export type { RunWaveOptions } from "./test-harness";
```

### Step 4: Test (verbatim)

```ts
// tests/unit/sim/test-harness.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave, evaluateSLA } from "@sim";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 3,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 50 },
  revenue: { perRead: 1, perWrite: 1, perAuth: 1, perStream: 1 },
  entryClients: ["client" as ComponentId],
};

describe("runWave + evaluateSLA", () => {
  beforeEach(() => resetIdCountersForTest());

  it("reports availability, latency, and drops from a simple topology", () => {
    const sim = new Sim({ seed: 1 });
    const ts = new TrafficSource(wave, makeSimRng(1));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: wave.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: wave.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: wave.revenue.perRead })],
      capacityPerSecond: 100,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addConnection(new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: client.id, portId: "p" as PortId },
      to: { componentId: server.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "eb" as ConnectionId, direction: "forward",
    }));
    sim.addConnection(new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: server.id, portId: "p" as PortId },
      to: { componentId: client.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "ef" as ConnectionId, direction: "back",
    }));
    const metrics = runWave(sim, { durationSeconds: wave.duration, drainSeconds: 2 });
    expect(metrics.responded).toBeGreaterThanOrEqual(10);
    expect(metrics.drops).toBe(0);
    expect(metrics.avgLatencySeconds).toBeGreaterThan(0);
    const sla = evaluateSLA(metrics, { availability: 0.95, maxAvgLatencySeconds: 1, maxDropRate: 0.05 });
    expect(sla.passed).toBe(true);
  });
});
```

### Step 5: Run + commit

```bash
pnpm test tests/unit/sim/test-harness.test.ts 2>&1 | tail -10
# expect 1 passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): test harness — runWave + evaluateSLA"
```

---

## Task 4: Wave 1 — lone-server win

**Files:**
- Create: `tests/integration/sim/waves/wave-1-reads.test.ts`

Wave 1: trivial reads, Client → Server. Expected to win comfortably.

### Test (verbatim)

```ts
// tests/integration/sim/waves/wave-1-reads.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave, evaluateSLA } from "@sim";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const WAVE_1: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 50 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.95, maxAvgLatencySeconds: 1, maxDropRate: 0.05 };

describe("Wave 1 — Client → Server", () => {
  beforeEach(() => resetIdCountersForTest());

  it("lone server handles 10 req/sec comfortably", () => {
    const sim = new Sim({ seed: 42 });
    const ts = new TrafficSource(WAVE_1, makeSimRng(42));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_1.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_1.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 50,
    });
    sim.addClient(client);
    sim.addComponent(server);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId, from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("ef", client.id, server.id, "forward", "eb"));
    sim.addConnection(mk("eb", server.id, client.id, "back", "ef"));
    const metrics = runWave(sim, { durationSeconds: WAVE_1.duration, drainSeconds: 2 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.drops).toBe(0);
    expect(metrics.totalRevenue).toBeGreaterThan(40);
  });
});
```

### Step 1: Create `tests/integration/sim/waves/` directory if needed, create the test

### Step 2: Run + commit

```bash
pnpm test tests/integration/sim/waves/wave-1-reads.test.ts 2>&1 | tail -10
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): Wave 1 — lone Server passes SLA"
```

---

## Task 5: Wave 2 — reads + writes at Server/DB

**Files:**
- Create: `tests/integration/sim/waves/wave-2-reads-writes.test.ts`

Wave 2: 70/30 read/write mix. Reads served by Server's Processing (respond). Writes are forwarded to DB by Server's Forwarding. DB's Processing terminates writes. Both need to hit SLA.

Topology: `Client ↔ Server ↔ DB`. Server has two capabilities composed: a Processing (handles reads only) and a Forwarding (passes non-reads to DB). But current ProcessingCapability throws on mixed packets, and our dispatchArrival only calls `capabilities[0]`. Workaround: Server's single capability must decide by attribute.

For this stage, use a **helper Processing-with-write-forward** capability that encodes the behavior directly. Cleanest: author an inline `ServerDispatcher` capability for this test that, on arrival, checks isWrite and either responds (reads) or forwards to first egress (writes).

### Test (verbatim)

```ts
// tests/integration/sim/waves/wave-2-reads-writes.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave, evaluateSLA } from "@sim";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

/**
 * Server-style dispatcher: reads respond locally, writes forward to first egress.
 * Packets are uniform (all reads or all writes) so we branch by first request.
 */
class ServerDispatcherCapability implements SimCapability {
  readonly id = "server-dispatcher";
  constructor(private readonly revenuePerRead: number) {}
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const isWrite = packet.requests[0]?.isWrite ?? false;
    if (!isWrite) {
      const response: Packet = {
        id: ctx.mintPacketId(),
        requests: packet.requests,
        edgeId: packet.edgeId,
        progress: 0,
        speed: packet.speed,
        spawnedAt: packet.spawnedAt,
        parentId: packet.id,
        direction: "back",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "respond", responsePacket: response, revenueOnDelivery: this.revenuePerRead * packet.requests.length };
    }
    const egress = ctx.egressEdges[0];
    if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    const child: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: egress.id,
      progress: 0,
      speed: egress.speed,
      spawnedAt: packet.spawnedAt,
      parentId: packet.id,
      direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }
}

const WAVE_2: WaveDef = {
  intensity: 20,
  packetRate: 5,
  duration: 5,
  composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 50 },
  revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.9, maxAvgLatencySeconds: 1, maxDropRate: 0.1 };

describe("Wave 2 — Client ↔ Server ↔ DB", () => {
  beforeEach(() => resetIdCountersForTest());

  it("reads served locally; writes routed to DB; both hit SLA", () => {
    const sim = new Sim({ seed: 99 });
    const ts = new TrafficSource(WAVE_2, makeSimRng(99));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_2.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_2.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ServerDispatcherCapability(WAVE_2.revenue.perRead)],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: WAVE_2.revenue.perWrite, revenuePerRead: 0 })],
      capacityPerSecond: 50,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    sim.addConnection(mk("sd", server.id, db.id, "forward", "ds"));
    sim.addConnection(mk("ds", db.id, server.id, "back", "sd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_2.duration, drainSeconds: 2 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.responded).toBeGreaterThan(0);  // reads delivered
    expect(metrics.terminated).toBeGreaterThan(0); // writes terminated at DB
  });
});
```

### Step 1: Create test, run + commit

```bash
pnpm test tests/integration/sim/waves/wave-2-reads-writes.test.ts 2>&1 | tail -10
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): Wave 2 — Server dispatcher routes writes to DB"
```

---

## Task 6: Wave 3 lone-server loses (DB saturation)

**Files:**
- Create: `tests/integration/sim/waves/wave-3-lone-loses.test.ts`

Wave 3: 50 req/sec of hot-key reads. Even with a healthy Server, a lone `Server → DB` topology loses because DB becomes the bottleneck at 50 reads/sec. We use `Zipf(1.07, 100)` key distribution — hot-key clustering, no cache to exploit.

Topology: `Client ↔ Server ↔ DB`. Server forwards reads (no local cache), DB responds. DB capacity 30/sec — saturates.

### Test (verbatim)

```ts
// tests/integration/sim/waves/wave-3-lone-loses.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave, evaluateSLA } from "@sim";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const WAVE_3: WaveDef = {
  intensity: 50,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.95, maxAvgLatencySeconds: 1, maxDropRate: 0.05 };

describe("Wave 3 — lone Server → DB loses", () => {
  beforeEach(() => resetIdCountersForTest());

  it("fails SLA because DB at 30/sec cannot absorb 50/sec of reads", () => {
    const sim = new Sim({ seed: 7 });
    const ts = new TrafficSource(WAVE_3, makeSimRng(7));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_3.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_3.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 30,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 200, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    sim.addConnection(mk("sd", server.id, db.id, "forward", "ds"));
    sim.addConnection(mk("ds", db.id, server.id, "back", "sd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_3.duration, drainSeconds: 2 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(false); // THIS WAVE IS SUPPOSED TO LOSE
    expect(metrics.drops).toBeGreaterThan(0);
  });
});
```

### Step 1: Create, run + commit

```bash
pnpm test tests/integration/sim/waves/wave-3-lone-loses.test.ts 2>&1 | tail -10
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): Wave 3 — lone Server → DB loses on DB saturation"
```

---

## Task 7: Wave 3 cache-rescue wins

**Files:**
- Create: `tests/integration/sim/waves/wave-3-cache-rescue.test.ts`

Wave 3 rescue: Insert a Data Cache between Server and DB. Zipfian hot-key distribution means the cache will quickly be populated with the hot 10-20 keys, absorbing most of the read volume. DB sees only cold-key misses, which at 30/sec capacity is survivable.

Topology: `Client ↔ Server ↔ Cache ↔ DB`. Server forwards to Cache; Cache splits (hit → respond local, miss → forward to DB); DB responds for misses; responses retrace the twin chain.

### Test (verbatim)

```ts
// tests/integration/sim/waves/wave-3-cache-rescue.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave, evaluateSLA } from "@sim";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const WAVE_3: WaveDef = {
  intensity: 50,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.95, maxAvgLatencySeconds: 1, maxDropRate: 0.05 };

describe("Wave 3 — Data Cache rescue wins", () => {
  beforeEach(() => resetIdCountersForTest());

  it("cache absorbs hot-key reads; DB handles only misses", () => {
    const sim = new Sim({ seed: 7 });
    const ts = new TrafficSource(WAVE_3, makeSimRng(7));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_3.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_3.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
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
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 300, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    sim.addConnection(mk("sk", server.id, cache.id, "forward", "ks"));
    sim.addConnection(mk("ks", cache.id, server.id, "back", "sk"));
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_3.duration, drainSeconds: 3 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.drops).toBe(0);
  });
});
```

### Step 1: Create, run + commit

```bash
pnpm test tests/integration/sim/waves/wave-3-cache-rescue.test.ts 2>&1 | tail -10
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): Wave 3 — Data Cache rescue absorbs hot-key reads"
```

---

## Task 8: Wave 4 — CDN rescue (static_asset traffic)

**Files:**
- Create: `tests/integration/sim/waves/wave-4-cdn-rescue.test.ts`

Wave 4: 80 req/sec with 50% `isLarge` (static). CDN near the client absorbs static traffic; remainder hits the core stack. We use two CachingCapabilities — CDN is tuned for `isLarge` via a new inline decision (CachingCapability doesn't discriminate by attribute in Stage C, so the CDN uses `isLarge` as a gate via a custom cap). For this stage we simplify: CDN is just a second Cache placed upstream; `isLarge` traffic lands there first, non-large passes through to the core.

**Simplification:** Since CachingCapability doesn't filter by attribute, for Wave 4 we use a CDN that intercepts `isLarge` traffic only via a custom `CDNDispatcherCapability` defined inline in the test (similar pattern to Wave 2's ServerDispatcher).

### Test (verbatim)

```ts
// tests/integration/sim/waves/wave-4-cdn-rescue.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave, evaluateSLA } from "@sim";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

/**
 * CDN: isLarge reads respond locally if cached; non-large traffic forwards
 * downstream. Not a cache miss behavior for non-large — just passthrough.
 */
class CDNDispatcherCapability implements SimCapability {
  readonly id = "cdn-dispatcher";
  private readonly cache: CachingCapability;
  constructor(private readonly revenuePerRead: number, capacity: number) {
    this.cache = new CachingCapability({ capacity, revenuePerRead });
  }
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allLarge = packet.requests.every((r) => r.isLarge);
    if (allLarge) return this.cache.onArriveRequest(packet, ctx);
    // non-large: forward to first egress
    const egress = ctx.egressEdges[0];
    if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    const child: Packet = {
      id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
      spawnedAt: packet.spawnedAt, parentId: packet.id, direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }
  onArriveResponse(packet: Packet, ctx: ArrivalContext): void {
    this.cache.onArriveResponse?.(packet, ctx);
  }
}

const WAVE_4: WaveDef = {
  intensity: 80,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0.5, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.9, maxAvgLatencySeconds: 1, maxDropRate: 0.1 };

describe("Wave 4 — CDN + Cache rescue", () => {
  beforeEach(() => resetIdCountersForTest());

  it("CDN absorbs static_asset; core stack handles rest", () => {
    const sim = new Sim({ seed: 11 });
    const ts = new TrafficSource(WAVE_4, makeSimRng(11));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_4.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_4.duration,
    });
    const cdn = new SimComponent({
      id: "cdn" as ComponentId,
      capabilities: [new CDNDispatcherCapability(WAVE_4.revenue.perRead, 32)],
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_4.revenue.perRead })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: WAVE_4.revenue.perRead })],
      capacityPerSecond: 40,
    });
    sim.addClient(client);
    sim.addComponent(cdn);
    sim.addComponent(server);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 300, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cl", client.id, cdn.id, "forward", "lc"));
    sim.addConnection(mk("lc", cdn.id, client.id, "back", "cl"));
    sim.addConnection(mk("ls", cdn.id, server.id, "forward", "sl"));
    sim.addConnection(mk("sl", server.id, cdn.id, "back", "ls"));
    sim.addConnection(mk("sk", server.id, cache.id, "forward", "ks"));
    sim.addConnection(mk("ks", cache.id, server.id, "back", "sk"));
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_4.duration, drainSeconds: 3 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
  });
});
```

### Step 1: Create, run + commit

```bash
pnpm test tests/integration/sim/waves/wave-4-cdn-rescue.test.ts 2>&1 | tail -10
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): Wave 4 — CDN absorbs static_asset traffic"
```

---

## Task 9: Wave 5 — Gateway + LB + 2 servers

**Files:**
- Create: `tests/integration/sim/waves/wave-5-gateway-rescue.test.ts`

Wave 5: 150 req/sec with 20% `requiresAuth` + 50% hot-key reads. Gateway terminates auth traffic (no DB involvement). LB splits non-auth across two Servers. Each Server forwards reads to Cache → DB.

Topology: `Client ↔ Gateway ↔ LB ↔ [Server1, Server2] ↔ Cache ↔ DB`. Gateway has a dispatcher-style cap: auth terminates, non-auth forwards to LB.

**Caveat on Wave 5:** Stage A's LB implementation splits every packet. Since the traffic is a mix of (all-auth packets) and (all-non-auth packets) per one-type-per-packet semantics, the Gateway first filters auth packets out before any reach the LB. That's cleaner than trying to split auth across servers.

Auth packets are ~20% of traffic; non-auth 80%. Of non-auth, a cache hit rate (hot-key) brings the DB load to something like 80% × (1 − hit_rate) × intensity. For 150/sec at hit_rate 80%, DB sees ~24/sec — survivable at capacity 40/sec.

### Test (verbatim)

```ts
// tests/integration/sim/waves/wave-5-gateway-rescue.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { GatewayCapability } from "@sim/capabilities/gateway";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave, evaluateSLA } from "@sim";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const WAVE_5: WaveDef = {
  intensity: 150,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0.2, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 2, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.85, maxAvgLatencySeconds: 1, maxDropRate: 0.15 };

describe("Wave 5 — Gateway + LB + 2 servers", () => {
  beforeEach(() => resetIdCountersForTest());

  it("gateway terminates auth, LB fans out reads across 2 servers backed by cache", () => {
    const sim = new Sim({ seed: 17 });
    const ts = new TrafficSource(WAVE_5, makeSimRng(17));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_5.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_5.duration,
    });
    const gateway = new SimComponent({
      id: "gw" as ComponentId,
      capabilities: [new GatewayCapability({ revenuePerAuth: WAVE_5.revenue.perAuth })],
    });
    const lb = new SimComponent({
      id: "lb" as ComponentId,
      capabilities: [new LoadBalancerCapability()],
    });
    const server1 = new SimComponent({
      id: "server1" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const server2 = new SimComponent({
      id: "server2" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_5.revenue.perRead })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: WAVE_5.revenue.perRead })],
      capacityPerSecond: 50,
    });
    sim.addClient(client);
    sim.addComponent(gateway);
    sim.addComponent(lb);
    sim.addComponent(server1);
    sim.addComponent(server2);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
        bandwidth: 500, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    sim.addConnection(mk("cg", client.id, gateway.id, "forward", "gc"));
    sim.addConnection(mk("gc", gateway.id, client.id, "back", "cg"));
    sim.addConnection(mk("gl", gateway.id, lb.id, "forward", "lg"));
    sim.addConnection(mk("lg", lb.id, gateway.id, "back", "gl"));
    sim.addConnection(mk("l1", lb.id, server1.id, "forward", "1l"));
    sim.addConnection(mk("1l", server1.id, lb.id, "back", "l1"));
    sim.addConnection(mk("l2", lb.id, server2.id, "forward", "2l"));
    sim.addConnection(mk("2l", server2.id, lb.id, "back", "l2"));
    sim.addConnection(mk("1k", server1.id, cache.id, "forward", "k1"));
    sim.addConnection(mk("k1", cache.id, server1.id, "back", "1k"));
    sim.addConnection(mk("2k", server2.id, cache.id, "forward", "k2"));
    sim.addConnection(mk("k2", cache.id, server2.id, "back", "2k"));
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_5.duration, drainSeconds: 3 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.terminated).toBeGreaterThan(0); // auth terminates at gateway
    expect(metrics.responded).toBeGreaterThan(0);  // reads respond from cache or DB
  });
});
```

### Step 1: Create, run + commit

```bash
pnpm test tests/integration/sim/waves/wave-5-gateway-rescue.test.ts 2>&1 | tail -10
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): Wave 5 — Gateway + LB + 2 servers rescue"
```

---

## Task 10: Final regression + documentation

**Files:**
- None new. Just verify.

- [ ] **Step 1: Full sim test regression**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: 59 passing (57 + event-latency + test-harness = 59).

- [ ] **Step 2: Integration test regression**

Run: `pnpm test tests/integration/sim/ 2>&1 | tail -10`

Expected: 6 integration tests passing (Waves 1, 2, 3-lose, 3-rescue, 4, 5).

- [ ] **Step 3: Full repo typecheck**

Run: `pnpm typecheck 2>&1 | tail -10`

Expected: only the pre-existing `pull-from-buffers.test.ts:81` error.

- [ ] **Step 4: If all green, no commit — this is a verification-only task.**

If anything fails, debug and fix. The common failure modes:

1. **Wave SLAs don't pass/fail as expected.** Tune `intensity`, `packetRate`, capacity values, or cache `capacity` until the loss/win split emerges cleanly. Don't weaken the SLA thresholds to paper over genuine problems.
2. **Latency looks wrong.** Check that `spawnedAt` propagates through all capability child packets (Task 1 did this but any new capabilities or manual Packet literals in tests could break it).
3. **Integration tests fail typecheck because of new fields.** Most likely `revenue`, `latencySeconds`, `isAsync`. Grep for the failure and add the field.

---

## Completion

Plan 4 ships:
- Latency threading on terminate / respond-delivered events
- Per-type revenue on WaveDef
- Test harness (`runWave` + `evaluateSLA`)
- Six wave integration tests across the first five wave arcs:
  - Wave 1: lone Server wins (baseline)
  - Wave 2: Server + DB with dispatcher routing
  - Wave 3: lose + rescue pair (DB saturation → cache rescue)
  - Wave 4: CDN rescue for static asset traffic
  - Wave 5: Gateway + LB + 2-server rescue

Waves 6–10 remain deferred pending:
- CircuitBreaker (Wave 7)
- AutoScaleCapability (Wave 10)
- Wave 9 multi-zone traffic generation with per-zone TrafficSource behavior
- Chaos scheduling (Wave 10)

These will land in Plan 4b after the renderer (Plan 5/Stage E) is wired — tuning Waves 6–10 benefits from watching packets flow.

## Self-review notes

- Wave tests are deliberately *tight* — single seed, short duration, explicit capacity numbers. Tuning is pinned in the test file rather than in a shared config, so adjusting one wave doesn't cascade.
- `ServerDispatcherCapability` and `CDNDispatcherCapability` are defined inline in their respective tests because they're composition patterns specific to those waves. If more tests need them, they can be promoted to `src/sim/capabilities/` later.
- `runWave`'s `drainSeconds` defaults to 2, but Wave 3/4/5 use 3 explicitly because pipeline depth is longer.
- SLA thresholds ARE the teaching target. A rescue that *barely* passes (89.9% availability against 90% threshold) is a sign of imperfect tuning; try to land rescues comfortably (95%+).
- Latency threading through split/merge is the subtlest part. The merge event's `latencySeconds` is based on the original pre-split `spawnedAt`, not any child's `spawnedAt` — Task 1 stores this in the merge state. Double-check by adding a sanity test if anything looks off.

# Physics Sim — Stage C (Remaining Capabilities) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the remaining capabilities onto the Stage A/B sim: LoadBalancer (split + wait-all merge), Gateway (auth termination), GeoRouting (DNS/GTM), StreamingCapability (bandwidth reservation), Queue (holds batch), Worker (pulls from Queue). After Stage C, every architectural tower in the game has a corresponding `SimCapability`.

**Architecture:** Each capability is a class implementing the same `SimCapability` contract used in Stage A. Two new mechanics land in the sim core: (a) `split` Outcome with a merge-state map for wait-all response merge; (b) a per-step `pullFromQueues` phase for Queue→Worker semantics. Everything else is capability-local.

**Tech Stack:** Continues in `src/sim/` + `tests/unit/sim/`.

**Working directory for all tasks:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`

**Stage B precondition:** 45 sim tests pass. HEAD is the final commit from Plan 2.

---

## File structure

**Created:**

```
src/sim/
  capabilities/
    load-balancer.ts        # split-on-arrival + wait-all merge on response leg
    gateway.ts              # auth termination
    geo-routing.ts          # pick egress by originZone
    streaming.ts            # bandwidth reservation on ingress edge
    queue.ts                # holds isAsync packets
    worker.ts               # pulls from connected Queue each step

tests/unit/sim/
  load-balancer-split.test.ts
  load-balancer-merge.test.ts
  gateway-capability.test.ts
  geo-routing.test.ts
  streaming-capability.test.ts
  queue-worker.test.ts
```

**Modified:**

- `src/sim/types.ts` — extend `Request` with `isAsync: boolean`; extend `Outcome` with `split` variant; extend `ArrivalContext` with `zonePairLatency` lookup hook (optional for Stage C) — or skip and use `null` for originZone-free paths.
- `src/sim/sim.ts` — handle `split` outcome (store merge state, emit children) and `merge` when N-th response arrives at splitter.
- `src/sim/traffic-source.ts` — roll `isAsync` from composition (new field in `WaveComposition`).
- `src/sim/wave.ts` — add `asyncRatio` to `WaveComposition`.
- `src/sim/index.ts` — barrel-export new capabilities.

---

## Task 1: `Request.isAsync` + `WaveComposition.asyncRatio`

**Files:**
- Modify: `src/sim/types.ts`
- Modify: `src/sim/wave.ts`
- Modify: `src/sim/traffic-source.ts`
- Test: `tests/unit/sim/traffic-source-async-roll.test.ts`

Add `isAsync: boolean` to `Request` and roll it in the traffic source.

- [ ] **Step 1: Modify `src/sim/types.ts`**

In the `Request` type, add a field:

```ts
readonly isAsync: boolean;
```

Place it alongside `isLarge`.

- [ ] **Step 2: Modify `src/sim/wave.ts`**

Extend `WaveComposition`:

```ts
export type WaveComposition = {
  readonly writeRatio: number;
  readonly authRatio: number;
  readonly streamRatio: number;
  readonly largeRatio: number;
  readonly asyncRatio: number;
};
```

- [ ] **Step 3: Modify `src/sim/traffic-source.ts`**

In `generatePacketForTest`, roll `isAsync` after `isStream`:

```ts
const isAsync = this.rng() < this.wave.composition.asyncRatio;
```

Pass into each request literal:

```ts
isLarge,
isAsync,
...(isStream && this.wave.streamConfig ? { stream: this.wave.streamConfig } : {}),
```

- [ ] **Step 4: Fix existing tests**

Find all tests that construct `Request` literals or `WaveComposition` and add the new field. Set both to `false` / `0` unless the test specifically exercises the new behavior. Search with:

```
grep -rn "composition: {" tests/unit/sim/
grep -rn "isLarge:" tests/unit/sim/
```

For each hit, add `isAsync: false` to Request literals and `asyncRatio: 0` to WaveComposition literals.

- [ ] **Step 5: Write new test**

Create `tests/unit/sim/traffic-source-async-roll.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { resetIdCountersForTest } from "@sim/packet";
import type { ComponentId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 60,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0.25 },
  keyDistribution: { kind: "uniform", spaceSize: 10 },
  entryClients: ["c1" as ComponentId],
};

describe("TrafficSource — async roll", () => {
  beforeEach(() => resetIdCountersForTest());

  it("produces ~asyncRatio async packets", () => {
    const ts = new TrafficSource(wave, makeSimRng(5));
    let asyncCount = 0;
    const total = 5000;
    for (let i = 0; i < total; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      if (pkt.requests[0]!.isAsync) asyncCount += 1;
    }
    const ratio = asyncCount / total;
    expect(ratio).toBeGreaterThan(0.20);
    expect(ratio).toBeLessThan(0.30);
  });
});
```

- [ ] **Step 6: Run all sim tests — expect pass**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: 46 passing (45 prior + 1 new, after fixing the existing literal updates).

- [ ] **Step 7: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): Request.isAsync + WaveComposition.asyncRatio"
```

---

## Task 2: LoadBalancer — split on arrival

**Files:**
- Create: `src/sim/capabilities/load-balancer.ts`
- Modify: `src/sim/types.ts` (add `split` Outcome variant)
- Modify: `src/sim/sim.ts` (handle `split` in applyOutcome)
- Test: `tests/unit/sim/load-balancer-split.test.ts`

The LB always splits: on arrival of a packet with N requests, emit one child packet per egress, each carrying `Math.floor(N / egressCount)` requests, with the remainder round-robin'd across children.

- [ ] **Step 1: Extend `Outcome` with `split`**

In `src/sim/types.ts`, add a new arm:

```ts
  | { readonly kind: "split"; readonly emit: ReadonlyArray<{ edgeId: ConnectionId; packet: Packet }>; readonly mergeKey: PacketId; readonly expectedChildren: number; readonly ingressEdgeId: ConnectionId }
```

- [ ] **Step 2: Handle `split` in `applyOutcome`**

Modify `src/sim/sim.ts`. Add a private merge-state map:

```ts
private readonly mergeByParent: Map<PacketId, { expectedChildren: number; receivedChildren: number; accumulatedRevenue: number; ingressEdgeId: ConnectionId }> = new Map();
```

Add case in applyOutcome:

```ts
case "split":
  this.mergeByParent.set(outcome.mergeKey, {
    expectedChildren: outcome.expectedChildren,
    receivedChildren: 0,
    accumulatedRevenue: 0,
    ingressEdgeId: outcome.ingressEdgeId,
  });
  for (const emit of outcome.emit) this.activePackets.push(emit.packet);
  return;
```

(Merge firing happens in Task 3.)

- [ ] **Step 3: Implement `src/sim/capabilities/load-balancer.ts`**

```ts
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

/**
 * LoadBalancerCapability — always splits the batch across all healthy
 * forward egresses. Children get Math.floor(N/K) requests each; leftover
 * remainder is round-robin'd across children. The merge state is tracked
 * on the sim itself (Task 3 handles the wait-all merge on the response leg).
 */
export class LoadBalancerCapability implements SimCapability {
  readonly id = "load-balancer";

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const egresses = ctx.egressEdges;
    if (egresses.length === 0) {
      return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    }
    const total = packet.requests.length;
    if (egresses.length === 1) {
      const egress = egresses[0]!;
      const child: Packet = {
        id: ctx.mintPacketId(),
        requests: packet.requests,
        edgeId: egress.id,
        progress: 0,
        speed: egress.speed,
        spawnedAt: ctx.simTime,
        parentId: packet.id,
        direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
    }
    const base = Math.floor(total / egresses.length);
    const remainder = total % egresses.length;
    const children: { edgeId: import("@core/types/ids").ConnectionId; packet: Packet }[] = [];
    let offset = 0;
    for (let i = 0; i < egresses.length; i += 1) {
      const egress = egresses[i]!;
      const take = base + (i < remainder ? 1 : 0);
      if (take === 0) continue;
      const chunk = packet.requests.slice(offset, offset + take);
      offset += take;
      const child: Packet = {
        id: ctx.mintPacketId(),
        requests: chunk,
        edgeId: egress.id,
        progress: 0,
        speed: egress.speed,
        spawnedAt: ctx.simTime,
        parentId: packet.id,
        direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      children.push({ edgeId: egress.id, packet: child });
    }
    return {
      kind: "split",
      emit: children,
      mergeKey: packet.id,
      expectedChildren: children.length,
      ingressEdgeId: ctx.ingressEdgeId,
    };
  }
}
```

- [ ] **Step 4: Test (verbatim)**

Create `tests/unit/sim/load-balancer-split.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(): Request {
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

describe("LoadBalancerCapability — split", () => {
  beforeEach(() => resetIdCountersForTest());

  it("splits 8 requests across 2 egresses as 4/4", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const lb = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1 = new SimComponent({ id: "s1" as ComponentId, capabilities: [] });
    const s2 = new SimComponent({ id: "s2" as ComponentId, capabilities: [] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: lb.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    const ls1 = new SimConnection({
      id: "ls1" as ConnectionId,
      from: { componentId: lb.id, portId: "p" as PortId },
      to: { componentId: s1.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "s1l" as ConnectionId, direction: "forward",
    });
    const ls2 = new SimConnection({
      id: "ls2" as ConnectionId,
      from: { componentId: lb.id, portId: "p" as PortId },
      to: { componentId: s2.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "s2l" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(lb); sim.addComponent(s1); sim.addComponent(s2);
    sim.addConnection(ab); sim.addConnection(ls1); sim.addConnection(ls2);
    const requests = [mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq()];
    sim.spawnPacket(makePacket({ requests, edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(2);
    const onLs1 = sim.activePackets.find((p) => p.edgeId === ls1.id)!;
    const onLs2 = sim.activePackets.find((p) => p.edgeId === ls2.id)!;
    expect(onLs1.requests.length).toBe(4);
    expect(onLs2.requests.length).toBe(4);
  });

  it("distributes remainder — 7 requests across 3 egresses as 3/2/2", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const lb = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1 = new SimComponent({ id: "s1" as ComponentId, capabilities: [] });
    const s2 = new SimComponent({ id: "s2" as ComponentId, capabilities: [] });
    const s3 = new SimComponent({ id: "s3" as ComponentId, capabilities: [] });
    const mk = (id: string, from: ComponentId, to: ComponentId, twin: string): SimConnection =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 1 / 60, twinId: twin as ConnectionId, direction: "forward",
      });
    const ab = mk("ab", a.id, lb.id, "ba");
    const ls1 = mk("ls1", lb.id, s1.id, "s1l");
    const ls2 = mk("ls2", lb.id, s2.id, "s2l");
    const ls3 = mk("ls3", lb.id, s3.id, "s3l");
    sim.addComponent(a); sim.addComponent(lb); sim.addComponent(s1); sim.addComponent(s2); sim.addComponent(s3);
    for (const e of [ab, ls1, ls2, ls3]) sim.addConnection(e);
    const requests = [mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq(), mkReq()]; // 7
    sim.spawnPacket(makePacket({ requests, edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(3);
    const counts = sim.activePackets.map((p) => p.requests.length).sort((a, b) => b - a);
    expect(counts).toEqual([3, 2, 2]);
  });
});
```

- [ ] **Step 5: Run — expect 2 passing**

Run: `pnpm test tests/unit/sim/load-balancer-split.test.ts 2>&1 | tail -10`

- [ ] **Step 6: Sim regression check**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

- [ ] **Step 7: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): LoadBalancerCapability — split batch across egresses"
```

---

## Task 3: LB merge — wait-all on response leg

**Files:**
- Modify: `src/sim/sim.ts` (response-leg merge logic)
- Test: `tests/unit/sim/load-balancer-merge.test.ts`

When a response arrives at the LB (which issued a split), we look up `mergeByParent[parentId]`. Instead of retracing per-child via route-pop, the LB holds response children until all N have arrived, then emits a single merged response upstream on the twin of the LB's original ingress edge (stored in the merge state).

The cleanest implementation: detect that a response's `parentId` (of the response) has a match in `mergeByParent`. Accumulate revenue. When `receivedChildren === expectedChildren`, build a merged response packet and emit it on the twin of `ingressEdgeId`.

Subtle: the response packet's route currently pushes `ingressEdgeId` at each hop (via retracer). The children have different routes because they traversed different sub-paths. The LB merge should preserve the upstream route (everything before the split), so we should strip everything from the split point onwards and retrace normally from there. Easiest: the merged response starts at `ingressEdgeId.twin` and its route is the pre-split route (a known quantity — stored in the merge state).

For Task 3, we do NOT build a full cross-topology test yet — just a direct test that a response child arriving at the LB correctly accumulates merge state and fires a single upstream response on the twin when all N arrive.

- [ ] **Step 1: Extend merge state**

In `src/sim/sim.ts`, modify `mergeByParent` to also store the pre-split route:

```ts
private readonly mergeByParent: Map<PacketId, {
  expectedChildren: number;
  receivedChildren: number;
  accumulatedRevenue: number;
  ingressEdgeId: ConnectionId;
  preSplitRoute: ConnectionId[];
}> = new Map();
```

Update the `split` case in applyOutcome to store `preSplitRoute`:

```ts
case "split": {
  // The split is happening at the LB; the route on the parent packet
  // at this point is the route taken to reach the LB (not including
  // ingressEdgeId yet). We capture that pre-split route here so the merge
  // can retrace properly.
  const preSplitRoute: ConnectionId[] = []; // will be filled by dispatchArrival
  this.mergeByParent.set(outcome.mergeKey, {
    expectedChildren: outcome.expectedChildren,
    receivedChildren: 0,
    accumulatedRevenue: 0,
    ingressEdgeId: outcome.ingressEdgeId,
    preSplitRoute,
  });
  for (const emit of outcome.emit) this.activePackets.push(emit.packet);
  return;
}
```

Add a parameter `preSplitRoute` to the `Outcome.split` variant in `src/sim/types.ts`:

```ts
  | { readonly kind: "split"; readonly emit: ReadonlyArray<{ edgeId: ConnectionId; packet: Packet }>; readonly mergeKey: PacketId; readonly expectedChildren: number; readonly ingressEdgeId: ConnectionId; readonly preSplitRoute: ReadonlyArray<ConnectionId> }
```

Update `LoadBalancerCapability.onArriveRequest` to return `preSplitRoute: [...packet.route]`:

```ts
return {
  kind: "split",
  emit: children,
  mergeKey: packet.id,
  expectedChildren: children.length,
  ingressEdgeId: ctx.ingressEdgeId,
  preSplitRoute: [...packet.route],
};
```

Update the sim's `split` case to copy from outcome:

```ts
preSplitRoute: [...outcome.preSplitRoute],
```

- [ ] **Step 2: Implement merge in `dispatchArrival` back-leg**

In `src/sim/sim.ts`, modify the back-leg branch. BEFORE the existing `onArriveResponse` + route-pop logic, check whether this response's `parentId` chain points to a known merge. The complication: the response packet's `parentId` is the chunk that was split — e.g. LB saw parent `P`, emitted children `C1, C2`, each arrived at a server, each server's `respond` created responses `R1, R2` with `parentId = C1` / `C2`. When R1 arrives back at LB, we need to find merge state keyed by `P`, not `C1`.

Easiest: on the `split` emit, remember child→parent mapping in a second Map:

```ts
private readonly parentOfChild: Map<PacketId, PacketId> = new Map();
```

Set it when pushing children:

```ts
for (const emit of outcome.emit) {
  this.parentOfChild.set(emit.packet.id, outcome.mergeKey);
  this.activePackets.push(emit.packet);
}
```

In dispatchArrival back-leg, when a response packet arrives AT the splitter component (i.e., when its route.pop matches the LB's ingressEdgeId), check if `parentOfChild.get(packet.parentId!)` yields a merge entry. If so: accumulate revenue, increment received, and if complete, emit a merged response packet on twin(ingressEdgeId). Do NOT do the normal route-pop retrace for this packet; the merged response is a new packet born at the LB.

Concretely the back-leg branch becomes:

```ts
} else {
  for (const cap of component.capabilities) {
    cap.onArriveResponse?.(packet, ctx);
  }
  // Check if this response is a child of a split
  const parentPacketId = packet.parentId != null ? this.parentOfChild.get(packet.parentId) : undefined;
  if (parentPacketId !== undefined) {
    const merge = this.mergeByParent.get(parentPacketId);
    if (merge !== undefined) {
      merge.receivedChildren += 1;
      const childRevenue = this.revenueByPacketId.get(packet.id) ?? 0;
      merge.accumulatedRevenue += childRevenue;
      this.revenueByPacketId.delete(packet.id);
      if (merge.receivedChildren >= merge.expectedChildren) {
        // Emit merged response upstream on twin of LB's ingress
        const twinId = this.connections.get(merge.ingressEdgeId)?.twinId;
        const twin = twinId ? this.connections.get(twinId) : undefined;
        this.mergeByParent.delete(parentPacketId);
        if (!twin) {
          // Broken topology; fire event here at LB as fallback
          this.lastStepEvents.push({ kind: "respond-delivered", componentId: component.id, revenue: merge.accumulatedRevenue });
          return;
        }
        const merged: Packet = {
          id: this.mintPacketId(),
          requests: [], // merged has no per-request payload at this level; revenue is the signal
          edgeId: twin.id,
          progress: 0,
          speed: twin.speed,
          spawnedAt: this.simTime,
          parentId: parentPacketId,
          direction: "back",
          route: [...merge.preSplitRoute],
        };
        this.revenueByPacketId.set(merged.id, merge.accumulatedRevenue);
        this.activePackets.push(merged);
      }
      return; // child retires at LB — do not retrace
    }
  }
  // ... existing route-pop retrace logic for non-split responses
```

Add `this.parentOfChild.delete(packet.id)` after consuming the child in the merge path.

- [ ] **Step 3: Test (verbatim)**

Create `tests/unit/sim/load-balancer-merge.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
import { ProcessingCapability } from "@sim/capabilities/processing";
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

describe("LoadBalancer wait-all merge — 2 servers", () => {
  beforeEach(() => resetIdCountersForTest());

  it("merges 2 child responses into one response-delivered at origin", () => {
    const sim = new Sim({ seed: 1 });
    const client = new SimClient({ id: "client" as ComponentId, capabilities: [], packetRate: 1 });
    const lb = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1 = new SimComponent({
      id: "s1" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 3 })],
      capacityPerSecond: 100,
    });
    const s2 = new SimComponent({
      id: "s2" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 3 })],
      capacityPerSecond: 100,
    });
    const wire = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 1 / 60, twinId: twin as ConnectionId, direction: dir,
      });
    const cl = wire("cl", client.id, lb.id, "forward", "lc");
    const lc = wire("lc", lb.id, client.id, "back", "cl");
    const l1 = wire("l1", lb.id, s1.id, "forward", "1l");
    const lb_1 = wire("1l", s1.id, lb.id, "back", "l1");
    const l2 = wire("l2", lb.id, s2.id, "forward", "2l");
    const lb_2 = wire("2l", s2.id, lb.id, "back", "l2");
    sim.addClient(client);
    sim.addComponent(lb);
    sim.addComponent(s1);
    sim.addComponent(s2);
    for (const e of [cl, lc, l1, lb_1, l2, lb_2]) sim.addConnection(e);

    // Inject a packet with 4 reads onto cl.
    sim.spawnPacket(makePacket({
      requests: [mkRead(), mkRead(), mkRead(), mkRead()],
      edgeId: cl.id, speed: cl.speed, spawnedAt: 0, direction: "forward",
    }));

    // Run 10 steps to let everything propagate.
    for (let i = 0; i < 10; i += 1) sim.step(1 / 60);

    const delivered = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    // After all steps, expect exactly one respond-delivered at the client.
    // Total revenue should be 4 reads × 3 revenuePerRead = 12.
    let totalDelivered = 0;
    let totalRevenue = 0;
    // Re-run and accumulate across steps since we only saw the last step.
    // Actually the original 10 steps already happened. Restart:
    resetIdCountersForTest();
    const sim2 = new Sim({ seed: 1 });
    const client2 = new SimClient({ id: "client" as ComponentId, capabilities: [], packetRate: 1 });
    const lb2 = new SimComponent({ id: "lb" as ComponentId, capabilities: [new LoadBalancerCapability()] });
    const s1_2 = new SimComponent({ id: "s1" as ComponentId, capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 3 })], capacityPerSecond: 100 });
    const s2_2 = new SimComponent({ id: "s2" as ComponentId, capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 3 })], capacityPerSecond: 100 });
    sim2.addClient(client2); sim2.addComponent(lb2); sim2.addComponent(s1_2); sim2.addComponent(s2_2);
    for (const e of [cl, lc, l1, lb_1, l2, lb_2]) sim2.addConnection(e);
    sim2.spawnPacket(makePacket({
      requests: [mkRead(), mkRead(), mkRead(), mkRead()],
      edgeId: cl.id, speed: cl.speed, spawnedAt: 0, direction: "forward",
    }));
    for (let i = 0; i < 10; i += 1) {
      sim2.step(1 / 60);
      for (const ev of sim2.lastStepEvents) {
        if (ev.kind === "respond-delivered") { totalDelivered += 1; totalRevenue += ev.revenue; }
      }
    }
    expect(totalDelivered).toBe(1);
    expect(totalRevenue).toBe(12);
  });
});
```

- [ ] **Step 4: Run — expect 1 passing**

Run: `pnpm test tests/unit/sim/load-balancer-merge.test.ts 2>&1 | tail -15`

- [ ] **Step 5: Regression**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

- [ ] **Step 6: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): LoadBalancer wait-all merge on response leg"
```

---

## Task 4: GatewayCapability — auth termination

**Files:**
- Create: `src/sim/capabilities/gateway.ts`
- Test: `tests/unit/sim/gateway-capability.test.ts`

Gateway: for any request with `requiresAuth: true`, terminate with configurable revenue (mirrors auth-rejection for unauthenticated traffic). For other requests, forward to first egress.

- [ ] **Step 1: Implement**

```ts
// src/sim/capabilities/gateway.ts
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type GatewayCapabilityOptions = {
  readonly revenuePerAuth: number;
};

export class GatewayCapability implements SimCapability {
  readonly id = "gateway";
  constructor(private readonly opts: GatewayCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allAuth = packet.requests.every((r) => r.requiresAuth);
    const noneAuth = packet.requests.every((r) => !r.requiresAuth);
    if (allAuth) {
      return { kind: "terminate", revenue: this.opts.revenuePerAuth * packet.requests.length };
    }
    if (noneAuth) {
      const egress = ctx.egressEdges[0];
      if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
      const child: Packet = {
        id: ctx.mintPacketId(),
        requests: packet.requests,
        edgeId: egress.id,
        progress: 0,
        speed: egress.speed,
        spawnedAt: ctx.simTime,
        parentId: packet.id,
        direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
    }
    throw new Error("GatewayCapability: mixed auth/non-auth packet");
  }
}
```

- [ ] **Step 2: Test**

```ts
// tests/unit/sim/gateway-capability.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { GatewayCapability } from "@sim/capabilities/gateway";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(requiresAuth: boolean): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("GatewayCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot() {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const gw = new SimComponent({ id: "gw" as ComponentId, capabilities: [new GatewayCapability({ revenuePerAuth: 4 })] });
    const downstream = new SimComponent({ id: "ds" as ComponentId, capabilities: [] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: gw.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    const bd = new SimConnection({
      id: "bd" as ConnectionId,
      from: { componentId: gw.id, portId: "p" as PortId },
      to: { componentId: downstream.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "db" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(gw); sim.addComponent(downstream);
    sim.addConnection(ab); sim.addConnection(bd);
    return { sim, ab, bd };
  }

  it("terminates auth-required packet with revenue per request", () => {
    const { sim, ab } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq(true), mkReq(true), mkReq(true)], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((e) => e.kind === "terminate");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: "terminate", revenue: 12 });
  });

  it("forwards non-auth packet to first egress", () => {
    const { sim, ab, bd } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq(false)], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(bd.id);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
pnpm test tests/unit/sim/gateway-capability.test.ts 2>&1 | tail -10
# expect 2 passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): GatewayCapability — terminate requiresAuth, else forward"
```

---

## Task 5: GeoRoutingCapability — pick egress by originZone

**Files:**
- Create: `src/sim/capabilities/geo-routing.ts`
- Test: `tests/unit/sim/geo-routing.test.ts`

GeoRouting: picks the egress whose `to.componentId` matches a zone→componentId map. Needs a way to look up target component zones — for Stage C we make zones a property of `SimComponent` (optional).

- [ ] **Step 1: Extend `SimComponent` with an optional `zone`**

Modify `src/sim/component.ts`:

```ts
export type SimComponentOptions = {
  readonly id: ComponentId;
  readonly capabilities: readonly SimCapability[];
  readonly capacityPerSecond?: number;
  readonly zone?: Zone;
};

export class SimComponent {
  readonly id: ComponentId;
  readonly capabilities: readonly SimCapability[];
  readonly bucket: CapacityBucket | null;
  readonly state: Map<string, unknown> = new Map();
  readonly zone: Zone | null;

  constructor(opts: SimComponentOptions) {
    this.id = opts.id;
    this.capabilities = opts.capabilities;
    this.bucket = opts.capacityPerSecond !== undefined ? new CapacityBucket({ capacityPerSecond: opts.capacityPerSecond }) : null;
    this.zone = opts.zone ?? null;
  }

  refillBucket(dt: number): void {
    this.bucket?.refill(dt);
  }
}
```

Add `import type { Zone } from "./types";` at the top.

- [ ] **Step 2: Extend `ArrivalContext.egressEdges` with target zone**

In `src/sim/types.ts`:

```ts
export type ArrivalContext = {
  readonly componentId: ComponentId;
  readonly ingressEdgeId: ConnectionId;
  readonly egressEdges: ReadonlyArray<{ id: ConnectionId; speed: number; targetZone: Zone | null }>;
  // ... rest unchanged
};
```

In `src/sim/sim.ts`, update the egressEdges computation in `dispatchArrival`:

```ts
const egressEdges: { id: ConnectionId; speed: number; targetZone: Zone | null }[] = [];
for (const conn of this.connections.values()) {
  if (conn.from.componentId === component.id && conn.direction === "forward") {
    const target = this.components.get(conn.to.componentId);
    egressEdges.push({ id: conn.id, speed: conn.speed, targetZone: target?.zone ?? null });
  }
}
```

- [ ] **Step 3: Implement `src/sim/capabilities/geo-routing.ts`**

```ts
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

/**
 * GeoRoutingCapability — picks egress whose target component is in the
 * packet's originZone. If no match, drops `no_zone_match`. If all requests
 * in the packet share one originZone (typical), that's the route.
 */
export class GeoRoutingCapability implements SimCapability {
  readonly id = "geo-routing";

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const firstZone = packet.requests[0]?.originZone ?? null;
    if (firstZone === null) {
      return { kind: "drop", reason: "no_origin_zone", count: packet.requests.length };
    }
    const match = ctx.egressEdges.find((e) => e.targetZone === firstZone);
    if (!match) {
      return { kind: "drop", reason: "no_zone_match", count: packet.requests.length };
    }
    const child: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: match.id,
      progress: 0,
      speed: match.speed,
      spawnedAt: ctx.simTime,
      parentId: packet.id,
      direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: match.id, packet: child }] };
  }
}
```

- [ ] **Step 4: Test**

```ts
// tests/unit/sim/geo-routing.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { GeoRoutingCapability } from "@sim/capabilities/geo-routing";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(zone: string | null): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    originClientId: "client" as ComponentId,
    originZone: zone,
    spawnedAt: 0,
  };
}

describe("GeoRoutingCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot() {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const dns = new SimComponent({ id: "dns" as ComponentId, capabilities: [new GeoRoutingCapability()] });
    const na = new SimComponent({ id: "na" as ComponentId, capabilities: [], zone: "NA" });
    const eu = new SimComponent({ id: "eu" as ComponentId, capabilities: [], zone: "EU" });
    const mk = (id: string, from: ComponentId, to: ComponentId, twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100, latencySeconds: 1 / 60, twinId: twin as ConnectionId, direction: "forward",
      });
    sim.addComponent(a); sim.addComponent(dns); sim.addComponent(na); sim.addComponent(eu);
    const ad = mk("ad", a.id, dns.id, "da");
    const dn = mk("dn", dns.id, na.id, "nd");
    const de = mk("de", dns.id, eu.id, "ed");
    for (const e of [ad, dn, de]) sim.addConnection(e);
    return { sim, ad, dn, de };
  }

  it("routes NA request to NA server", () => {
    const { sim, ad, dn } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq("NA")], edgeId: ad.id, speed: ad.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(dn.id);
  });

  it("routes EU request to EU server", () => {
    const { sim, ad, de } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq("EU")], edgeId: ad.id, speed: ad.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(de.id);
  });

  it("drops when no egress matches the zone", () => {
    const { sim, ad } = boot();
    sim.spawnPacket(makePacket({ requests: [mkReq("AP")], edgeId: ad.id, speed: ad.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((e) => e.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "no_zone_match" });
  });
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm test tests/unit/sim/geo-routing.test.ts 2>&1 | tail -10
# expect 3 passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): GeoRoutingCapability + Component.zone + egressEdges.targetZone"
```

---

## Task 6: StreamingCapability — bandwidth reservation

**Files:**
- Create: `src/sim/capabilities/streaming.ts`
- Modify: `src/sim/sim.ts` (track bandwidth reservations per connection)
- Modify: `src/sim/connection.ts` (add `reservedBandwidth` mutable state)
- Test: `tests/unit/sim/streaming-capability.test.ts`

StreamingServer, on arrival of a stream packet, reserves bandwidth on the ingress edge for `stream.duration` seconds. If insufficient bandwidth available, drops. Otherwise terminates the packet with stream revenue.

- [ ] **Step 1: Extend `SimConnection` with reservation state**

Modify `src/sim/connection.ts`:

```ts
// Add field:
reservedBandwidth: number = 0;

// Add method to check availability:
canReserve(amount: number): boolean {
  return this.bandwidth - this.reservedBandwidth >= amount;
}

// Reservation tracking:
reserve(amount: number, durationSeconds: number, releaseAt: number): { releaseAt: number; amount: number } {
  this.reservedBandwidth += amount;
  return { releaseAt, amount };
}
```

- [ ] **Step 2: Track reservations on Sim and release after duration**

Add to `src/sim/sim.ts`:

```ts
private readonly activeReservations: { connectionId: ConnectionId; amount: number; releaseAt: number }[] = [];

// Called at start of step:
private releaseExpiredReservations(): void {
  const keep: typeof this.activeReservations = [];
  for (const r of this.activeReservations) {
    if (r.releaseAt > this.simTime) { keep.push(r); continue; }
    const conn = this.connections.get(r.connectionId);
    if (conn) conn.reservedBandwidth -= r.amount;
  }
  this.activeReservations.length = 0;
  this.activeReservations.push(...keep);
}
```

Call `this.releaseExpiredReservations()` as the first thing in `step(dt)` (even before `lastStepEvents` clear? — no, clear events first, then release).

- [ ] **Step 3: Implement `src/sim/capabilities/streaming.ts`**

```ts
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type StreamingCapabilityOptions = {
  readonly revenuePerStream: number;
};

/**
 * StreamingCapability — terminates stream requests with revenue and attempts
 * to reserve bandwidth on the ingress edge for stream.duration seconds.
 * If bandwidth insufficient, drops. Non-stream packets pass through to first egress.
 *
 * Reservation is reported via a side-channel: we push a reservation request onto
 * ctx.streamReservations. Sim applies the reservation in applyOutcome.
 */
export class StreamingCapability implements SimCapability {
  readonly id = "streaming";
  constructor(private readonly opts: StreamingCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allStream = packet.requests.every((r) => r.stream !== undefined);
    const noneStream = packet.requests.every((r) => r.stream === undefined);
    if (!allStream && !noneStream) throw new Error("StreamingCapability: mixed stream/non-stream");
    if (noneStream) {
      const egress = ctx.egressEdges[0];
      if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
      const child: Packet = {
        id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
        spawnedAt: ctx.simTime, parentId: packet.id, direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
    }
    // All stream. Attempt reservation via the shared connection.
    const totalBandwidth = packet.requests.reduce((acc, r) => acc + (r.stream?.bandwidth ?? 0), 0);
    const reservation = ctx.reserveBandwidth?.(ctx.ingressEdgeId, totalBandwidth, Math.max(...packet.requests.map((r) => r.stream?.duration ?? 0)));
    if (!reservation) return { kind: "drop", reason: "bandwidth_saturated", count: packet.requests.length };
    return { kind: "terminate", revenue: this.opts.revenuePerStream * packet.requests.length };
  }
}
```

- [ ] **Step 4: Add `reserveBandwidth` to `ArrivalContext`**

In `src/sim/types.ts`:

```ts
readonly reserveBandwidth?: (edgeId: ConnectionId, amount: number, durationSeconds: number) => boolean;
```

In `src/sim/sim.ts` `dispatchArrival`, build the ctx with:

```ts
reserveBandwidth: (edgeId, amount, durationSeconds) => {
  const conn = this.connections.get(edgeId);
  if (!conn) return false;
  if (!conn.canReserve(amount)) return false;
  conn.reservedBandwidth += amount;
  this.activeReservations.push({ connectionId: edgeId, amount, releaseAt: this.simTime + durationSeconds });
  return true;
},
```

- [ ] **Step 5: Test**

```ts
// tests/unit/sim/streaming-capability.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { StreamingCapability } from "@sim/capabilities/streaming";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkStreamReq(bandwidth: number, duration: number): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: false,
    stream: { bandwidth, duration },
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("StreamingCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function boot(bandwidth: number) {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const ss = new SimComponent({ id: "ss" as ComponentId, capabilities: [new StreamingCapability({ revenuePerStream: 10 })] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: ss.id, portId: "p" as PortId },
      bandwidth, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(ss);
    sim.addConnection(ab);
    return { sim, ab };
  }

  it("terminates stream packet when bandwidth fits", () => {
    const { sim, ab } = boot(100);
    sim.spawnPacket(makePacket({
      requests: [mkStreamReq(30, 2)],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((e) => e.kind === "terminate");
    expect(terms).toHaveLength(1);
  });

  it("drops when bandwidth insufficient", () => {
    const { sim, ab } = boot(10);
    sim.spawnPacket(makePacket({
      requests: [mkStreamReq(100, 2)],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((e) => e.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "bandwidth_saturated" });
  });
});
```

- [ ] **Step 6: Run + commit**

```bash
pnpm test tests/unit/sim/streaming-capability.test.ts 2>&1 | tail -15
# expect 2 passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): StreamingCapability + bandwidth reservation on connections"
```

---

## Task 7: Queue + Worker — pull semantics

**Files:**
- Create: `src/sim/capabilities/queue.ts`
- Create: `src/sim/capabilities/worker.ts`
- Modify: `src/sim/sim.ts` (add `pullFromQueues` phase in step)
- Test: `tests/unit/sim/queue-worker.test.ts`

Queue: on arrival of an `isAsync` packet, holds it in internal buffer instead of forwarding. Non-async packets pass through to first egress.

Worker: pulls from a connected Queue each step at `pullRate` per second. Pulled packets get processed as terminates with revenue.

- [ ] **Step 1: Implement `src/sim/capabilities/queue.ts`**

```ts
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type QueueCapabilityOptions = {
  readonly capacity: number;
};

export class QueueCapability implements SimCapability {
  readonly id = "queue";
  readonly held: Packet[] = [];
  constructor(private readonly opts: QueueCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allAsync = packet.requests.every((r) => r.isAsync);
    if (!allAsync) {
      const egress = ctx.egressEdges[0];
      if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
      const child: Packet = {
        id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
        spawnedAt: ctx.simTime, parentId: packet.id, direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
    }
    if (this.held.length >= this.opts.capacity) {
      return { kind: "drop", reason: "queue_full", count: packet.requests.length };
    }
    this.held.push(packet);
    // Consume packet silently — worker pulls later. Return a no-op drop with count 0.
    return { kind: "drop", reason: "held_in_queue", count: 0 };
  }
}
```

(Using `drop` with count 0 keeps the sim's existing `applyOutcome` path but doesn't fire a meaningful event. For the final polish we'd add a dedicated `hold` outcome kind, but this is Stage C's MVP.)

- [ ] **Step 2: Implement `src/sim/capabilities/worker.ts`**

```ts
import type { SimCapability, Packet } from "../types";
import type { QueueCapability } from "./queue";

export type WorkerCapabilityOptions = {
  readonly pullRate: number;        // items per second
  readonly revenuePerItem: number;
};

/**
 * WorkerCapability — pulls from connected Queue each step at pullRate.
 * This is a NO-OP for onArriveRequest — Workers only receive work via pull.
 * The pull logic lives in Sim's pullFromQueues phase (Task 7.3).
 */
export class WorkerCapability implements SimCapability {
  readonly id = "worker";
  readonly queue: QueueCapability;
  private credits = 0;
  constructor(public readonly opts: WorkerCapabilityOptions, queue: QueueCapability) {
    this.queue = queue;
  }
  onArriveRequest(): { kind: "drop"; reason: string; count: number } {
    return { kind: "drop", reason: "worker_not_arrived_path", count: 0 };
  }
  refillPull(dt: number): void {
    this.credits = Math.min(this.opts.pullRate, this.credits + this.opts.pullRate * dt);
  }
  tryPullOne(): Packet | null {
    if (this.credits < 1) return null;
    const p = this.queue.held.shift();
    if (!p) return null;
    this.credits -= 1;
    return p;
  }
}
```

- [ ] **Step 3: Add pullFromQueues phase**

In `src/sim/sim.ts`, scan all components for a WorkerCapability and pull each step:

```ts
import { WorkerCapability } from "./capabilities/worker";

// In step(), after populateSnakes / launchDueSnakes but before advancePackets:
private pullFromWorkers(dt: number): void {
  for (const comp of this.components.values()) {
    for (const cap of comp.capabilities) {
      if (cap instanceof WorkerCapability) {
        cap.refillPull(dt);
        while (true) {
          const pulled = cap.tryPullOne();
          if (!pulled) break;
          this.lastStepEvents.push({ kind: "terminate", componentId: comp.id, revenue: cap.opts.revenuePerItem * pulled.requests.length });
        }
      }
    }
  }
}
```

Call `this.pullFromWorkers(dt)` in `step(dt)` after `launchDueSnakes`.

- [ ] **Step 4: Test**

```ts
// tests/unit/sim/queue-worker.test.ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { QueueCapability } from "@sim/capabilities/queue";
import { WorkerCapability } from "@sim/capabilities/worker";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkAsyncReq(): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    isAsync: true,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("Queue + Worker", () => {
  beforeEach(() => resetIdCountersForTest());

  it("queue holds async packet; worker pulls and terminates over time", () => {
    const sim = new Sim({ seed: 1 });
    const queue = new QueueCapability({ capacity: 10 });
    const q = new SimComponent({ id: "q" as ComponentId, capabilities: [queue] });
    const worker = new WorkerCapability({ pullRate: 10, revenuePerItem: 2 }, queue);
    const w = new SimComponent({ id: "w" as ComponentId, capabilities: [worker] });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "p" as PortId },
      to: { componentId: q.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(q); sim.addComponent(w); sim.addConnection(ab);

    // Push 5 async packets, each 1 request.
    for (let i = 0; i < 5; i += 1) {
      sim.spawnPacket(makePacket({
        requests: [mkAsyncReq()],
        edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
      }));
    }
    // Step once so they all arrive at queue.
    sim.step(1 / 60);
    expect(queue.held.length).toBe(5);
    // Worker at 10/sec with dt=1/60 should pull ~0.167 per step; cumulative pull >= 5 after 30 steps.
    let terminates = 0;
    for (let i = 0; i < 60; i += 1) {
      sim.step(1 / 60);
      terminates += sim.lastStepEvents.filter((e) => e.kind === "terminate").length;
    }
    expect(terminates).toBeGreaterThanOrEqual(5);
    expect(queue.held.length).toBe(0);
  });
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm test tests/unit/sim/queue-worker.test.ts 2>&1 | tail -10
# expect 1 passing
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): Queue + Worker — pull semantics for async packets"
```

---

## Task 8: Barrel exports + typecheck cleanup

**Files:**
- Modify: `src/sim/index.ts`

- [ ] **Step 1: Update barrel**

Add:

```ts
export { LoadBalancerCapability } from "./capabilities/load-balancer";
export { GatewayCapability } from "./capabilities/gateway";
export { GeoRoutingCapability } from "./capabilities/geo-routing";
export { StreamingCapability } from "./capabilities/streaming";
export { QueueCapability } from "./capabilities/queue";
export { WorkerCapability } from "./capabilities/worker";
```

- [ ] **Step 2: Final typecheck**

Run: `pnpm typecheck 2>&1 | tail -15`

Fix any new errors beyond the pre-existing `pull-from-buffers.test.ts:81`.

- [ ] **Step 3: Full sim test regression**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: ~58 passing (45 Stage B + ~13 Stage C).

- [ ] **Step 4: Commit**

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "chore(sim): barrel-export Stage C capabilities"
```

---

## Completion

Stage C yields six new capabilities + supporting sim mechanics (split outcome, merge state, bandwidth reservation, worker pull phase). After this stage, the full architectural toolkit is available to rebuild every wave.

## Self-review notes

- The `split` Outcome variant carries `preSplitRoute` so merge can retrace via the LB's upstream twin without re-running the route-pop logic.
- `parentOfChild` tracks child→parent for merge lookup; cleaned up on merge completion.
- `Queue.onArriveRequest` returns a `drop` with `count: 0` as the "held silently" signal. Cleaner alternative: a dedicated `hold` outcome. Deferred to Stage G polish.
- `Worker.onArriveRequest` can never be called in practice (workers have no ingress edges from the arrival path) but returns a count-0 drop defensively.
- `StreamingCapability` uses the new `ctx.reserveBandwidth` side-channel to negotiate the reservation; the sim owns the reservation state.

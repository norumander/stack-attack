# Physics Sim — Stage A (Sim Core + 3 Capabilities) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fixed-timestep physics simulation core in `src/sim/` with three capabilities (Processing, Forwarding, Caching) — enough to run a `Server → DataCache → DB` topology headless with unit tests. No wave, no client, no renderer yet.

**Architecture:** Continuous-time simulation stepping at a deterministic 16.67ms (1/60s) interval. Packets live on edges, not components. A packet's `progress` advances each step; when `progress ≥ 1` the target component's `onArriveRequest` fires and returns an `Outcome` (forward / terminate / respond / drop). Connections come in twin pairs — responses retrace by popping the packet's ingress-edge `route[]` and emitting on twin edges. All randomness draws from a single wave-seeded LCG.

**Tech Stack:** TypeScript (strict), Vitest, pnpm. Branded ids from `src/core/types/ids.ts`. Path alias `@sim/*` maps to `src/sim/*`.

**Working directory for all tasks:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`

**Reference spec:** `docs/superpowers/specs/2026-04-16-physics-driven-request-flow-design.md`

---

## File Structure

**Created this stage:**

```
src/sim/
  types.ts                  # Packet, Request, Outcome, Connection, Component, SimCapability
  rng.ts                    # LCG factory (same algorithm as tests/harness/td-fixtures.ts)
  capacity-bucket.ts        # Per-type credits/sec + consume + refill
  component.ts              # SimComponent class (holds capabilities, buckets, per-component state)
  connection.ts             # SimConnection (endpoints, twinId, bandwidth, latency → speed)
  packet.ts                 # Packet factory helpers + id minting
  sim.ts                    # Sim class — step(dt), addComponent, addConnection, spawn helpers
  capabilities/
    processing.ts           # Processing (handles isWrite=terminate, else respond)
    forwarding.ts           # Forwarding (forwards on first matching egress)
    caching.ts              # Caching (LRU slots, hit/miss split, populate on response)
  index.ts                  # Public barrel exports

tests/unit/sim/
  rng.test.ts
  capacity-bucket.test.ts
  sim-step-empty.test.ts
  edge-advance.test.ts
  arrival-ordering.test.ts
  outcome-forward.test.ts
  outcome-drop.test.ts
  outcome-terminate.test.ts
  outcome-respond.test.ts
  twin-retrace.test.ts
  processing-capability.test.ts
  forwarding-capability.test.ts
  caching-capability.test.ts
  determinism-replay.test.ts
  sim-pixi-isolation.test.ts
```

**Modified this stage:**

- `tsconfig.json` — add `@sim/*` path alias
- `vitest.config.ts` — add `@sim/*` path alias (if it has its own resolve.alias)

**Not touched this stage:** `src/core/**`, `src/capabilities/**`, `src/modes/**`, `src/dashboard/**`. Stage A is purely additive.

---

## Task 1: Path alias `@sim/*`

**Files:**
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts` (only if it has its own `resolve.alias`; otherwise it inherits from tsconfig via a plugin)

- [ ] **Step 1: Read current path aliases**

Run: `cat tsconfig.json` and `cat vitest.config.ts`

Expected: `tsconfig.json` has `compilerOptions.paths` with entries like `"@core/*": ["src/core/*"]`. `vitest.config.ts` either uses `vite-tsconfig-paths` (inherits automatically) or declares its own `resolve.alias`.

- [ ] **Step 2: Add `@sim/*` alias to `tsconfig.json`**

Find the `"paths"` object in `compilerOptions` and add a new entry alongside existing aliases (e.g. right after `"@core/*"`):

```json
"@sim/*": ["src/sim/*"],
```

- [ ] **Step 3: Add `@sim/*` alias to `vitest.config.ts` if needed**

Only if `vitest.config.ts` declares `resolve.alias` manually. Add:

```ts
"@sim": path.resolve(__dirname, "src/sim"),
```

If `vitest.config.ts` uses `vite-tsconfig-paths`, no change needed.

- [ ] **Step 4: Verify alias resolves**

Create a throwaway file to test: `mkdir -p src/sim && echo 'export const PING = "sim" as const;' > src/sim/_probe.ts`

Then run: `pnpm typecheck 2>&1 | head -10`

Expected: no new errors. (The pre-existing `tests/unit/pull-from-buffers.test.ts:81` error from CLAUDE.md stays.)

- [ ] **Step 5: Remove probe and commit**

Run: `rm src/sim/_probe.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add tsconfig.json vitest.config.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "chore(sim): add @sim/* path alias for stage-A physics sim module"`

---

## Task 2: Core types (`src/sim/types.ts`)

**Files:**
- Create: `src/sim/types.ts`
- Test: `tests/unit/sim/types.test.ts` (type-only compile check; no runtime assertions)

- [ ] **Step 1: Write type-level sanity test**

Create `tests/unit/sim/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type {
  Packet,
  Request,
  Outcome,
  PacketId,
  ArrivalContext,
} from "@sim/types";

describe("sim types", () => {
  it("Packet and Outcome variants are well-formed", () => {
    const req: Request = {
      id: "r1" as unknown as Request["id"],
      key: "k1",
      isWrite: false,
      requiresAuth: false,
      isLarge: false,
      originClientId: "c1" as unknown as Request["originClientId"],
      originZone: null,
      spawnedAt: 0,
    };
    const packet: Packet = {
      id: "p1" as PacketId,
      requests: [req],
      edgeId: "e1" as unknown as Packet["edgeId"],
      progress: 0,
      speed: 1,
      spawnedAt: 0,
      parentId: null,
      direction: "forward",
      route: [],
    };
    const outcomes: Outcome[] = [
      { kind: "forward", emit: [{ edgeId: packet.edgeId, packet }] },
      { kind: "terminate", revenue: 5 },
      { kind: "respond", responsePacket: { ...packet, direction: "back" } },
      { kind: "drop", reason: "overloaded", count: 1 },
    ];
    expect(outcomes.length).toBe(4);
    expect(packet.direction).toBe("forward");
  });
});
```

- [ ] **Step 2: Run test — expect module-not-found failure**

Run: `pnpm test tests/unit/sim/types.test.ts 2>&1 | tail -20`

Expected: fails with `Cannot find module '@sim/types'` (or similar resolve error).

- [ ] **Step 3: Implement `src/sim/types.ts`**

Create `src/sim/types.ts`:

```ts
import type {
  ComponentId,
  ConnectionId,
  RequestId,
} from "@core/types/ids";

export type PacketId = string & { readonly __brand: "PacketId" };

export type Zone = string;

export type StreamConfig = {
  readonly duration: number;
  readonly bandwidth: number;
};

export type Request = {
  readonly id: RequestId;
  readonly key: string;
  readonly isWrite: boolean;
  readonly requiresAuth: boolean;
  readonly isLarge: boolean;
  readonly stream?: StreamConfig;
  readonly originClientId: ComponentId;
  readonly originZone: Zone | null;
  readonly spawnedAt: number;
};

export type PacketDirection = "forward" | "back";

export type Packet = {
  readonly id: PacketId;
  readonly requests: readonly Request[];
  readonly edgeId: ConnectionId;
  progress: number;
  readonly speed: number;
  readonly spawnedAt: number;
  readonly parentId: PacketId | null;
  readonly direction: PacketDirection;
  route: ConnectionId[];
};

export type Outcome =
  | { readonly kind: "forward"; readonly emit: ReadonlyArray<{ edgeId: ConnectionId; packet: Packet }> }
  | { readonly kind: "terminate"; readonly revenue: number }
  | { readonly kind: "respond"; readonly responsePacket: Packet }
  | { readonly kind: "drop"; readonly reason: string; readonly count: number };

export type ArrivalContext = {
  readonly componentId: ComponentId;
  readonly ingressEdgeId: ConnectionId;
  readonly simTime: number;
  readonly rng: () => number;
  readonly mintPacketId: () => PacketId;
  readonly mintRequestId: () => RequestId;
};

export type SimCapability = {
  readonly id: string;
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome;
  onArriveResponse?(packet: Packet, ctx: ArrivalContext): void;
};
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test tests/unit/sim/types.test.ts 2>&1 | tail -10`

Expected: 1 test passing.

- [ ] **Step 5: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/types.ts tests/unit/sim/types.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): core types — Packet, Request, Outcome, SimCapability"`

---

## Task 3: RNG (`src/sim/rng.ts`)

**Files:**
- Create: `src/sim/rng.ts`
- Test: `tests/unit/sim/rng.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/sim/rng.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeSimRng } from "@sim/rng";

describe("makeSimRng", () => {
  it("produces deterministic sequences for identical seeds", () => {
    const a = makeSimRng(42);
    const b = makeSimRng(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces divergent sequences for different seeds", () => {
    const a = makeSimRng(1);
    const b = makeSimRng(2);
    const valA = a();
    const valB = b();
    expect(valA).not.toBe(valB);
  });

  it("outputs values in [0, 1)", () => {
    const rng = makeSimRng(99);
    for (let i = 0; i < 100; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run test — expect module-not-found failure**

Run: `pnpm test tests/unit/sim/rng.test.ts 2>&1 | tail -10`

Expected: resolve error on `@sim/rng`.

- [ ] **Step 3: Implement `src/sim/rng.ts`**

Create `src/sim/rng.ts`:

```ts
/**
 * Deterministic LCG matching the existing tests/harness/td-fixtures.ts
 * algorithm. Any two calls with the same seed produce identical sequences.
 * All sim randomness (attribute rolls, key rolls, random-pick, LRU ties)
 * must draw from this single source per sim instance.
 */
export function makeSimRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
```

- [ ] **Step 4: Run test — expect 3 passing**

Run: `pnpm test tests/unit/sim/rng.test.ts 2>&1 | tail -10`

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/rng.ts tests/unit/sim/rng.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): LCG rng — deterministic per-seed sequences"`

---

## Task 4: Capacity bucket (`src/sim/capacity-bucket.ts`)

**Files:**
- Create: `src/sim/capacity-bucket.ts`
- Test: `tests/unit/sim/capacity-bucket.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/sim/capacity-bucket.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CapacityBucket } from "@sim/capacity-bucket";

describe("CapacityBucket", () => {
  it("starts full", () => {
    const b = new CapacityBucket({ capacityPerSecond: 10 });
    expect(b.available()).toBe(10);
  });

  it("consume succeeds when credits sufficient", () => {
    const b = new CapacityBucket({ capacityPerSecond: 10 });
    expect(b.tryConsume(3)).toBe(true);
    expect(b.available()).toBe(7);
  });

  it("consume fails when credits insufficient", () => {
    const b = new CapacityBucket({ capacityPerSecond: 5 });
    expect(b.tryConsume(7)).toBe(false);
    expect(b.available()).toBe(5);
  });

  it("refills by capacityPerSecond × dt per step, capped at capacity", () => {
    const b = new CapacityBucket({ capacityPerSecond: 60 });
    b.tryConsume(60);
    expect(b.available()).toBe(0);
    b.refill(1 / 60);
    expect(b.available()).toBeCloseTo(1, 6);
    b.refill(10);
    expect(b.available()).toBe(60);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test tests/unit/sim/capacity-bucket.test.ts 2>&1 | tail -10`

Expected: resolve error.

- [ ] **Step 3: Implement `src/sim/capacity-bucket.ts`**

Create `src/sim/capacity-bucket.ts`:

```ts
export type CapacityBucketOptions = {
  readonly capacityPerSecond: number;
};

/**
 * Per-component credit bucket. Starts full. Refills at capacityPerSecond × dt
 * per sim step, capped at capacityPerSecond (one full refill per second).
 * Consume atomically succeeds or fails — no fractional acceptance.
 */
export class CapacityBucket {
  private credits: number;
  private readonly max: number;

  constructor(opts: CapacityBucketOptions) {
    this.max = opts.capacityPerSecond;
    this.credits = opts.capacityPerSecond;
  }

  available(): number {
    return this.credits;
  }

  tryConsume(amount: number): boolean {
    if (amount > this.credits) return false;
    this.credits -= amount;
    return true;
  }

  refill(dt: number): void {
    this.credits = Math.min(this.max, this.credits + this.max * dt);
  }
}
```

- [ ] **Step 4: Run test — expect 4 passing**

Run: `pnpm test tests/unit/sim/capacity-bucket.test.ts 2>&1 | tail -10`

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/capacity-bucket.ts tests/unit/sim/capacity-bucket.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): CapacityBucket — credits/sec with dt refill"`

---

## Task 5: Component + Connection + Sim shell

**Files:**
- Create: `src/sim/component.ts`
- Create: `src/sim/connection.ts`
- Create: `src/sim/packet.ts`
- Create: `src/sim/sim.ts`
- Create: `src/sim/index.ts`
- Test: `tests/unit/sim/sim-step-empty.test.ts`

- [ ] **Step 1: Write failing test for empty-step behavior**

Create `tests/unit/sim/sim-step-empty.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Sim } from "@sim/sim";

describe("Sim — empty state", () => {
  it("steps without error and advances sim time", () => {
    const sim = new Sim({ seed: 1 });
    expect(sim.simTime).toBe(0);
    sim.step(1 / 60);
    expect(sim.simTime).toBeCloseTo(1 / 60, 9);
    sim.step(1 / 60);
    expect(sim.simTime).toBeCloseTo(2 / 60, 9);
  });

  it("tracks empty collections at start", () => {
    const sim = new Sim({ seed: 1 });
    expect(sim.components.size).toBe(0);
    expect(sim.connections.size).toBe(0);
    expect(sim.activePackets.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test tests/unit/sim/sim-step-empty.test.ts 2>&1 | tail -10`

Expected: resolve error on `@sim/sim`.

- [ ] **Step 3: Implement `src/sim/component.ts`**

```ts
import type { ComponentId } from "@core/types/ids";
import type { SimCapability } from "./types";
import { CapacityBucket } from "./capacity-bucket";

export type SimComponentOptions = {
  readonly id: ComponentId;
  readonly capabilities: readonly SimCapability[];
  readonly capacityPerSecond?: number;
};

export class SimComponent {
  readonly id: ComponentId;
  readonly capabilities: readonly SimCapability[];
  readonly bucket: CapacityBucket | null;
  readonly state: Map<string, unknown> = new Map();

  constructor(opts: SimComponentOptions) {
    this.id = opts.id;
    this.capabilities = opts.capabilities;
    this.bucket =
      opts.capacityPerSecond !== undefined
        ? new CapacityBucket({ capacityPerSecond: opts.capacityPerSecond })
        : null;
  }

  refillBucket(dt: number): void {
    this.bucket?.refill(dt);
  }
}
```

- [ ] **Step 4: Implement `src/sim/connection.ts`**

```ts
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

export type ConnectionDirection = "forward" | "back";

export type SimConnectionOptions = {
  readonly id: ConnectionId;
  readonly from: { componentId: ComponentId; portId: PortId };
  readonly to: { componentId: ComponentId; portId: PortId };
  readonly bandwidth: number;
  readonly latencySeconds: number;
  readonly twinId: ConnectionId;
  readonly direction: ConnectionDirection;
};

export class SimConnection {
  readonly id: ConnectionId;
  readonly from: { componentId: ComponentId; portId: PortId };
  readonly to: { componentId: ComponentId; portId: PortId };
  readonly bandwidth: number;
  readonly latencySeconds: number;
  readonly twinId: ConnectionId;
  readonly direction: ConnectionDirection;

  constructor(opts: SimConnectionOptions) {
    this.id = opts.id;
    this.from = opts.from;
    this.to = opts.to;
    this.bandwidth = opts.bandwidth;
    this.latencySeconds = opts.latencySeconds;
    this.twinId = opts.twinId;
    this.direction = opts.direction;
  }

  /** Edge-units per second. `latencySeconds` = seconds to traverse once. */
  get speed(): number {
    return 1 / this.latencySeconds;
  }
}
```

- [ ] **Step 5: Implement `src/sim/packet.ts`**

```ts
import type { ConnectionId, RequestId } from "@core/types/ids";
import type { Packet, PacketDirection, PacketId, Request } from "./types";

let nextPacketIdCounter = 0;
let nextRequestIdCounter = 0;

/** Monotonic packet id. Reset only in tests that need cross-test isolation. */
export function mintPacketId(): PacketId {
  nextPacketIdCounter += 1;
  return `p${nextPacketIdCounter}` as PacketId;
}

export function mintRequestId(): RequestId {
  nextRequestIdCounter += 1;
  return `r${nextRequestIdCounter}` as RequestId;
}

export function resetIdCountersForTest(): void {
  nextPacketIdCounter = 0;
  nextRequestIdCounter = 0;
}

export type NewPacketInput = {
  readonly requests: readonly Request[];
  readonly edgeId: ConnectionId;
  readonly speed: number;
  readonly spawnedAt: number;
  readonly direction: PacketDirection;
  readonly parentId?: PacketId | null;
  readonly route?: ConnectionId[];
};

export function makePacket(input: NewPacketInput): Packet {
  return {
    id: mintPacketId(),
    requests: input.requests,
    edgeId: input.edgeId,
    progress: 0,
    speed: input.speed,
    spawnedAt: input.spawnedAt,
    parentId: input.parentId ?? null,
    direction: input.direction,
    route: input.route ? [...input.route] : [],
  };
}
```

- [ ] **Step 6: Implement `src/sim/sim.ts`**

```ts
import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { Packet } from "./types";
import type { SimComponent } from "./component";
import type { SimConnection } from "./connection";
import { makeSimRng } from "./rng";
import { mintPacketId, mintRequestId } from "./packet";

export type SimOptions = {
  readonly seed: number;
};

export class Sim {
  readonly components: Map<ComponentId, SimComponent> = new Map();
  readonly connections: Map<ConnectionId, SimConnection> = new Map();
  readonly activePackets: Packet[] = [];
  simTime = 0;
  readonly rng: () => number;

  constructor(opts: SimOptions) {
    this.rng = makeSimRng(opts.seed);
  }

  addComponent(c: SimComponent): void {
    this.components.set(c.id, c);
  }

  addConnection(c: SimConnection): void {
    this.connections.set(c.id, c);
  }

  spawnPacket(p: Packet): void {
    this.activePackets.push(p);
  }

  step(dt: number): void {
    // Stage A wiring: refill buckets, advance packets, fire arrivals.
    // Filled in across Tasks 6–10. Stub for empty test.
    for (const c of this.components.values()) c.refillBucket(dt);
    this.simTime += dt;
  }

  mintPacketId = mintPacketId;
  mintRequestId = mintRequestId;
}
```

- [ ] **Step 7: Implement `src/sim/index.ts`**

```ts
export * from "./types";
export * from "./rng";
export { CapacityBucket } from "./capacity-bucket";
export { SimComponent } from "./component";
export { SimConnection } from "./connection";
export { Sim } from "./sim";
export { makePacket, mintPacketId, mintRequestId, resetIdCountersForTest } from "./packet";
```

- [ ] **Step 8: Run test — expect 2 passing**

Run: `pnpm test tests/unit/sim/sim-step-empty.test.ts 2>&1 | tail -10`

Expected: 2 tests passing.

- [ ] **Step 9: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/ tests/unit/sim/sim-step-empty.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): Sim/Component/Connection/Packet scaffolding + empty-step"`

---

## Task 6: Edge physics — packet progress advance

**Files:**
- Create: `src/sim/edge-physics.ts`
- Modify: `src/sim/sim.ts` (wire advance into step)
- Test: `tests/unit/sim/edge-advance.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/sim/edge-advance.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

describe("edge physics — advance", () => {
  beforeEach(() => resetIdCountersForTest());

  it("packet progress advances by speed × dt per step", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [] });
    sim.addComponent(a);
    sim.addComponent(b);
    const edge = new SimConnection({
      id: "e1" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 0.5,
      twinId: "e2" as ConnectionId,
      direction: "forward",
    });
    sim.addConnection(edge);
    const p = makePacket({
      requests: [],
      edgeId: edge.id,
      speed: edge.speed,
      spawnedAt: 0,
      direction: "forward",
    });
    sim.spawnPacket(p);
    sim.step(1 / 60);
    // speed = 2 (1/0.5), dt = 1/60 → progress ~= 0.0333
    expect(p.progress).toBeCloseTo(2 / 60, 6);
  });
});
```

- [ ] **Step 2: Run — expect fail** (`progress` doesn't advance)

Run: `pnpm test tests/unit/sim/edge-advance.test.ts 2>&1 | tail -10`

Expected: `expected 0 to be close to 0.0333...`.

- [ ] **Step 3: Implement `src/sim/edge-physics.ts`**

```ts
import type { Packet } from "./types";

/**
 * Advance all in-flight packets by speed × dt. Packets with progress ≥ 1
 * are eligible for arrival processing in the next phase.
 */
export function advancePackets(packets: readonly Packet[], dt: number): void {
  for (const p of packets) {
    p.progress += p.speed * dt;
  }
}
```

- [ ] **Step 4: Wire into `Sim.step`**

Modify `src/sim/sim.ts` — replace the `step(dt)` body with:

```ts
step(dt: number): void {
  for (const c of this.components.values()) c.refillBucket(dt);
  advancePackets(this.activePackets, dt);
  this.simTime += dt;
}
```

And add: `import { advancePackets } from "./edge-physics";` near other imports.

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm test tests/unit/sim/edge-advance.test.ts 2>&1 | tail -10`

Expected: 1 test passing.

- [ ] **Step 6: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/edge-physics.ts src/sim/sim.ts tests/unit/sim/edge-advance.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): advance packet progress each step"`

---

## Task 7: Arrival firing — deterministic ordering + onArriveRequest dispatch

**Files:**
- Modify: `src/sim/edge-physics.ts` (add `collectArrivals`, `fireArrivals`)
- Modify: `src/sim/sim.ts` (wire arrival phase)
- Test: `tests/unit/sim/arrival-ordering.test.ts`

Arrivals fire when `progress ≥ 1`. Multiple packets on the same edge in the same step must dispatch in monotonic `id` order. The component's first matching capability (first in `capabilities[]`) handles the arrival and returns an Outcome. Outcome handling for `forward`/`drop`/`terminate`/`respond` is layered in subsequent tasks — this task only asserts the dispatch order.

- [ ] **Step 1: Write failing test**

Create `tests/unit/sim/arrival-ordering.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, ArrivalContext, Packet, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function recorder(): { calls: string[]; cap: SimCapability } {
  const calls: string[] = [];
  const cap: SimCapability = {
    id: "recorder",
    onArriveRequest(p: Packet, _ctx: ArrivalContext): Outcome {
      calls.push(p.id);
      return { kind: "drop", reason: "test-drop", count: 0 };
    },
  };
  return { calls, cap };
}

describe("arrival firing", () => {
  beforeEach(() => resetIdCountersForTest());

  it("dispatches arrivals in monotonic packet-id order", () => {
    const sim = new Sim({ seed: 1 });
    const { calls, cap } = recorder();
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [cap] });
    sim.addComponent(a);
    sim.addComponent(b);
    const edge = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60, // arrives in one step
      twinId: "e-twin" as ConnectionId,
      direction: "forward",
    });
    sim.addConnection(edge);
    const p1 = makePacket({ requests: [], edgeId: edge.id, speed: edge.speed, spawnedAt: 0, direction: "forward" });
    const p2 = makePacket({ requests: [], edgeId: edge.id, speed: edge.speed, spawnedAt: 0, direction: "forward" });
    const p3 = makePacket({ requests: [], edgeId: edge.id, speed: edge.speed, spawnedAt: 0, direction: "forward" });
    // Insert out of order to prove we sort.
    sim.spawnPacket(p3);
    sim.spawnPacket(p1);
    sim.spawnPacket(p2);
    sim.step(1 / 60);
    expect(calls).toEqual([p1.id, p2.id, p3.id]);
  });

  it("packets that arrive retire from activePackets", () => {
    const sim = new Sim({ seed: 1 });
    const { cap } = recorder();
    sim.addComponent(new SimComponent({ id: "a" as ComponentId, capabilities: [] }));
    sim.addComponent(new SimComponent({ id: "b" as ComponentId, capabilities: [cap] }));
    const edge = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: "a" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "et" as ConnectionId,
      direction: "forward",
    });
    sim.addConnection(edge);
    const p = makePacket({ requests: [], edgeId: edge.id, speed: edge.speed, spawnedAt: 0, direction: "forward" });
    sim.spawnPacket(p);
    expect(sim.activePackets.length).toBe(1);
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test tests/unit/sim/arrival-ordering.test.ts 2>&1 | tail -15`

Expected: failures — either arrivals don't fire at all or list includes wrong order / packets never retire.

- [ ] **Step 3: Extend `src/sim/edge-physics.ts`**

Append to the file:

```ts
import type { ConnectionId } from "@core/types/ids";
import type { Packet, ArrivalContext, Outcome } from "./types";
import type { SimComponent } from "./component";
import type { SimConnection } from "./connection";

export type ArrivalHandler = (packet: Packet, ctx: ArrivalContext, component: SimComponent, edge: SimConnection) => Outcome;

/**
 * Partition activePackets into (arriving, stillInFlight) deterministically.
 * Arriving packets are those with progress ≥ 1, sorted by packet.id
 * to make capacity competition deterministic.
 */
export function collectArrivals(packets: readonly Packet[]): { arriving: Packet[]; remaining: Packet[] } {
  const arriving: Packet[] = [];
  const remaining: Packet[] = [];
  for (const p of packets) {
    if (p.progress >= 1) arriving.push(p);
    else remaining.push(p);
  }
  arriving.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { arriving, remaining };
}
```

Note: `p.id` is a string like `"p1"`, `"p2"`, `"p10"` — lexical sort would put `p10` before `p2`. Fix by minting numeric-padded ids in `mintPacketId`.

Modify `src/sim/packet.ts` — update `mintPacketId`:

```ts
export function mintPacketId(): PacketId {
  nextPacketIdCounter += 1;
  return `p${String(nextPacketIdCounter).padStart(10, "0")}` as PacketId;
}
```

And similarly for `mintRequestId` for consistency:

```ts
export function mintRequestId(): RequestId {
  nextRequestIdCounter += 1;
  return `r${String(nextRequestIdCounter).padStart(10, "0")}` as RequestId;
}
```

- [ ] **Step 4: Wire arrival phase into `Sim.step`**

Modify `src/sim/sim.ts` — replace step body:

```ts
import { advancePackets, collectArrivals } from "./edge-physics";
import type { ArrivalContext, Outcome } from "./types";

// ...inside Sim:

step(dt: number): void {
  for (const c of this.components.values()) c.refillBucket(dt);
  advancePackets(this.activePackets, dt);
  const { arriving, remaining } = collectArrivals(this.activePackets);
  this.activePackets.length = 0;
  this.activePackets.push(...remaining);
  for (const packet of arriving) {
    this.dispatchArrival(packet);
  }
  this.simTime += dt;
}

private dispatchArrival(packet: Packet): void {
  const edge = this.connections.get(packet.edgeId);
  if (!edge) return;
  const component = this.components.get(edge.to.componentId);
  if (!component) return;
  const ctx: ArrivalContext = {
    componentId: component.id,
    ingressEdgeId: edge.id,
    simTime: this.simTime,
    rng: this.rng,
    mintPacketId: () => this.mintPacketId(),
    mintRequestId: () => this.mintRequestId(),
  };
  if (packet.direction === "forward") {
    const cap = component.capabilities[0];
    if (!cap) return;
    const outcome = cap.onArriveRequest(packet, ctx);
    this.applyOutcome(outcome); // implemented in later tasks
  } else {
    // Response-leg dispatch lives in Task 10.
    for (const cap of component.capabilities) {
      cap.onArriveResponse?.(packet, ctx);
    }
  }
}

private applyOutcome(_outcome: Outcome): void {
  // Tasks 8–10 fill in forward / drop / terminate / respond.
}
```

(Import `Packet` as a type where needed.)

- [ ] **Step 5: Run test — expect 2 passing**

Run: `pnpm test tests/unit/sim/arrival-ordering.test.ts 2>&1 | tail -10`

Expected: 2 tests passing. If the id-sort test fails with a lexical-sort issue, double-check that `mintPacketId` produces zero-padded ids.

- [ ] **Step 6: Re-run full test to confirm no regressions**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: all previous sim tests still passing (capacity-bucket, rng, types, sim-step-empty, edge-advance, arrival-ordering). 10+ tests total.

- [ ] **Step 7: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/edge-physics.ts src/sim/sim.ts src/sim/packet.ts tests/unit/sim/arrival-ordering.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): arrival firing — deterministic id-ordered dispatch"`

---

## Task 8: Outcome handling — forward

**Files:**
- Modify: `src/sim/sim.ts` (fill in `applyOutcome` for `forward`)
- Test: `tests/unit/sim/outcome-forward.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/sim/outcome-forward.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, mintPacketId, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, ArrivalContext, Packet, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function forwardingCap(toEdgeId: ConnectionId, speed: number): SimCapability {
  return {
    id: "forwarder",
    onArriveRequest(p: Packet, ctx: ArrivalContext): Outcome {
      const child: Packet = {
        ...p,
        id: ctx.mintPacketId(),
        edgeId: toEdgeId,
        progress: 0,
        speed,
        route: [...p.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: toEdgeId, packet: child }] };
    },
  };
}

describe("outcome: forward", () => {
  beforeEach(() => resetIdCountersForTest());

  it("spawns emitted packet onto egress edge and tracks route", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const edge1 = new SimConnection({
      id: "e1" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "e1t" as ConnectionId,
      direction: "forward",
    });
    const edge2 = new SimConnection({
      id: "e2" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "c" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "e2t" as ConnectionId,
      direction: "forward",
    });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [forwardingCap(edge2.id, edge2.speed)] });
    const c = new SimComponent({ id: "c" as ComponentId, capabilities: [] });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addComponent(c);
    sim.addConnection(edge1);
    sim.addConnection(edge2);
    const p = makePacket({ requests: [], edgeId: edge1.id, speed: edge1.speed, spawnedAt: 0, direction: "forward" });
    sim.spawnPacket(p);

    sim.step(1 / 60); // p arrives at b, is forwarded onto edge2
    expect(sim.activePackets.length).toBe(1);
    const emitted = sim.activePackets[0];
    expect(emitted.edgeId).toBe(edge2.id);
    expect(emitted.progress).toBe(0);
    expect(emitted.route).toEqual([edge1.id]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test tests/unit/sim/outcome-forward.test.ts 2>&1 | tail -15`

Expected: `activePackets.length` === 0 (the forward outcome isn't applied yet).

- [ ] **Step 3: Implement forward in `applyOutcome`**

Modify `src/sim/sim.ts`:

```ts
private applyOutcome(outcome: Outcome): void {
  switch (outcome.kind) {
    case "forward":
      for (const emit of outcome.emit) {
        this.activePackets.push(emit.packet);
      }
      return;
    case "drop":
    case "terminate":
    case "respond":
      return; // filled in Tasks 9, 10
  }
}
```

- [ ] **Step 4: Run — expect 1 passing**

Run: `pnpm test tests/unit/sim/outcome-forward.test.ts 2>&1 | tail -10`

Expected: 1 passing.

- [ ] **Step 5: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/sim.ts tests/unit/sim/outcome-forward.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): outcome forward — emitted packets join activePackets"`

---

## Task 9: Outcome handling — drop + terminate + event stream

**Files:**
- Modify: `src/sim/sim.ts` (event log, drop/terminate handlers)
- Test: `tests/unit/sim/outcome-drop.test.ts`
- Test: `tests/unit/sim/outcome-terminate.test.ts`

Drops and terminations produce observable events. The renderer will read these later to trigger flashes. For Stage A we expose a simple event array `sim.lastStepEvents[]` that's cleared at the start of each step.

- [ ] **Step 1: Write failing test — drop event**

Create `tests/unit/sim/outcome-drop.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

const droppingCap: SimCapability = {
  id: "dropper",
  onArriveRequest(): Outcome {
    return { kind: "drop", reason: "overloaded", count: 5 };
  },
};

describe("outcome: drop", () => {
  beforeEach(() => resetIdCountersForTest());

  it("emits a drop event at the receiving component", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [droppingCap] });
    const e = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "et" as ConnectionId,
      direction: "forward",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(e);
    const p = makePacket({ requests: [], edgeId: e.id, speed: e.speed, spawnedAt: 0, direction: "forward" });
    sim.spawnPacket(p);
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((ev) => ev.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ kind: "drop", componentId: b.id, reason: "overloaded", count: 5 });
    expect(sim.activePackets.length).toBe(0);
  });

  it("clears events at the start of each step", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [droppingCap] });
    const e = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "et" as ConnectionId,
      direction: "forward",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(e);
    sim.spawnPacket(makePacket({ requests: [], edgeId: e.id, speed: e.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.lastStepEvents.length).toBe(1);
    sim.step(1 / 60);
    expect(sim.lastStepEvents.length).toBe(0);
  });
});
```

- [ ] **Step 2: Write failing test — terminate event**

Create `tests/unit/sim/outcome-terminate.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

const terminator: SimCapability = {
  id: "terminator",
  onArriveRequest(): Outcome {
    return { kind: "terminate", revenue: 42 };
  },
};

describe("outcome: terminate", () => {
  beforeEach(() => resetIdCountersForTest());

  it("emits a terminate event with revenue at the receiving component", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [terminator] });
    const e = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "et" as ConnectionId,
      direction: "forward",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(e);
    sim.spawnPacket(makePacket({ requests: [], edgeId: e.id, speed: e.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((ev) => ev.kind === "terminate");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: "terminate", componentId: b.id, revenue: 42 });
  });
});
```

- [ ] **Step 3: Run tests — expect fails**

Run: `pnpm test tests/unit/sim/outcome-drop.test.ts tests/unit/sim/outcome-terminate.test.ts 2>&1 | tail -15`

Expected: `sim.lastStepEvents` doesn't exist — compile/resolve error — or assertions fail.

- [ ] **Step 4: Add event types to `src/sim/types.ts`**

Append to `src/sim/types.ts`:

```ts
export type SimEvent =
  | { readonly kind: "drop"; readonly componentId: ComponentId; readonly reason: string; readonly count: number }
  | { readonly kind: "terminate"; readonly componentId: ComponentId; readonly revenue: number }
  | { readonly kind: "respond-delivered"; readonly componentId: ComponentId; readonly revenue: number };
```

(Import `ComponentId` at the top of `types.ts` — already done.)

- [ ] **Step 5: Wire events into `Sim`**

Modify `src/sim/sim.ts`:

```ts
import type { Packet, ArrivalContext, Outcome, SimEvent } from "./types";

// ...inside Sim class, add field:
readonly lastStepEvents: SimEvent[] = [];

// ...inside step(), as the first statement:
step(dt: number): void {
  this.lastStepEvents.length = 0;
  for (const c of this.components.values()) c.refillBucket(dt);
  advancePackets(this.activePackets, dt);
  const { arriving, remaining } = collectArrivals(this.activePackets);
  this.activePackets.length = 0;
  this.activePackets.push(...remaining);
  for (const packet of arriving) {
    this.dispatchArrival(packet);
  }
  this.simTime += dt;
}
```

Update `applyOutcome` to accept the component id for event-tagging:

```ts
private applyOutcome(outcome: Outcome, componentId: ComponentId): void {
  switch (outcome.kind) {
    case "forward":
      for (const emit of outcome.emit) this.activePackets.push(emit.packet);
      return;
    case "drop":
      this.lastStepEvents.push({ kind: "drop", componentId, reason: outcome.reason, count: outcome.count });
      return;
    case "terminate":
      this.lastStepEvents.push({ kind: "terminate", componentId, revenue: outcome.revenue });
      return;
    case "respond":
      return; // Task 10
  }
}
```

Update `dispatchArrival` to pass component id:

```ts
const outcome = cap.onArriveRequest(packet, ctx);
this.applyOutcome(outcome, component.id);
```

- [ ] **Step 6: Run tests — expect pass**

Run: `pnpm test tests/unit/sim/outcome-drop.test.ts tests/unit/sim/outcome-terminate.test.ts 2>&1 | tail -15`

Expected: 3 passing total (2 from drop, 1 from terminate).

- [ ] **Step 7: Regression check**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: all sim tests passing.

- [ ] **Step 8: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/sim.ts src/sim/types.ts tests/unit/sim/outcome-drop.test.ts tests/unit/sim/outcome-terminate.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): drop + terminate outcomes emit lastStepEvents"`

---

## Task 10: Outcome handling — respond + twin routing retrace

**Files:**
- Modify: `src/sim/sim.ts` (respond handler, response-leg retrace, event)
- Test: `tests/unit/sim/outcome-respond.test.ts`
- Test: `tests/unit/sim/twin-retrace.test.ts`

A `respond` outcome generates a response packet with `direction: "back"`. The response packet emits on the twin of the edge it *would* have continued through (i.e., the ingress edge of the component that responded). Each response arrival pops its `route[]` and emits on the twin of the popped entry. When `route[]` is empty, the response has reached the origin — emit a `respond-delivered` event and retire.

- [ ] **Step 1: Write failing test — `respond` at leaf emits response packet on twin of ingress**

Create `tests/unit/sim/outcome-respond.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, ArrivalContext, Packet, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function responder(revenue: number, backSpeed: number): SimCapability {
  return {
    id: "responder",
    onArriveRequest(p: Packet, ctx: ArrivalContext): Outcome {
      const response: Packet = {
        id: ctx.mintPacketId(),
        requests: p.requests,
        edgeId: p.edgeId, // will be overwritten by sim using twin lookup
        progress: 0,
        speed: backSpeed,
        spawnedAt: ctx.simTime,
        parentId: p.id,
        direction: "back",
        route: [...p.route],
      };
      return { kind: "respond", responsePacket: response, revenueOnDelivery: revenue } as Outcome;
    },
  };
}

describe("outcome: respond", () => {
  beforeEach(() => resetIdCountersForTest());

  it("emits response packet on the twin of the request's ingress edge", () => {
    const sim = new Sim({ seed: 1 });
    const forwardEdge = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: "a" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "eb" as ConnectionId,
      direction: "forward",
    });
    const backEdge = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "a" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "ef" as ConnectionId,
      direction: "back",
    });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [responder(5, backEdge.speed)] });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(forwardEdge);
    sim.addConnection(backEdge);
    sim.spawnPacket(makePacket({ requests: [], edgeId: forwardEdge.id, speed: forwardEdge.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    // request arrived at b; response should now be in-flight on backEdge
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0].direction).toBe("back");
    expect(sim.activePackets[0].edgeId).toBe(backEdge.id);
  });

  it("fires respond-delivered event when response reaches origin (empty route)", () => {
    const sim = new Sim({ seed: 1 });
    const forwardEdge = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: "a" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "eb" as ConnectionId,
      direction: "forward",
    });
    const backEdge = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "a" as ComponentId, portId: "in" as PortId },
      bandwidth: 100,
      latencySeconds: 1 / 60,
      twinId: "ef" as ConnectionId,
      direction: "back",
    });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [responder(7, backEdge.speed)] });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(forwardEdge);
    sim.addConnection(backEdge);
    sim.spawnPacket(makePacket({ requests: [], edgeId: forwardEdge.id, speed: forwardEdge.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60); // request arrives at b, response born on eb
    sim.step(1 / 60); // response arrives at a
    const delivered = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: "respond-delivered", componentId: a.id, revenue: 7 });
    expect(sim.activePackets.length).toBe(0);
  });
});
```

- [ ] **Step 2: Write failing test — multi-hop retrace**

Create `tests/unit/sim/twin-retrace.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { SimCapability, ArrivalContext, Packet, Outcome } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function forwarder(toEdge: ConnectionId, speed: number): SimCapability {
  return {
    id: "forwarder",
    onArriveRequest(p: Packet, ctx: ArrivalContext): Outcome {
      const child: Packet = {
        ...p,
        id: ctx.mintPacketId(),
        edgeId: toEdge,
        progress: 0,
        speed,
        route: [...p.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: toEdge, packet: child }] };
    },
  };
}

function responder(revenue: number, backSpeed: number): SimCapability {
  return {
    id: "responder",
    onArriveRequest(p: Packet, ctx: ArrivalContext): Outcome {
      const response: Packet = {
        id: ctx.mintPacketId(),
        requests: p.requests,
        edgeId: p.edgeId, // placeholder — sim rewrites
        progress: 0,
        speed: backSpeed,
        spawnedAt: ctx.simTime,
        parentId: p.id,
        direction: "back",
        route: [...p.route, ctx.ingressEdgeId],
      };
      return { kind: "respond", responsePacket: response, revenueOnDelivery: revenue } as Outcome;
    },
  };
}

describe("twin retrace — 3-hop", () => {
  beforeEach(() => resetIdCountersForTest());

  it("response traverses A→B, B→C and retires at A", () => {
    const sim = new Sim({ seed: 1 });
    const eAB = new SimConnection({
      id: "eAB" as ConnectionId,
      from: { componentId: "a" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eBA" as ConnectionId, direction: "forward",
    });
    const eBA = new SimConnection({
      id: "eBA" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "a" as ComponentId, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eAB" as ConnectionId, direction: "back",
    });
    const eBC = new SimConnection({
      id: "eBC" as ConnectionId,
      from: { componentId: "b" as ComponentId, portId: "out" as PortId },
      to: { componentId: "c" as ComponentId, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eCB" as ConnectionId, direction: "forward",
    });
    const eCB = new SimConnection({
      id: "eCB" as ConnectionId,
      from: { componentId: "c" as ComponentId, portId: "out" as PortId },
      to: { componentId: "b" as ComponentId, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eBC" as ConnectionId, direction: "back",
    });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [forwarder(eBC.id, eBC.speed)] });
    const c = new SimComponent({ id: "c" as ComponentId, capabilities: [responder(11, eCB.speed)] });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addComponent(c);
    sim.addConnection(eAB);
    sim.addConnection(eBA);
    sim.addConnection(eBC);
    sim.addConnection(eCB);
    sim.spawnPacket(makePacket({ requests: [], edgeId: eAB.id, speed: eAB.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60); // arrives at b, forwarded onto eBC
    sim.step(1 / 60); // arrives at c, responds onto eCB
    expect(sim.activePackets[0]?.edgeId).toBe(eCB.id);
    expect(sim.activePackets[0]?.direction).toBe("back");
    sim.step(1 / 60); // response arrives at b, retraces onto eBA
    expect(sim.activePackets[0]?.edgeId).toBe(eBA.id);
    sim.step(1 / 60); // response arrives at a, retires
    const delivered = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: "respond-delivered", componentId: a.id, revenue: 11 });
    expect(sim.activePackets.length).toBe(0);
  });
});
```

- [ ] **Step 3: Extend `Outcome` union + event type**

Modify `src/sim/types.ts`:

- Update the `respond` Outcome arm:

```ts
  | { readonly kind: "respond"; readonly responsePacket: Packet; readonly revenueOnDelivery: number }
```

- (event type for `respond-delivered` was added in Task 9 already.)

- [ ] **Step 4: Implement respond + response-leg retrace in `Sim`**

Modify `src/sim/sim.ts`:

- `Packet` is declared readonly for most fields, but `edgeId` must be rewritable when the response enters the twin edge. Update `Packet` in `src/sim/types.ts` to make `edgeId` mutable:

```ts
export type Packet = {
  readonly id: PacketId;
  readonly requests: readonly Request[];
  edgeId: ConnectionId;     // mutable: response legs overwrite on retrace
  progress: number;
  speed: number;            // mutable: retrace re-sets to next twin's speed
  readonly spawnedAt: number;
  readonly parentId: PacketId | null;
  readonly direction: PacketDirection;
  route: ConnectionId[];
};
```

- Maintain a map of `respond-delivered` revenue keyed by response-packet id (so we remember what to flash when the response retires):

```ts
// Sim fields
private readonly revenueByPacketId: Map<PacketId, number> = new Map();
```

- Update `applyOutcome`:

```ts
case "respond": {
  const resp = outcome.responsePacket;
  const lastRequestEdgeId = resp.route[resp.route.length - 1];
  if (lastRequestEdgeId === undefined) {
    // degenerate: response has no route → deliver immediately
    this.lastStepEvents.push({ kind: "respond-delivered", componentId, revenue: outcome.revenueOnDelivery });
    return;
  }
  const twinId = this.connections.get(lastRequestEdgeId)?.twinId;
  const twin = twinId ? this.connections.get(twinId) : undefined;
  if (!twin) return; // topology broken — drop silently
  resp.edgeId = twin.id;
  resp.speed = twin.speed;
  // do NOT pop route here — it's popped when the response arrives at each hop
  this.revenueByPacketId.set(resp.id, outcome.revenueOnDelivery);
  this.activePackets.push(resp);
  return;
}
```

- Update `dispatchArrival` for response-leg to retrace:

```ts
if (packet.direction === "forward") {
  const cap = component.capabilities[0];
  if (!cap) return;
  const outcome = cap.onArriveRequest(packet, ctx);
  this.applyOutcome(outcome, component.id);
} else {
  for (const cap of component.capabilities) {
    cap.onArriveResponse?.(packet, ctx);
  }
  // Response just arrived at a component. Pop the route and retrace on next twin.
  const poppedEdgeId = packet.route.pop();
  if (poppedEdgeId === undefined) {
    // No upstream left — response has returned to origin.
    const revenue = this.revenueByPacketId.get(packet.id) ?? 0;
    this.revenueByPacketId.delete(packet.id);
    this.lastStepEvents.push({ kind: "respond-delivered", componentId: component.id, revenue });
    return;
  }
  const nextRequestEdgeId = packet.route[packet.route.length - 1];
  if (nextRequestEdgeId === undefined) {
    // Reached origin — route is now empty; response delivered.
    const revenue = this.revenueByPacketId.get(packet.id) ?? 0;
    this.revenueByPacketId.delete(packet.id);
    this.lastStepEvents.push({ kind: "respond-delivered", componentId: component.id, revenue });
    return;
  }
  const nextTwinId = this.connections.get(nextRequestEdgeId)?.twinId;
  const nextTwin = nextTwinId ? this.connections.get(nextTwinId) : undefined;
  if (!nextTwin) return;
  packet.edgeId = nextTwin.id;
  packet.progress = 0;
  packet.speed = nextTwin.speed;
  this.activePackets.push(packet);
}
```

Note: `packet.route` is populated by each `forwarder` capability (as in the test setup — each component appends its ingress edge id to the route when forwarding). The same pattern holds in Stage A's three capabilities (Tasks 11–13).

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm test tests/unit/sim/outcome-respond.test.ts tests/unit/sim/twin-retrace.test.ts 2>&1 | tail -15`

Expected: 3 passing total.

- [ ] **Step 6: Regression check**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: every sim test green. Note: the outcome-forward test's forwarder did not build the route correctly until this task — verify the twin-retrace test passes exercises the same route-population discipline.

- [ ] **Step 7: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/sim.ts src/sim/types.ts tests/unit/sim/outcome-respond.test.ts tests/unit/sim/twin-retrace.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): respond outcome + response-leg twin retrace"`

---

## Task 11: ProcessingCapability

**Files:**
- Create: `src/sim/capabilities/processing.ts`
- Test: `tests/unit/sim/processing-capability.test.ts`

`ProcessingCapability` decides based on `request.isWrite`:

- Writes → `terminate` with configured revenue per write × packet count (also consumes capacity bucket credits).
- Non-writes → `respond` with configured revenue per read × packet count (consumes credits).
- Insufficient credits → `drop` with reason `overloaded`, count equal to packet's request count.

The capability needs the component's CapacityBucket. The Sim wires this by looking up the arriving component. We expose it through the ctx.

- [ ] **Step 1: Extend `ArrivalContext` to expose the capacity bucket**

Modify `src/sim/types.ts`:

```ts
import type { CapacityBucket } from "./capacity-bucket";

export type ArrivalContext = {
  readonly componentId: ComponentId;
  readonly ingressEdgeId: ConnectionId;
  readonly simTime: number;
  readonly rng: () => number;
  readonly bucket: CapacityBucket | null;
  readonly mintPacketId: () => PacketId;
  readonly mintRequestId: () => RequestId;
};
```

Modify `src/sim/sim.ts` — `dispatchArrival` builds ctx with `bucket: component.bucket`.

- [ ] **Step 2: Write failing test**

Create `tests/unit/sim/processing-capability.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { ProcessingCapability } from "@sim/capabilities/processing";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(isWrite: boolean): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite,
    requiresAuth: false,
    isLarge: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("ProcessingCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  function bootWithResponse(capacityPerSecond: number) {
    const sim = new Sim({ seed: 1 });
    const cap = new ProcessingCapability({ revenuePerWrite: 3, revenuePerRead: 2 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [cap], capacityPerSecond });
    const ef = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "eb" as ConnectionId, direction: "forward",
    });
    const eb = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: b.id, portId: "out" as PortId },
      to: { componentId: a.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ef" as ConnectionId, direction: "back",
    });
    sim.addComponent(a);
    sim.addComponent(b);
    sim.addConnection(ef);
    sim.addConnection(eb);
    return { sim, ef, eb, a, b };
  }

  it("terminates a write-only packet with revenuePerWrite × count", () => {
    const { sim, ef } = bootWithResponse(100);
    const pkt = makePacket({
      requests: [mkReq(true), mkReq(true), mkReq(true)],
      edgeId: ef.id,
      speed: ef.speed,
      spawnedAt: 0,
      direction: "forward",
      route: [],
    });
    sim.spawnPacket(pkt);
    sim.step(1 / 60);
    const terms = sim.lastStepEvents.filter((ev) => ev.kind === "terminate");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: "terminate", revenue: 9 });
  });

  it("responds to a read-only packet with revenuePerRead × count", () => {
    const { sim, ef, a } = bootWithResponse(100);
    const pkt = makePacket({
      requests: [mkReq(false), mkReq(false)],
      edgeId: ef.id,
      speed: ef.speed,
      spawnedAt: 0,
      direction: "forward",
      route: [],
    });
    sim.spawnPacket(pkt);
    sim.step(1 / 60); // request arrives, response born
    sim.step(1 / 60); // response arrives at a
    const delivered = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: "respond-delivered", componentId: a.id, revenue: 4 });
  });

  it("drops when bucket has insufficient credits", () => {
    const { sim, ef } = bootWithResponse(2); // capacity 2/sec
    // At step 1 (dt=1/60): bucket starts at 2. 3 writes want 3 credits → drop.
    const pkt = makePacket({
      requests: [mkReq(true), mkReq(true), mkReq(true)],
      edgeId: ef.id,
      speed: ef.speed,
      spawnedAt: 0,
      direction: "forward",
      route: [],
    });
    sim.spawnPacket(pkt);
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((ev) => ev.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "overloaded", count: 3 });
  });

  it("rejects mixed-write/read packets to keep Stage A semantics unambiguous", () => {
    const { sim, ef } = bootWithResponse(100);
    const pkt = makePacket({
      requests: [mkReq(true), mkReq(false)],
      edgeId: ef.id,
      speed: ef.speed,
      spawnedAt: 0,
      direction: "forward",
      route: [],
    });
    sim.spawnPacket(pkt);
    expect(() => sim.step(1 / 60)).toThrow(/mixed/i);
  });
});
```

- [ ] **Step 3: Implement `src/sim/capabilities/processing.ts`**

```ts
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type ProcessingCapabilityOptions = {
  readonly revenuePerWrite: number;
  readonly revenuePerRead: number;
};

/**
 * Stage A: terminates writes, responds to reads. Consumes capacity equal
 * to the packet's request count. Packets must be uniform (all-writes or
 * all-reads); mixed packets throw — wave generation produces uniform packets.
 */
export class ProcessingCapability implements SimCapability {
  readonly id = "processing";
  constructor(private readonly opts: ProcessingCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const anyWrite = packet.requests.some((r) => r.isWrite);
    const anyRead = packet.requests.some((r) => !r.isWrite);
    if (anyWrite && anyRead) {
      throw new Error("ProcessingCapability: mixed write/read packet");
    }
    const count = packet.requests.length;
    if (ctx.bucket && !ctx.bucket.tryConsume(count)) {
      return { kind: "drop", reason: "overloaded", count };
    }
    if (anyWrite) {
      return { kind: "terminate", revenue: this.opts.revenuePerWrite * count };
    }
    // Read: generate response that retraces via route.
    const response: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: packet.edgeId, // placeholder — sim overwrites with twin
      progress: 0,
      speed: packet.speed,   // placeholder — sim overwrites with twin's speed
      spawnedAt: ctx.simTime,
      parentId: packet.id,
      direction: "back",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return {
      kind: "respond",
      responsePacket: response,
      revenueOnDelivery: this.opts.revenuePerRead * count,
    };
  }
}
```

Small sim.ts adjustment: the `respond` arm uses `resp.route[resp.route.length - 1]` as the last request-leg edge. With the route containing `[...packet.route, ctx.ingressEdgeId]`, that's the ingress of the responder — exactly the edge whose twin the response should take. Good.

However, the response-leg retrace in `dispatchArrival` pops from `packet.route`. The first response arrival (at the responder's upstream neighbor) should pop `ingressEdgeId` — leaving `packet.route` containing just the earlier hops. Verify the twin-retrace test already covered this case. Yes — the earlier test passed with a route of `[eAB, eBC]` on the response, popping to `[eAB]` then `[]`.

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm test tests/unit/sim/processing-capability.test.ts 2>&1 | tail -15`

Expected: 4 passing.

- [ ] **Step 5: Regression check**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: all sim tests green.

- [ ] **Step 6: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/capabilities/processing.ts src/sim/types.ts src/sim/sim.ts tests/unit/sim/processing-capability.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): ProcessingCapability — terminate writes, respond to reads, bucket-gated"`

---

## Task 12: ForwardingCapability

**Files:**
- Create: `src/sim/capabilities/forwarding.ts`
- Test: `tests/unit/sim/forwarding-capability.test.ts`

Forwarding picks the first egress edge from the component's outbound connections (excluding the ingress edge's twin) and emits one child packet there. The cap needs to know the component's egress edges — expose them through ctx.

- [ ] **Step 1: Extend `ArrivalContext` with egress edges**

Modify `src/sim/types.ts`:

```ts
export type ArrivalContext = {
  readonly componentId: ComponentId;
  readonly ingressEdgeId: ConnectionId;
  readonly egressEdges: ReadonlyArray<{ id: ConnectionId; speed: number }>;
  readonly simTime: number;
  readonly rng: () => number;
  readonly bucket: CapacityBucket | null;
  readonly mintPacketId: () => PacketId;
  readonly mintRequestId: () => RequestId;
};
```

Modify `src/sim/sim.ts` in `dispatchArrival` — before building ctx, compute:

```ts
const egressEdges: { id: ConnectionId; speed: number }[] = [];
for (const conn of this.connections.values()) {
  if (conn.from.componentId === component.id && conn.direction === "forward") {
    egressEdges.push({ id: conn.id, speed: conn.speed });
  }
}
```

and pass `egressEdges` into the ctx.

- [ ] **Step 2: Write failing test**

Create `tests/unit/sim/forwarding-capability.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkReq(): Request {
  return {
    id: mintRequestId(),
    key: "k",
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

describe("ForwardingCapability", () => {
  beforeEach(() => resetIdCountersForTest());

  it("emits a child packet onto the single egress edge with route appended", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [new ForwardingCapability()] });
    const c = new SimComponent({ id: "c" as ComponentId, capabilities: [] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    const ba = new SimConnection({
      id: "ba" as ConnectionId,
      from: { componentId: b.id, portId: "out" as PortId },
      to: { componentId: a.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ab" as ConnectionId, direction: "back",
    });
    const bc = new SimConnection({
      id: "bc" as ConnectionId,
      from: { componentId: b.id, portId: "out" as PortId },
      to: { componentId: c.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "cb" as ConnectionId, direction: "forward",
    });
    const cb = new SimConnection({
      id: "cb" as ConnectionId,
      from: { componentId: c.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "bc" as ConnectionId, direction: "back",
    });
    sim.addComponent(a); sim.addComponent(b); sim.addComponent(c);
    sim.addConnection(ab); sim.addConnection(ba); sim.addConnection(bc); sim.addConnection(cb);
    sim.spawnPacket(makePacket({ requests: [mkReq()], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0].edgeId).toBe(bc.id);
    expect(sim.activePackets[0].route).toEqual([ab.id]);
  });

  it("drops on missing egress edge", () => {
    const sim = new Sim({ seed: 1 });
    const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [new ForwardingCapability()] });
    const ab = new SimConnection({
      id: "ab" as ConnectionId,
      from: { componentId: a.id, portId: "out" as PortId },
      to: { componentId: b.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
    });
    sim.addComponent(a); sim.addComponent(b);
    sim.addConnection(ab);
    sim.spawnPacket(makePacket({ requests: [mkReq()], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60);
    const drops = sim.lastStepEvents.filter((ev) => ev.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ reason: "no_egress", count: 1 });
  });
});
```

- [ ] **Step 3: Implement `src/sim/capabilities/forwarding.ts`**

```ts
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

/**
 * Stage A: forwards a packet onto the first egress edge. Emits one child
 * with the route appended. Drops `no_egress` if the component has no
 * forward-direction egress edges.
 */
export class ForwardingCapability implements SimCapability {
  readonly id = "forwarding";

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const egress = ctx.egressEdges[0];
    if (!egress) {
      return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    }
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
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm test tests/unit/sim/forwarding-capability.test.ts 2>&1 | tail -15`

Expected: 2 passing.

- [ ] **Step 5: Regression check**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: all sim tests green.

- [ ] **Step 6: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/capabilities/forwarding.ts src/sim/types.ts src/sim/sim.ts tests/unit/sim/forwarding-capability.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): ForwardingCapability — forward onto first egress"`

---

## Task 13: CachingCapability (key model + response-leg populate)

**Files:**
- Create: `src/sim/capabilities/caching.ts`
- Test: `tests/unit/sim/caching-capability.test.ts`

The cache:

1. On **request** (read packet) — iterate requests, check `key` against `slots`. Accumulate hits and misses.
   - Emit up to two children: a `respond` packet for hits (with revenue = revenuePerRead × hitCount) and a `forward` packet for misses onto the first egress edge.
   - If all hits: one respond. If all misses: one forward. If mixed: two outputs.
   - Write packets: currently pass through (invalidate slot + forward). Stage A minimum: treat writes as forward to egress (no invalidation yet — write-invalidation lands in Stage C).
2. On **response** (response packet arriving back through the cache on the response-leg) — populate slots for each request's key. LRU eviction when over capacity.

Important: the Outcome type doesn't support "emit two Outcomes at once." Either:
- (a) extend Outcome with `{ kind: "multi"; outcomes: Outcome[] }`
- (b) use `{ kind: "forward"; emit: [...] }` for everything and generate a respond as a "synthetic emit" event that the sim detects

Cleanest: introduce a `multi` outcome.

- [ ] **Step 1: Add `multi` to Outcome**

Modify `src/sim/types.ts`:

```ts
export type Outcome =
  | { readonly kind: "forward"; readonly emit: ReadonlyArray<{ edgeId: ConnectionId; packet: Packet }> }
  | { readonly kind: "terminate"; readonly revenue: number }
  | { readonly kind: "respond"; readonly responsePacket: Packet; readonly revenueOnDelivery: number }
  | { readonly kind: "drop"; readonly reason: string; readonly count: number }
  | { readonly kind: "multi"; readonly outcomes: readonly Outcome[] };
```

- [ ] **Step 2: Handle `multi` in applyOutcome**

Modify `src/sim/sim.ts`:

```ts
case "multi":
  for (const child of outcome.outcomes) this.applyOutcome(child, componentId);
  return;
```

- [ ] **Step 3: Write failing tests**

Create `tests/unit/sim/caching-capability.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { CachingCapability } from "@sim/capabilities/caching";
import { ProcessingCapability } from "@sim/capabilities/processing";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

function mkRead(key: string): Request {
  return {
    id: mintRequestId(),
    key,
    isWrite: false,
    requiresAuth: false,
    isLarge: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

function threeHopTopology(
  b: SimComponent, // cache
  c: SimComponent, // database
): { sim: Sim; ab: SimConnection; ba: SimConnection; bc: SimConnection; cb: SimConnection; a: SimComponent } {
  const sim = new Sim({ seed: 1 });
  const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
  const ab = new SimConnection({
    id: "ab" as ConnectionId,
    from: { componentId: a.id, portId: "out" as PortId },
    to: { componentId: b.id, portId: "in" as PortId },
    bandwidth: 100, latencySeconds: 1 / 60, twinId: "ba" as ConnectionId, direction: "forward",
  });
  const ba = new SimConnection({
    id: "ba" as ConnectionId,
    from: { componentId: b.id, portId: "out" as PortId },
    to: { componentId: a.id, portId: "in" as PortId },
    bandwidth: 100, latencySeconds: 1 / 60, twinId: "ab" as ConnectionId, direction: "back",
  });
  const bc = new SimConnection({
    id: "bc" as ConnectionId,
    from: { componentId: b.id, portId: "out" as PortId },
    to: { componentId: c.id, portId: "in" as PortId },
    bandwidth: 100, latencySeconds: 1 / 60, twinId: "cb" as ConnectionId, direction: "forward",
  });
  const cb = new SimConnection({
    id: "cb" as ConnectionId,
    from: { componentId: c.id, portId: "out" as PortId },
    to: { componentId: b.id, portId: "in" as PortId },
    bandwidth: 100, latencySeconds: 1 / 60, twinId: "bc" as ConnectionId, direction: "back",
  });
  sim.addComponent(a); sim.addComponent(b); sim.addComponent(c);
  sim.addConnection(ab); sim.addConnection(ba); sim.addConnection(bc); sim.addConnection(cb);
  return { sim, ab, ba, bc, cb, a };
}

describe("CachingCapability — cold cache", () => {
  beforeEach(() => resetIdCountersForTest());

  it("forwards all misses to the downstream on first read", () => {
    const cache = new CachingCapability({ capacity: 4, revenuePerRead: 1 });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [cache] });
    const c = new SimComponent({ id: "c" as ComponentId, capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })], capacityPerSecond: 100 });
    const { sim, ab, bc } = threeHopTopology(b, c);
    sim.spawnPacket(makePacket({ requests: [mkRead("k1"), mkRead("k2")], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60); // request arrives at cache, miss → forward to db
    // Exactly one forward on bc; no respond events yet.
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0].edgeId).toBe(bc.id);
    expect(sim.lastStepEvents.filter((e) => e.kind === "respond-delivered")).toHaveLength(0);
  });
});

describe("CachingCapability — populated cache", () => {
  beforeEach(() => resetIdCountersForTest());

  it("respond for hits + forward for misses in mixed request", () => {
    const cache = new CachingCapability({ capacity: 4, revenuePerRead: 5 });
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [cache] });
    const c = new SimComponent({ id: "c" as ComponentId, capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 2 })], capacityPerSecond: 100 });
    const { sim, ab, a } = threeHopTopology(b, c);
    // Pre-populate cache slots via direct access for this unit test.
    cache.__preloadForTest(["k1", "k2"]);
    sim.spawnPacket(makePacket({ requests: [mkRead("k1"), mkRead("k3"), mkRead("k2")], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    sim.step(1 / 60); // arrives at cache → respond for hits (k1,k2) + forward for miss (k3)
    // hits respond is born on ba; misses forward on bc → both active
    expect(sim.activePackets.length).toBe(2);
    sim.step(1 / 60); // hits response arrives at a; miss forward arrives at c; c responds on cb
    const delivered = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ componentId: a.id, revenue: 10 }); // 2 hits × 5
    sim.step(1 / 60); // db response arrives back at cache → cache populates k3, forwards response on ba
    sim.step(1 / 60); // miss response arrives at a
    const delivered2 = sim.lastStepEvents.filter((ev) => ev.kind === "respond-delivered");
    expect(delivered2).toHaveLength(1);
    expect(delivered2[0]).toMatchObject({ componentId: a.id, revenue: 2 }); // 1 miss × db read rev 2
  });
});

describe("CachingCapability — LRU eviction", () => {
  beforeEach(() => resetIdCountersForTest());

  it("evicts least-recently-used when over capacity on populate", () => {
    const cache = new CachingCapability({ capacity: 2, revenuePerRead: 0 });
    cache.__preloadForTest(["k1", "k2"]);
    cache.__populateForTest("k3"); // k1 evicted (oldest)
    expect(cache.hasKey("k1")).toBe(false);
    expect(cache.hasKey("k2")).toBe(true);
    expect(cache.hasKey("k3")).toBe(true);
  });

  it("a hit on k1 moves it to front, so k2 becomes LRU", () => {
    const cache = new CachingCapability({ capacity: 2, revenuePerRead: 0 });
    cache.__preloadForTest(["k1", "k2"]);
    cache.__touchForTest("k1"); // k1 now most recent
    cache.__populateForTest("k3"); // k2 evicted
    expect(cache.hasKey("k1")).toBe(true);
    expect(cache.hasKey("k2")).toBe(false);
    expect(cache.hasKey("k3")).toBe(true);
  });
});
```

- [ ] **Step 4: Implement `src/sim/capabilities/caching.ts`**

```ts
import type { ArrivalContext, Outcome, Packet, SimCapability, Request } from "../types";

export type CachingCapabilityOptions = {
  readonly capacity: number;
  readonly revenuePerRead: number;
};

/**
 * Stage A cache: key-keyed LRU slots. On read arrival, partitions requests
 * into hits (respond locally) and misses (forward to first egress). Writes
 * forward to first egress (invalidation is Stage C).
 *
 * Response-leg: when a response traverses back through this cache, populate
 * its requests' keys into slots (LRU eviction if over capacity).
 */
export class CachingCapability implements SimCapability {
  readonly id = "caching";
  private readonly slots: string[] = []; // front = most recent

  constructor(private readonly opts: CachingCapabilityOptions) {}

  hasKey(k: string): boolean {
    return this.slots.includes(k);
  }

  __preloadForTest(keys: readonly string[]): void {
    for (const k of keys) this.slots.push(k);
  }

  __touchForTest(key: string): void {
    const idx = this.slots.indexOf(key);
    if (idx === -1) return;
    this.slots.splice(idx, 1);
    this.slots.unshift(key);
  }

  __populateForTest(key: string): void {
    this.populate(key);
  }

  private lookupAndTouch(key: string): boolean {
    const idx = this.slots.indexOf(key);
    if (idx === -1) return false;
    this.slots.splice(idx, 1);
    this.slots.unshift(key);
    return true;
  }

  private populate(key: string): void {
    const idx = this.slots.indexOf(key);
    if (idx !== -1) {
      this.slots.splice(idx, 1);
      this.slots.unshift(key);
      return;
    }
    this.slots.unshift(key);
    if (this.slots.length > this.opts.capacity) {
      this.slots.pop();
    }
  }

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const hits: Request[] = [];
    const misses: Request[] = [];
    for (const r of packet.requests) {
      if (r.isWrite) {
        misses.push(r);
        continue;
      }
      if (this.lookupAndTouch(r.key)) hits.push(r);
      else misses.push(r);
    }
    const outcomes: Outcome[] = [];
    if (hits.length > 0) {
      const response: Packet = {
        id: ctx.mintPacketId(),
        requests: hits,
        edgeId: packet.edgeId,
        progress: 0,
        speed: packet.speed,
        spawnedAt: ctx.simTime,
        parentId: packet.id,
        direction: "back",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      outcomes.push({
        kind: "respond",
        responsePacket: response,
        revenueOnDelivery: this.opts.revenuePerRead * hits.length,
      });
    }
    if (misses.length > 0) {
      const egress = ctx.egressEdges[0];
      if (!egress) {
        outcomes.push({ kind: "drop", reason: "no_egress", count: misses.length });
      } else {
        const child: Packet = {
          id: ctx.mintPacketId(),
          requests: misses,
          edgeId: egress.id,
          progress: 0,
          speed: egress.speed,
          spawnedAt: ctx.simTime,
          parentId: packet.id,
          direction: "forward",
          route: [...packet.route, ctx.ingressEdgeId],
        };
        outcomes.push({ kind: "forward", emit: [{ edgeId: egress.id, packet: child }] });
      }
    }
    if (outcomes.length === 1) return outcomes[0];
    return { kind: "multi", outcomes };
  }

  onArriveResponse(packet: Packet, _ctx: ArrivalContext): void {
    for (const r of packet.requests) {
      if (!r.isWrite) this.populate(r.key);
    }
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm test tests/unit/sim/caching-capability.test.ts 2>&1 | tail -15`

Expected: 4 passing.

- [ ] **Step 6: Regression check**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: all sim tests green. Total new sim tests ≈ 20.

- [ ] **Step 7: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/capabilities/caching.ts src/sim/types.ts src/sim/sim.ts tests/unit/sim/caching-capability.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): CachingCapability — LRU slots, hit/miss split, response-populate"`

---

## Task 14: Determinism replay test

**Files:**
- Test: `tests/unit/sim/determinism-replay.test.ts`

Pin the guarantee: running the same wave-shaped scenario with the same seed produces byte-identical results.

- [ ] **Step 1: Write the test**

Create `tests/unit/sim/determinism-replay.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { CachingCapability } from "@sim/capabilities/caching";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { Request, SimEvent } from "@sim/types";

function mkReq(isWrite: boolean, key: string): Request {
  return {
    id: mintRequestId(),
    key,
    isWrite,
    requiresAuth: false,
    isLarge: false,
    originClientId: "client" as ComponentId,
    originZone: null,
    spawnedAt: 0,
  };
}

function buildScenario(seed: number): { sim: Sim; run: () => SimEvent[] } {
  const sim = new Sim({ seed });
  const a = new SimComponent({ id: "a" as ComponentId, capabilities: [] });
  const b = new SimComponent({ id: "b" as ComponentId, capabilities: [new ForwardingCapability()] });
  const cache = new CachingCapability({ capacity: 4, revenuePerRead: 5 });
  const c = new SimComponent({ id: "c" as ComponentId, capabilities: [cache] });
  const d = new SimComponent({ id: "d" as ComponentId, capabilities: [new ProcessingCapability({ revenuePerWrite: 3, revenuePerRead: 2 })], capacityPerSecond: 100 });
  sim.addComponent(a); sim.addComponent(b); sim.addComponent(c); sim.addComponent(d);
  const wire = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
    new SimConnection({
      id: id as ConnectionId, from: { componentId: from, portId: "p" as PortId }, to: { componentId: to, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 1 / 60, twinId: twin as ConnectionId, direction: dir,
    });
  const ab = wire("ab", a.id, b.id, "forward", "ba"); const ba = wire("ba", b.id, a.id, "back", "ab");
  const bc = wire("bc", b.id, c.id, "forward", "cb"); const cb = wire("cb", c.id, b.id, "back", "bc");
  const cd = wire("cd", c.id, d.id, "forward", "dc"); const dc = wire("dc", d.id, c.id, "back", "cd");
  for (const e of [ab, ba, bc, cb, cd, dc]) sim.addConnection(e);

  const run = (): SimEvent[] => {
    const log: SimEvent[] = [];
    sim.spawnPacket(makePacket({ requests: [mkReq(false, "k1"), mkReq(false, "k2"), mkReq(true, "k3")], edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward" }));
    for (let i = 0; i < 20; i += 1) {
      sim.step(1 / 60);
      log.push(...sim.lastStepEvents.map((ev) => ({ ...ev })));
    }
    return log;
  };
  return { sim, run };
}

describe("determinism replay", () => {
  beforeEach(() => resetIdCountersForTest());

  it("same seed + same scenario produces identical event logs", () => {
    const run1 = (() => { resetIdCountersForTest(); return buildScenario(42).run(); })();
    const run2 = (() => { resetIdCountersForTest(); return buildScenario(42).run(); })();
    expect(run2).toEqual(run1);
  });
});
```

- [ ] **Step 2: Run test — expect pass**

Run: `pnpm test tests/unit/sim/determinism-replay.test.ts 2>&1 | tail -10`

Expected: 1 passing. (If it fails, diagnose: Map iteration order is the usual suspect; ensure all sim internals that iterate Maps sort by id first.)

- [ ] **Step 3: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add tests/unit/sim/determinism-replay.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): determinism replay — same seed → identical event log"`

---

## Task 15: Pixi isolation invariant for `src/sim/`

**Files:**
- Create: `tests/unit/sim/sim-pixi-isolation.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/unit/sim/sim-pixi-isolation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const SCANNED_DIRS = ["src/sim"] as const;

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectTsFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("sim module does not import pixi.js", () => {
  it("no source file under src/sim/** imports from 'pixi.js'", () => {
    const offenders: string[] = [];
    for (const rel of SCANNED_DIRS) {
      const files = collectTsFiles(join(ROOT, rel));
      for (const file of files) {
        const content = readFileSync(file, "utf-8");
        if (/\bfrom\s+["']pixi\.js["']|\bimport\s+["']pixi\.js["']/.test(content)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — expect pass**

Run: `pnpm test tests/unit/sim/sim-pixi-isolation.test.ts 2>&1 | tail -10`

Expected: 1 passing.

- [ ] **Step 3: Full-suite regression check**

Run: `pnpm test 2>&1 | tail -5`

Expected: all existing tests still passing (832 + ~21 new sim tests = ~853 total). No failures.

Run: `pnpm typecheck 2>&1 | tail -5`

Expected: only the pre-existing `tests/unit/pull-from-buffers.test.ts:81` error. Nothing new.

- [ ] **Step 4: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add tests/unit/sim/sim-pixi-isolation.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): pixi isolation invariant for src/sim/**"`

---

## Completion

Upon completing all tasks, Stage A produces:

- `src/sim/` physics sim core (fixed-step loop, packet/connection types, capacity buckets, arrival dispatch, twin-retrace response flow, event log)
- Three capabilities: Processing (terminate writes / respond to reads), Forwarding (first egress), Caching (LRU slots, hit/miss split, response-populate)
- ~21 new unit tests — determinism replay is the headline guarantee
- Pixi-import invariant for `src/sim/`
- Zero changes under `src/core/**`, `src/capabilities/**`, `src/modes/**`, `src/dashboard/**`

Stage B (wave + client + snake) will consume this core to run Wave 1 end-to-end.

## Self-review notes

- Every test has a failing-run step with expected output before implementation.
- All imports use `@sim/*` or `@core/*` aliases.
- No `TBD`/`TODO` placeholders in implementation code.
- `applyOutcome`'s `multi` arm recursively applies children — handles the cache's hit+miss split cleanly.
- `Packet.edgeId` and `Packet.speed` are mutable so the response-leg retrace can re-home the packet onto the twin without allocating a new Packet per hop.
- Deterministic packet id ordering uses zero-padded ids so lexical sort matches numeric sort.
- `resetIdCountersForTest()` is in every test's `beforeEach` to prevent cross-test contamination.

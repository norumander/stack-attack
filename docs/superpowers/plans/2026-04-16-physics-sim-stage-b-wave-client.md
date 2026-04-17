# Physics Sim — Stage B (Wave + Client Snake) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wave generation and a client "snake" queue on top of the Stage A sim core, enough to run a deterministic Wave 1 end-to-end (`Client → Server → Database`) headless with revenue + drop accounting, and a determinism replay test that pins the wave-level guarantee.

**Architecture:** A `WaveDef` parameterizes per-second intensity, packet emission rate, attribute composition (write/auth/large/stream ratios), and a key distribution (Zipfian). A `TrafficSource` consumes the WaveDef + sim RNG and generates packets into one or more clients' visible "snakes" (queues of upcoming packets). On each step, due clients launch `snake[0]` onto a randomly chosen forward egress edge.

**Tech Stack:** TypeScript (strict), Vitest, pnpm. All work continues in `src/sim/` and `tests/unit/sim/`. Path alias `@sim/*` already configured.

**Working directory for all tasks:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`

**Reference spec:** `docs/superpowers/specs/2026-04-16-physics-driven-request-flow-design.md` (sections "Entry-point queue", "Wave definition", "Per-packet attribute rolls", "Per-request key rolls", "The snake state machine").

**Stage A precondition:** 16 sim files exist, 32 sim tests pass. `src/sim/` has `Sim`, `SimComponent`, `SimConnection`, `Packet`, capabilities (Processing, Forwarding, Caching). HEAD is `bb8b98f`.

---

## File Structure

**Created this stage:**

```
src/sim/
  zipf.ts                   # Zipf sampling helper
  wave.ts                   # WaveDef + WaveDefSchema (TypeScript types)
  traffic-source.ts         # TrafficSource — generates packets per WaveDef
  client.ts                 # SimClient — extends SimComponent with snake state
  snake.ts                  # Snake launch state machine (per-client cadence)

tests/unit/sim/
  zipf.test.ts
  traffic-source-attribute-rolls.test.ts
  traffic-source-key-rolls.test.ts
  traffic-source-determinism.test.ts
  client-snake-launch.test.ts
  wave1-end-to-end.test.ts        # the headline test
  wave1-replay-determinism.test.ts # bit-identical replay
```

**Modified this stage:**

- `src/sim/sim.ts` — add `clients: Map<ComponentId, SimClient>`, register clients alongside components, integrate snake-launch into `step()` (between `refillBucket` and `advancePackets` of the next step's wave generation? — actually before `advancePackets` so launched packets advance this step).
- `src/sim/index.ts` — barrel-export the new modules.

**Not touched this stage:** old engine (`src/core/engine/`), TD modes, dashboard.

---

## Task 1: Zipf sampler (`src/sim/zipf.ts`)

**Files:**
- Create: `src/sim/zipf.ts`
- Test: `tests/unit/sim/zipf.test.ts`

A Zipfian distribution with parameter `alpha` over `spaceSize` keys. We don't need a high-precision implementation — just one that produces a reproducibly-skewed distribution where key 0 is most frequent.

- [ ] **Step 1: Write failing test**

Create `tests/unit/sim/zipf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeZipfSampler } from "@sim/zipf";
import { makeSimRng } from "@sim/rng";

describe("makeZipfSampler", () => {
  it("returns integers in [0, spaceSize)", () => {
    const rng = makeSimRng(1);
    const sample = makeZipfSampler({ alpha: 1.07, spaceSize: 10 });
    for (let i = 0; i < 100; i += 1) {
      const k = sample(rng());
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(10);
      expect(Number.isInteger(k)).toBe(true);
    }
  });

  it("produces a skewed distribution: key 0 is most frequent", () => {
    const rng = makeSimRng(7);
    const sample = makeZipfSampler({ alpha: 1.5, spaceSize: 10 });
    const counts = new Array(10).fill(0) as number[];
    for (let i = 0; i < 10_000; i += 1) {
      counts[sample(rng())]! += 1;
    }
    // Key 0 should be the largest count
    const max = Math.max(...counts);
    expect(counts[0]).toBe(max);
    // Tail keys (8, 9) should be much smaller than head keys (0, 1)
    expect(counts[0]!).toBeGreaterThan(counts[9]! * 3);
  });

  it("is deterministic given the same RNG draws", () => {
    const rngA = makeSimRng(42);
    const rngB = makeSimRng(42);
    const sample = makeZipfSampler({ alpha: 1.07, spaceSize: 100 });
    const seqA = Array.from({ length: 50 }, () => sample(rngA()));
    const seqB = Array.from({ length: 50 }, () => sample(rngB()));
    expect(seqA).toEqual(seqB);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test tests/unit/sim/zipf.test.ts 2>&1 | tail -10`

Expected: resolve error.

- [ ] **Step 3: Implement `src/sim/zipf.ts`**

```ts
export type ZipfOptions = {
  readonly alpha: number;
  readonly spaceSize: number;
};

/**
 * Returns a function that, given a uniform sample u ∈ [0, 1), returns an
 * integer key in [0, spaceSize) drawn from a Zipfian distribution with
 * parameter alpha. Implementation: precompute the CDF and binary-search
 * the uniform sample.
 *
 * For alpha=1.07 (Wikipedia hot-key distribution), key 0 is ~11% of draws
 * over a 100-key space; for alpha=1.5, key 0 is ~38% of draws.
 */
export function makeZipfSampler(opts: ZipfOptions): (uniform: number) => number {
  const { alpha, spaceSize } = opts;
  const weights: number[] = new Array(spaceSize);
  let totalWeight = 0;
  for (let i = 0; i < spaceSize; i += 1) {
    const w = 1 / Math.pow(i + 1, alpha);
    weights[i] = w;
    totalWeight += w;
  }
  const cdf: number[] = new Array(spaceSize);
  let acc = 0;
  for (let i = 0; i < spaceSize; i += 1) {
    acc += weights[i]! / totalWeight;
    cdf[i] = acc;
  }
  return (uniform: number): number => {
    // Binary search the CDF
    let lo = 0;
    let hi = spaceSize - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (uniform < cdf[mid]!) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
}
```

- [ ] **Step 4: Run — expect 3 passing**

Run: `pnpm test tests/unit/sim/zipf.test.ts 2>&1 | tail -10`

Expected: 3 passing.

- [ ] **Step 5: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/zipf.ts tests/unit/sim/zipf.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): zipf sampler for hot-key wave distribution"`

---

## Task 2: WaveDef type (`src/sim/wave.ts`)

**Files:**
- Create: `src/sim/wave.ts` (types only)

Types only — no runtime code. Just a clean place to import `WaveDef` from.

- [ ] **Step 1: Implement `src/sim/wave.ts`**

```ts
import type { ComponentId } from "@core/types/ids";
import type { Zone, StreamConfig } from "./types";

export type WaveComposition = {
  readonly writeRatio: number;     // P(packet's requests are writes)
  readonly authRatio: number;      // P(requiresAuth)
  readonly streamRatio: number;    // P(stream)
  readonly largeRatio: number;     // P(isLarge)
};

export type WaveKeyDistribution =
  | { readonly kind: "zipf"; readonly alpha: number; readonly spaceSize: number }
  | { readonly kind: "uniform"; readonly spaceSize: number };

export type WaveDef = {
  readonly intensity: number;            // requests per second (target)
  readonly packetRate: number;           // packets per second visual cadence
  readonly duration: number;             // seconds of generation
  readonly composition: WaveComposition;
  readonly keyDistribution: WaveKeyDistribution;
  readonly streamConfig?: StreamConfig;  // when streamRatio > 0
  readonly zoneDistribution?: ReadonlyMap<Zone, number>;
  readonly entryClients: ReadonlyArray<ComponentId>; // clients that emit this wave
};
```

- [ ] **Step 2: No-test commit (types only)**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/wave.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): WaveDef type — composition, keyDistribution, packetRate"`

---

## Task 3: TrafficSource — attribute rolls

**Files:**
- Create: `src/sim/traffic-source.ts`
- Test: `tests/unit/sim/traffic-source-attribute-rolls.test.ts`

The TrafficSource owns wave generation. It tracks how much "request debt" has accumulated and decides when to emit the next packet. For Stage B Task 3, focus on the per-packet attribute roll logic (writes/auth/large/stream).

The clean shape: `TrafficSource` exposes `generatePacket(simTime, originClientId): Packet | null`. It returns null if no packet is due; otherwise it rolls attributes, generates `count` requests with keys, and constructs a Packet with `direction: "forward"`, `edgeId: <placeholder>`, `progress: 0`. The actual edge assignment happens at launch time (the snake holds the packet, then assigns it to the chosen egress at launch). For Task 3 we test the attribute math; later tasks wire it into the snake.

- [ ] **Step 1: Write failing test for attribute rolls**

Create `tests/unit/sim/traffic-source-attribute-rolls.test.ts`:

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
  composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 100 },
  entryClients: ["c1" as ComponentId],
};

describe("TrafficSource — attribute rolls", () => {
  beforeEach(() => resetIdCountersForTest());

  it("produces ~writeRatio writes over many packets", () => {
    const ts = new TrafficSource(wave, makeSimRng(1));
    let writes = 0;
    let total = 0;
    for (let i = 0; i < 5_000; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      total += 1;
      if (pkt.requests[0]!.isWrite) writes += 1;
    }
    const ratio = writes / total;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it("packets are uniform — all writes or all reads, never mixed", () => {
    const ts = new TrafficSource(wave, makeSimRng(2));
    for (let i = 0; i < 200; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      const writeCount = pkt.requests.filter((r) => r.isWrite).length;
      expect(writeCount === 0 || writeCount === pkt.requests.length).toBe(true);
    }
  });

  it("packet count = round(intensity / packetRate) = 2", () => {
    const ts = new TrafficSource(wave, makeSimRng(3));
    for (let i = 0; i < 10; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      expect(pkt.requests.length).toBe(2);
    }
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test tests/unit/sim/traffic-source-attribute-rolls.test.ts 2>&1 | tail -10`

Expected: resolve error.

- [ ] **Step 3: Implement `src/sim/traffic-source.ts`**

```ts
import type { ComponentId } from "@core/types/ids";
import type { Packet, Request } from "./types";
import type { WaveDef, WaveKeyDistribution } from "./wave";
import { makeZipfSampler } from "./zipf";
import { mintPacketId, mintRequestId } from "./packet";

/**
 * Generates packets per wave definition. Stage B scope: deterministic per-tick
 * emission with attribute rolls (per-packet uniform — all writes or all reads),
 * key rolls (zipf or uniform), and constant per-packet count = intensity/packetRate.
 *
 * Snake launch and edge assignment happen elsewhere; this just makes the Packet shape
 * with a placeholder edgeId.
 */
export class TrafficSource {
  private readonly perPacketCount: number;
  private readonly sampleKey: (uniform: number) => number;

  constructor(
    private readonly wave: WaveDef,
    private readonly rng: () => number,
  ) {
    this.perPacketCount = Math.max(1, Math.round(wave.intensity / wave.packetRate));
    this.sampleKey = buildKeySampler(wave.keyDistribution);
  }

  /**
   * Test-only: synchronously generate one packet without considering pacing.
   * Production scheduling runs in the snake (Task 5).
   */
  generatePacketForTest(originClientId: ComponentId, simTime: number): Packet {
    const isWrite = this.rng() < this.wave.composition.writeRatio;
    const requiresAuth = this.rng() < this.wave.composition.authRatio;
    const isLarge = this.rng() < this.wave.composition.largeRatio;
    const isStream = this.rng() < this.wave.composition.streamRatio;
    const requests: Request[] = [];
    for (let i = 0; i < this.perPacketCount; i += 1) {
      const keyIdx = this.sampleKey(this.rng());
      requests.push({
        id: mintRequestId(),
        key: `k${keyIdx}`,
        isWrite,
        requiresAuth,
        isLarge,
        ...(isStream && this.wave.streamConfig ? { stream: this.wave.streamConfig } : {}),
        originClientId,
        originZone: null,
        spawnedAt: simTime,
      });
    }
    return {
      id: mintPacketId(),
      requests,
      // edgeId/speed placeholders — assigned at launch time by the snake (Task 5).
      edgeId: "" as Packet["edgeId"],
      progress: 0,
      speed: 0,
      spawnedAt: simTime,
      parentId: null,
      direction: "forward",
      route: [],
    };
  }
}

function buildKeySampler(kd: WaveKeyDistribution): (u: number) => number {
  if (kd.kind === "zipf") {
    return makeZipfSampler({ alpha: kd.alpha, spaceSize: kd.spaceSize });
  }
  return (u: number) => Math.floor(u * kd.spaceSize);
}
```

- [ ] **Step 4: Run — expect 3 passing**

Run: `pnpm test tests/unit/sim/traffic-source-attribute-rolls.test.ts 2>&1 | tail -10`

Expected: 3 passing.

- [ ] **Step 5: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/traffic-source.ts tests/unit/sim/traffic-source-attribute-rolls.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): TrafficSource — per-packet attribute + uniform-packet rolls"`

---

## Task 4: TrafficSource — key rolls + determinism

**Files:**
- Test: `tests/unit/sim/traffic-source-key-rolls.test.ts`
- Test: `tests/unit/sim/traffic-source-determinism.test.ts`

These pin: (a) Zipf-keyed distribution actually clusters on hot keys; (b) two TrafficSources with the same RNG seed produce byte-identical packet streams.

- [ ] **Step 1: Write Zipf-key test**

Create `tests/unit/sim/traffic-source-key-rolls.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { resetIdCountersForTest } from "@sim/packet";
import type { ComponentId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

describe("TrafficSource — key rolls", () => {
  beforeEach(() => resetIdCountersForTest());

  it("zipf distribution clusters on key0 (hot key)", () => {
    const wave: WaveDef = {
      intensity: 10,
      packetRate: 5,
      duration: 60,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.5, spaceSize: 10 },
      entryClients: ["c1" as ComponentId],
    };
    const ts = new TrafficSource(wave, makeSimRng(1));
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      for (const r of pkt.requests) {
        counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
      }
    }
    expect(counts.get("k0")! ).toBeGreaterThan(counts.get("k9") ?? 0);
  });
});
```

- [ ] **Step 2: Write determinism test**

Create `tests/unit/sim/traffic-source-determinism.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { resetIdCountersForTest } from "@sim/packet";
import type { ComponentId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 25,
  packetRate: 5,
  duration: 30,
  composition: { writeRatio: 0.3, authRatio: 0.2, streamRatio: 0, largeRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  entryClients: ["c1" as ComponentId],
};

describe("TrafficSource — determinism", () => {
  beforeEach(() => resetIdCountersForTest());

  it("two sources with same seed produce identical packet streams", () => {
    const tsA = new TrafficSource(wave, makeSimRng(42));
    const tsB = new TrafficSource(wave, makeSimRng(42));
    for (let i = 0; i < 50; i += 1) {
      const a = tsA.generatePacketForTest("c1" as ComponentId, 0);
      const b = tsB.generatePacketForTest("c1" as ComponentId, 0);
      expect(b.requests.length).toBe(a.requests.length);
      for (let j = 0; j < a.requests.length; j += 1) {
        expect(b.requests[j]!.isWrite).toBe(a.requests[j]!.isWrite);
        expect(b.requests[j]!.requiresAuth).toBe(a.requests[j]!.requiresAuth);
        expect(b.requests[j]!.key).toBe(a.requests[j]!.key);
      }
    }
  });
});
```

- [ ] **Step 3: Run — expect 2 passing**

Run: `pnpm test tests/unit/sim/traffic-source-key-rolls.test.ts tests/unit/sim/traffic-source-determinism.test.ts 2>&1 | tail -10`

Expected: 2 passing.

- [ ] **Step 4: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add tests/unit/sim/traffic-source-key-rolls.test.ts tests/unit/sim/traffic-source-determinism.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): traffic-source key rolls + determinism"`

---

## Task 5: SimClient + snake state machine

**Files:**
- Create: `src/sim/client.ts`
- Create: `src/sim/snake.ts`
- Modify: `src/sim/sim.ts` (clients map + snake-launch in step)
- Modify: `src/sim/index.ts` (barrel exports)
- Test: `tests/unit/sim/client-snake-launch.test.ts`

A `SimClient` is a `SimComponent` subclass that holds:
- a reference to its `TrafficSource` and the wave it serves;
- a `snake: Packet[]` queue (max length `snakeMax = 10`);
- a `nextLaunchTime: number` for cadence (`1 / packetRate` seconds between launches);
- a `nextGenerateTime: number` similarly for snake-tail population.

Each step, the Sim loops over all clients and:
1. While `nextGenerateTime ≤ simTime` and `snake.length < snakeMax`: generate a packet, push to tail, increment `nextGenerateTime` by `1/packetRate`.
2. While `nextLaunchTime ≤ simTime` and `snake.length > 0`: pop `snake.head`, pick a random forward egress edge from this client's connections, assign edgeId/speed, spawn into `sim.activePackets`. Increment `nextLaunchTime` by `1/packetRate`.
3. Wave duration: stop generating new packets after `simTime ≥ waveStartTime + wave.duration`. Continue launching whatever's in the snake.

For Task 5, focus on the launch mechanism with a manually-fed snake. Wave duration handling is in Task 6.

- [ ] **Step 1: Implement `src/sim/client.ts`**

```ts
import { SimComponent, type SimComponentOptions } from "./component";
import type { Packet } from "./types";

export type SimClientOptions = SimComponentOptions & {
  readonly packetRate: number;     // packets per second (visual cadence)
  readonly snakeMax?: number;      // default 10
};

export class SimClient extends SimComponent {
  readonly packetRate: number;
  readonly snakeMax: number;
  readonly snake: Packet[] = [];
  nextLaunchTime: number = 0;
  nextGenerateTime: number = 0;

  constructor(opts: SimClientOptions) {
    super(opts);
    this.packetRate = opts.packetRate;
    this.snakeMax = opts.snakeMax ?? 10;
  }
}
```

- [ ] **Step 2: Implement `src/sim/snake.ts`**

```ts
import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { Packet } from "./types";
import type { SimClient } from "./client";
import type { SimConnection } from "./connection";

/**
 * Per-step snake-launch routine. For each client that's due, pop snake.head,
 * pick a random forward egress, assign edgeId/speed, push to activePackets.
 */
export function launchDueSnakes(
  clients: ReadonlyMap<ComponentId, SimClient>,
  connections: ReadonlyMap<ConnectionId, SimConnection>,
  activePackets: Packet[],
  simTime: number,
  rng: () => number,
): void {
  for (const client of clients.values()) {
    while (client.nextLaunchTime <= simTime && client.snake.length > 0) {
      const head = client.snake.shift()!;
      const egresses = collectForwardEgresses(connections, client.id);
      if (egresses.length === 0) {
        // No egress — drop the launch silently for this task; Task 7 turns this
        // into an explicit "no egress at client" drop event.
        client.nextLaunchTime += 1 / client.packetRate;
        continue;
      }
      const idx = Math.floor(rng() * egresses.length);
      const chosen = egresses[idx]!;
      head.edgeId = chosen.id;
      head.speed = chosen.speed;
      head.progress = 0;
      activePackets.push(head);
      client.nextLaunchTime += 1 / client.packetRate;
    }
  }
}

function collectForwardEgresses(
  connections: ReadonlyMap<ConnectionId, SimConnection>,
  clientId: ComponentId,
): SimConnection[] {
  const egresses: SimConnection[] = [];
  for (const c of connections.values()) {
    if (c.from.componentId === clientId && c.direction === "forward") {
      egresses.push(c);
    }
  }
  return egresses;
}
```

- [ ] **Step 3: Wire into `Sim`**

Modify `src/sim/sim.ts`:

Add field:
```ts
readonly clients: Map<ComponentId, SimClient> = new Map();
```

Add `addClient` method:
```ts
addClient(c: SimClient): void {
  this.clients.set(c.id, c);
  this.components.set(c.id, c);
}
```

Wire snake launch into `step(dt)`:

```ts
step(dt: number): void {
  this.lastStepEvents.length = 0;
  for (const c of this.components.values()) c.refillBucket(dt);
  launchDueSnakes(this.clients, this.connections, this.activePackets, this.simTime, this.rng);
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

(Add `import { launchDueSnakes } from "./snake";` and the `SimClient` type import.)

- [ ] **Step 4: Update `src/sim/index.ts`**

Add to barrel:
```ts
export { SimClient } from "./client";
export { TrafficSource } from "./traffic-source";
export type { WaveDef, WaveComposition, WaveKeyDistribution } from "./wave";
```

- [ ] **Step 5: Write failing test**

Create `tests/unit/sim/client-snake-launch.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest } from "@sim/packet";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

describe("client snake launch", () => {
  beforeEach(() => resetIdCountersForTest());

  it("launches snake.head onto the only forward egress at the configured cadence", () => {
    const sim = new Sim({ seed: 1 });
    const client = new SimClient({ id: "c" as ComponentId, capabilities: [], packetRate: 5 }); // 1 launch / 0.2s
    const server = new SimComponent({ id: "s" as ComponentId, capabilities: [] });
    const e = new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: client.id, portId: "out" as PortId },
      to: { componentId: server.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 0.5, twinId: "et" as ConnectionId, direction: "forward",
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addConnection(e);
    // Manually load the snake (TrafficSource integration is Task 6).
    const p1 = makePacket({ requests: [], edgeId: "" as ConnectionId, speed: 0, spawnedAt: 0, direction: "forward" });
    const p2 = makePacket({ requests: [], edgeId: "" as ConnectionId, speed: 0, spawnedAt: 0, direction: "forward" });
    client.snake.push(p1, p2);

    // Step 1 at simTime=0: client.nextLaunchTime starts 0, so launch fires.
    sim.step(1 / 60);
    expect(sim.activePackets.length).toBe(1);
    expect(sim.activePackets[0]!.edgeId).toBe(e.id);
    expect(sim.activePackets[0]!.speed).toBeCloseTo(2, 6);
    expect(client.snake.length).toBe(1);

    // Advance simTime to next launch (0.2s after first). 1/60 ≈ 0.0167.
    // After 12 more steps we're at ~0.2167s — second launch fires.
    for (let i = 0; i < 12; i += 1) sim.step(1 / 60);
    expect(client.snake.length).toBe(0);
  });

  it("launches randomly when there are multiple forward egresses", () => {
    const sim = new Sim({ seed: 1 });
    const client = new SimClient({ id: "c" as ComponentId, capabilities: [], packetRate: 60 });
    const sA = new SimComponent({ id: "sa" as ComponentId, capabilities: [] });
    const sB = new SimComponent({ id: "sb" as ComponentId, capabilities: [] });
    const eA = new SimConnection({
      id: "eA" as ConnectionId,
      from: { componentId: client.id, portId: "out" as PortId },
      to: { componentId: sA.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1, twinId: "eAt" as ConnectionId, direction: "forward",
    });
    const eB = new SimConnection({
      id: "eB" as ConnectionId,
      from: { componentId: client.id, portId: "out" as PortId },
      to: { componentId: sB.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 1, twinId: "eBt" as ConnectionId, direction: "forward",
    });
    sim.addClient(client);
    sim.addComponent(sA);
    sim.addComponent(sB);
    sim.addConnection(eA);
    sim.addConnection(eB);
    let aCount = 0;
    let bCount = 0;
    for (let i = 0; i < 200; i += 1) {
      const p = makePacket({ requests: [], edgeId: "" as ConnectionId, speed: 0, spawnedAt: 0, direction: "forward" });
      client.snake.push(p);
    }
    for (let i = 0; i < 200; i += 1) sim.step(1 / 60);
    for (const p of sim.activePackets) {
      if (p.edgeId === eA.id) aCount += 1;
      if (p.edgeId === eB.id) bCount += 1;
    }
    expect(aCount).toBeGreaterThan(50);
    expect(bCount).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 6: Run — expect 2 passing**

Run: `pnpm test tests/unit/sim/client-snake-launch.test.ts 2>&1 | tail -10`

Expected: 2 passing.

- [ ] **Step 7: Sim regression**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: 39 sim tests passing (32 prior + 4 zipf/traffic-source + 2 snake — wait the new ones from earlier tasks were 4 traffic + 1 zipf x 3 = check 32 prior + 3 zipf + 3 attribute + 2 zipf-key+determinism + 2 launch = 42. Confirm whatever the actual count is.)

- [ ] **Step 8: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/client.ts src/sim/snake.ts src/sim/sim.ts src/sim/index.ts tests/unit/sim/client-snake-launch.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): SimClient + snake launch — per-packet random egress pick"`

---

## Task 6: TrafficSource integration with snake — wave duration + auto-population

**Files:**
- Modify: `src/sim/snake.ts` (add `populateSnakes` for TrafficSource-driven generation)
- Modify: `src/sim/sim.ts` (wire populateSnakes alongside launchDueSnakes; track wave start time per client)
- Modify: `src/sim/client.ts` (add optional `trafficSource` and `waveStartTime`/`waveEndTime` fields)
- Test: `tests/unit/sim/snake-population-and-duration.test.ts`

The Sim now needs to know each client's wave to know when to generate / stop generating. Simplest API: client carries an optional `trafficSource` + wave-bounded times. The Sim loops over clients each step and calls a helper that handles both populate and launch.

- [ ] **Step 1: Extend `SimClient`**

Modify `src/sim/client.ts`:

```ts
import { SimComponent, type SimComponentOptions } from "./component";
import type { Packet } from "./types";
import type { TrafficSource } from "./traffic-source";

export type SimClientOptions = SimComponentOptions & {
  readonly packetRate: number;
  readonly snakeMax?: number;
  readonly trafficSource?: TrafficSource;
  readonly waveStartTime?: number;   // simTime to start generating; default 0
  readonly waveEndTime?: number;     // simTime to stop generating; default Infinity
};

export class SimClient extends SimComponent {
  readonly packetRate: number;
  readonly snakeMax: number;
  readonly snake: Packet[] = [];
  readonly trafficSource: TrafficSource | null;
  readonly waveStartTime: number;
  readonly waveEndTime: number;
  nextLaunchTime: number = 0;
  nextGenerateTime: number = 0;

  constructor(opts: SimClientOptions) {
    super(opts);
    this.packetRate = opts.packetRate;
    this.snakeMax = opts.snakeMax ?? 10;
    this.trafficSource = opts.trafficSource ?? null;
    this.waveStartTime = opts.waveStartTime ?? 0;
    this.waveEndTime = opts.waveEndTime ?? Number.POSITIVE_INFINITY;
    this.nextLaunchTime = this.waveStartTime;
    this.nextGenerateTime = this.waveStartTime;
  }
}
```

- [ ] **Step 2: Add `populateSnakes` to `src/sim/snake.ts`**

Append:

```ts
export function populateSnakes(clients: ReadonlyMap<ComponentId, SimClient>, simTime: number): void {
  for (const client of clients.values()) {
    if (!client.trafficSource) continue;
    while (
      client.nextGenerateTime <= simTime &&
      client.nextGenerateTime < client.waveEndTime &&
      client.snake.length < client.snakeMax
    ) {
      const pkt = client.trafficSource.generatePacketForTest(client.id, client.nextGenerateTime);
      client.snake.push(pkt);
      client.nextGenerateTime += 1 / client.packetRate;
    }
  }
}
```

(`generatePacketForTest` is the right method here too — for Stage B, the wave-paced production usage IS this method; the "for test" name was a holdover from Task 3 where pacing wasn't yet wired. We can rename to just `generatePacket` later if it bothers us.)

- [ ] **Step 3: Wire `populateSnakes` into `Sim.step` BEFORE `launchDueSnakes`**

Modify `src/sim/sim.ts`:

```ts
import { launchDueSnakes, populateSnakes } from "./snake";

// in step():
step(dt: number): void {
  this.lastStepEvents.length = 0;
  for (const c of this.components.values()) c.refillBucket(dt);
  populateSnakes(this.clients, this.simTime);
  launchDueSnakes(this.clients, this.connections, this.activePackets, this.simTime, this.rng);
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

- [ ] **Step 4: Write failing test**

Create `tests/unit/sim/snake-population-and-duration.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 1, // 1 second
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 10 },
  entryClients: ["c" as ComponentId],
};

describe("snake population + duration", () => {
  beforeEach(() => resetIdCountersForTest());

  it("populates snake from TrafficSource at packetRate cadence and stops after waveEndTime", () => {
    const sim = new Sim({ seed: 1 });
    const ts = new TrafficSource(wave, makeSimRng(1));
    const client = new SimClient({
      id: "c" as ComponentId,
      capabilities: [],
      packetRate: 5,
      trafficSource: ts,
      waveStartTime: 0,
      waveEndTime: 1, // wave.duration
    });
    const sink = new SimComponent({ id: "s" as ComponentId, capabilities: [] });
    sim.addClient(client);
    sim.addComponent(sink);
    sim.addConnection(new SimConnection({
      id: "e" as ConnectionId,
      from: { componentId: client.id, portId: "p" as PortId },
      to: { componentId: sink.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 10, twinId: "et" as ConnectionId, direction: "forward",
    }));
    // Run for 2 seconds (120 steps at 1/60). Wave runs for 1s, so:
    //   - in [0, 1s] expect ~5 packets generated (1 every 0.2s)
    //   - in [1s, 2s] no new packets generated
    let totalLaunched = 0;
    for (let i = 0; i < 120; i += 1) {
      const before = sim.activePackets.length;
      sim.step(1 / 60);
      const after = sim.activePackets.length;
      if (after > before) totalLaunched += after - before;
    }
    // We expect ~5-6 launches (5 packets at 5/sec over 1s, plus boundary timing).
    expect(totalLaunched).toBeGreaterThanOrEqual(4);
    expect(totalLaunched).toBeLessThanOrEqual(7);
  });
});
```

- [ ] **Step 5: Run — expect pass**

Run: `pnpm test tests/unit/sim/snake-population-and-duration.test.ts 2>&1 | tail -10`

Expected: 1 passing.

- [ ] **Step 6: Sim regression**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

- [ ] **Step 7: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add src/sim/snake.ts src/sim/client.ts src/sim/sim.ts tests/unit/sim/snake-population-and-duration.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): wire TrafficSource into snake with wave-bounded generation"`

---

## Task 7: Wave 1 end-to-end

**Files:**
- Test: `tests/unit/sim/wave1-end-to-end.test.ts`

The headline test: build a `Client → Server → Database` topology, run a Wave-1-like workload (10 read req/sec for ~5 seconds), and assert on cumulative outcomes:
- ≥80% of generated reads should produce `respond-delivered` events at the client.
- 0 drops if topology is correctly sized.
- Total revenue equals (responded-reads × revenuePerRead).

Wave 1 in the design spec: low-intensity reads, the Server has a Data Cache misses straight to DB, but Stage B's minimum topology can be even simpler — Client → Server (Processing reads with respond) — to validate the loop without needing forwarding/caching wired into a Wave.

For Stage B, use the simplest viable topology: Client → Server (with ProcessingCapability that responds to reads). DB is added in a later stage when the wave has writes too.

- [ ] **Step 1: Write the test**

Create `tests/unit/sim/wave1-end-to-end.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { ProcessingCapability } from "@sim/capabilities/processing";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,            // 10 req/sec
  packetRate: 5,            // 5 packets/sec, count=2
  duration: 5,              // 5 seconds → ~25 packets, ~50 reads
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 100 },
  entryClients: ["client" as ComponentId],
};

describe("Wave 1 end-to-end — Client → Server", () => {
  beforeEach(() => resetIdCountersForTest());

  it("delivers responses for the majority of generated reads with no drops", () => {
    const sim = new Sim({ seed: 7 });
    const ts = new TrafficSource(wave, makeSimRng(7));
    const client = new SimClient({
      id: "client" as ComponentId,
      capabilities: [],
      packetRate: 5,
      trafficSource: ts,
      waveStartTime: 0,
      waveEndTime: wave.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 50, // ample
    });
    const ef = new SimConnection({
      id: "ef" as ConnectionId,
      from: { componentId: client.id, portId: "out" as PortId },
      to: { componentId: server.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "eb" as ConnectionId, direction: "forward",
    });
    const eb = new SimConnection({
      id: "eb" as ConnectionId,
      from: { componentId: server.id, portId: "out" as PortId },
      to: { componentId: client.id, portId: "in" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "ef" as ConnectionId, direction: "back",
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addConnection(ef);
    sim.addConnection(eb);

    // Run for wave.duration + a 2-second drain.
    let drops = 0;
    let respondedReads = 0;
    let revenueTotal = 0;
    const totalSteps = Math.ceil((wave.duration + 2) * 60);
    for (let i = 0; i < totalSteps; i += 1) {
      sim.step(1 / 60);
      for (const ev of sim.lastStepEvents) {
        if (ev.kind === "drop") drops += ev.count;
        if (ev.kind === "respond-delivered") {
          respondedReads += 1;
          revenueTotal += ev.revenue;
        }
      }
    }

    expect(drops).toBe(0);
    expect(respondedReads).toBeGreaterThanOrEqual(20); // ~25 packets generated
    expect(revenueTotal).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect 1 passing**

Run: `pnpm test tests/unit/sim/wave1-end-to-end.test.ts 2>&1 | tail -10`

Expected: 1 passing. If it fails, diagnose: snake might not be populating (check `populateSnakes` wiring), or response retrace might not be reaching the client (check twin edge `eb` is properly linked).

- [ ] **Step 3: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add tests/unit/sim/wave1-end-to-end.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): Wave 1 end-to-end — Client→Server reads delivered"`

---

## Task 8: Wave 1 replay determinism

**Files:**
- Test: `tests/unit/sim/wave1-replay-determinism.test.ts`

Two identical Wave 1 runs with the same seed must produce byte-identical event streams. Pins the determinism guarantee at the wave level (Task 14 in Stage A pinned it at the lower-level packet replay; this is the user-visible promise).

- [ ] **Step 1: Write the test**

Create `tests/unit/sim/wave1-replay-determinism.test.ts`:

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { ProcessingCapability } from "@sim/capabilities/processing";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef, SimEvent } from "@sim/types";
import type { WaveDef as WaveDefT } from "@sim/wave";

const wave: WaveDefT = {
  intensity: 10,
  packetRate: 5,
  duration: 3,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 50 },
  entryClients: ["client" as ComponentId],
};

function buildAndRun(seed: number): SimEvent[] {
  resetIdCountersForTest();
  const sim = new Sim({ seed });
  const ts = new TrafficSource(wave, makeSimRng(seed));
  const client = new SimClient({
    id: "client" as ComponentId,
    capabilities: [],
    packetRate: wave.packetRate,
    trafficSource: ts,
    waveStartTime: 0,
    waveEndTime: wave.duration,
  });
  const server = new SimComponent({
    id: "server" as ComponentId,
    capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
    capacityPerSecond: 100,
  });
  sim.addClient(client);
  sim.addComponent(server);
  sim.addConnection(new SimConnection({
    id: "ef" as ConnectionId,
    from: { componentId: client.id, portId: "p" as PortId },
    to: { componentId: server.id, portId: "p" as PortId },
    bandwidth: 100, latencySeconds: 0.1, twinId: "eb" as ConnectionId, direction: "forward",
  }));
  sim.addConnection(new SimConnection({
    id: "eb" as ConnectionId,
    from: { componentId: server.id, portId: "p" as PortId },
    to: { componentId: client.id, portId: "p" as PortId },
    bandwidth: 100, latencySeconds: 0.1, twinId: "ef" as ConnectionId, direction: "back",
  }));
  const log: SimEvent[] = [];
  const totalSteps = Math.ceil((wave.duration + 1) * 60);
  for (let i = 0; i < totalSteps; i += 1) {
    sim.step(1 / 60);
    log.push(...sim.lastStepEvents.map((ev) => ({ ...ev })));
  }
  return log;
}

describe("Wave 1 replay determinism", () => {
  beforeEach(() => resetIdCountersForTest());

  it("two runs with the same seed produce identical event streams", () => {
    const a = buildAndRun(99);
    const b = buildAndRun(99);
    expect(b).toEqual(a);
  });
});
```

- [ ] **Step 2: Run — expect 1 passing**

Run: `pnpm test tests/unit/sim/wave1-replay-determinism.test.ts 2>&1 | tail -10`

Expected: 1 passing. If it fails, the wave/snake path has nondeterminism somewhere (Map iteration order or shared mutable state across `buildAndRun` calls).

- [ ] **Step 3: Final sim regression**

Run: `pnpm test tests/unit/sim/ 2>&1 | tail -10`

Expected: ~45 passing (32 Stage A + 13 Stage B).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck 2>&1 | tail -5`

Expected: only the pre-existing `tests/unit/pull-from-buffers.test.ts:81` error.

- [ ] **Step 5: Commit**

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add tests/unit/sim/wave1-replay-determinism.test.ts`

Run: `git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "test(sim): Wave 1 replay determinism — same seed, identical events"`

---

## Completion

Stage B yields:
- Zipf sampler + WaveDef type + TrafficSource (deterministic per-packet attribute + key rolls)
- SimClient with snake state (max 10) + per-step launch with random egress pick
- Wave-bounded generation (start/end times)
- Wave 1 end-to-end test (Client → Server reads, no drops, ≥20 responses delivered)
- Wave 1 replay-determinism test (two runs same seed → identical events)

Total ~13 new sim tests. Stage C will add the remaining capabilities (LB, CDN, Gateway, Queue, Worker, StreamingServer, DNS/GTM) and a Wave 2/3 test pair.

## Self-Review Notes

- `TrafficSource.generatePacketForTest` is the production method; the "ForTest" name is a Stage A holdover and can be renamed in a polish pass.
- Snake launch uses the sim's RNG directly for per-packet egress pick — same RNG that drives wave attribute/key rolls. This is deterministic by construction.
- `populateSnakes` runs BEFORE `launchDueSnakes` in `step` so a freshly-generated packet can be launched the same step it was generated (when cadences align).
- Wave 1 test sleeps for 2 extra simulated seconds after `wave.duration` to drain in-flight packets — this is the analog of Stage A's drain loop.

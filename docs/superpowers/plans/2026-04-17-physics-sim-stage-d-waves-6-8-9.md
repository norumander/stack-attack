# Physics Sim — Stage D Continuation (Waves 6, 8, 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship integration tests for Waves 6, 8, 9 in the physics sim. Each uses capabilities already built in Stages A–C, plus a small `TrafficSource` extension for multi-zone packet origin assignment (needed for Wave 9). Waves 7 (CircuitBreaker + chaos) and 10 (AutoScale + chaos) are scoped to a follow-up plan because they require new capabilities.

**Architecture:** Same wave-test pattern as Plan 4 (`runWave` + `evaluateSLA`). Inline dispatcher capabilities for traffic that needs to branch by attribute (like Wave 6 batch and Wave 8 stream). For Wave 9, `TrafficSource` learns to assign `request.originZone` from a per-wave `zoneDistribution` map.

**Working directory:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`

**Stage D + E + G precondition:** 59 sim unit tests + 6 wave integration tests + browser demo all green. HEAD `6e7618c`.

**Scope cuts:**
- **Waves 7 + 10** — need CircuitBreaker, AutoScale, and chaos scheduling. Defer.
- **Cross-zone connection latency** — original engine had a zone-pair latency table; for now, tests pick `latencySeconds` per connection manually. Adding a proper multi-zone latency model is its own design pass.

---

## File Structure

**Created:**

```
tests/integration/sim/waves/
  wave-6-queue-worker.test.ts
  wave-8-streaming.test.ts
  wave-9-multi-zone.test.ts
```

**Modified:**

- `src/sim/traffic-source.ts` — assign `originZone` per packet from `wave.zoneDistribution`
- `tests/unit/sim/traffic-source-zone-distribution.test.ts` (new) — pin the zone-roll behavior

---

## Task 1: TrafficSource zone distribution

**Files:**
- Modify: `src/sim/traffic-source.ts`
- Test: `tests/unit/sim/traffic-source-zone-distribution.test.ts`

`TrafficSource` currently always sets `request.originZone = null`. Add support for `wave.zoneDistribution: ReadonlyMap<Zone, number>` (already on the `WaveDef` type). On each packet, roll the zone from the distribution and apply to all requests in the packet (uniform per packet, like other attributes).

### Step 1: Write failing test

Create `tests/unit/sim/traffic-source-zone-distribution.test.ts`:

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
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 1, perAuth: 1, perStream: 1 },
  zoneDistribution: new Map<string, number>([["NA", 0.5], ["EU", 0.3], ["AP", 0.2]]),
  entryClients: ["c1" as ComponentId],
};

describe("TrafficSource — zone distribution", () => {
  beforeEach(() => resetIdCountersForTest());

  it("rolls originZone from the wave's zoneDistribution per packet", () => {
    const ts = new TrafficSource(wave, makeSimRng(11));
    const counts = new Map<string, number>();
    for (let i = 0; i < 5_000; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      const zone = pkt.requests[0]!.originZone ?? "null";
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }
    expect(counts.get("NA")! / 5000).toBeGreaterThan(0.42);
    expect(counts.get("NA")! / 5000).toBeLessThan(0.58);
    expect(counts.get("EU")! / 5000).toBeGreaterThan(0.22);
    expect(counts.get("EU")! / 5000).toBeLessThan(0.38);
    expect(counts.get("AP")! / 5000).toBeGreaterThan(0.13);
    expect(counts.get("AP")! / 5000).toBeLessThan(0.27);
    expect(counts.get("null") ?? 0).toBe(0);
  });

  it("all requests in a packet share the same originZone", () => {
    const ts = new TrafficSource({ ...wave, intensity: 50, packetRate: 5 }, makeSimRng(13));
    for (let i = 0; i < 200; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      const zones = new Set(pkt.requests.map((r) => r.originZone));
      expect(zones.size).toBe(1);
    }
  });

  it("falls back to null originZone when zoneDistribution is absent", () => {
    const noZoneWave: WaveDef = { ...wave, zoneDistribution: undefined };
    const ts = new TrafficSource(noZoneWave, makeSimRng(17));
    const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
    expect(pkt.requests[0]!.originZone).toBeNull();
  });
});
```

### Step 2: Run — expect fail

```bash
pnpm test tests/unit/sim/traffic-source-zone-distribution.test.ts 2>&1 | tail -10
```

Expected: zone counts all 0 (originZone always null).

### Step 3: Implement zone roll in `src/sim/traffic-source.ts`

Read the file first. In `generatePacketForTest`, after the existing attribute rolls and before constructing requests:

```ts
const zone = this.rollZone();
```

Add a helper at the bottom of the class:

```ts
private rollZone(): string | null {
  const dist = this.wave.zoneDistribution;
  if (!dist || dist.size === 0) return null;
  const u = this.rng();
  let acc = 0;
  for (const [zone, weight] of dist) {
    acc += weight;
    if (u < acc) return zone;
  }
  // Floating-point safety: if u rounds slightly past 1, return last zone.
  return [...dist.keys()].at(-1) ?? null;
}
```

In the request literal construction, replace `originZone: null` with `originZone: zone`.

### Step 4: Run — expect pass

```bash
pnpm test tests/unit/sim/traffic-source-zone-distribution.test.ts 2>&1 | tail -10
# expect 3 passing
pnpm test tests/unit/sim/ 2>&1 | tail -5
# expect 60 passing (59 + 3 new but the existing tests use a wave without zoneDistribution so no regressions)
```

### Step 5: Commit

```bash
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim add -A
git -C /Users/normanettedgui/development/capstone/.worktrees/physics-sim commit -m "feat(sim): TrafficSource — zoneDistribution rolls originZone per packet"
```

---

## Task 2: Wave 6 — Queue + Worker for batch traffic

**Files:**
- Create: `tests/integration/sim/waves/wave-6-queue-worker.test.ts`

Wave 6: 100 req/sec mixed (60% reads, 20% writes, 20% async/batch). Reads go through `Server → Cache → DB` like Wave 3. Writes terminate at DB. Batch traffic gets held by Queue and pulled by Worker.

Topology: `Client → Server → Cache → DB`, with a `Queue → Worker` pair branched off Server for batch. Server uses an inline dispatcher capability that:
- batch → forward to Queue
- writes → forward to DB (not via cache)
- reads → forward to Cache

Server has 3 forward egresses (cache, db, queue). The dispatcher picks based on attributes.

### Test (verbatim)

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { CachingCapability } from "@sim/capabilities/caching";
import { QueueCapability } from "@sim/capabilities/queue";
import { WorkerCapability } from "@sim/capabilities/worker";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

/**
 * Three-way dispatcher: batch → queue, write → db, else → cache. Egresses
 * must be configured in that exact order on the component.
 */
class ServerTrioDispatcher implements SimCapability {
  readonly id = "server-trio";
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const first = packet.requests[0];
    if (!first) return { kind: "drop", reason: "empty_packet", count: 0 };
    let idx = 2; // default cache
    if (first.isAsync) idx = 0;
    else if (first.isWrite) idx = 1;
    const egress = ctx.egressEdges[idx];
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

const WAVE_6: WaveDef = {
  intensity: 100,
  packetRate: 10,
  duration: 5,
  composition: { writeRatio: 0.2, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0.2 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 };

describe("Wave 6 — Queue + Worker batch handling", () => {
  beforeEach(() => resetIdCountersForTest());

  it("dispatches batch to Queue/Worker, writes to DB, reads through Cache", () => {
    const sim = new Sim({ seed: 31 });
    const ts = new TrafficSource(WAVE_6, makeSimRng(31));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_6.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_6.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new ServerTrioDispatcher()],
    });
    const queue = new QueueCapability({ capacity: 100 });
    const queueComp = new SimComponent({ id: "queue" as ComponentId, capabilities: [queue] });
    const worker = new WorkerCapability({ pullRate: 30, revenuePerItem: 1 }, queue);
    const workerComp = new SimComponent({ id: "worker" as ComponentId, capabilities: [worker] });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_6.revenue.perRead })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: WAVE_6.revenue.perWrite, revenuePerRead: WAVE_6.revenue.perRead })],
      capacityPerSecond: 60,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addComponent(queueComp);
    sim.addComponent(workerComp);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 500, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    // Client ↔ Server
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    // Server egresses MUST be in order [queue, db, cache] to match dispatcher indices
    sim.addConnection(mk("sq", server.id, queueComp.id, "forward", "qs"));
    sim.addConnection(mk("qs", queueComp.id, server.id, "back", "sq"));
    sim.addConnection(mk("sd", server.id, db.id, "forward", "ds"));
    sim.addConnection(mk("ds", db.id, server.id, "back", "sd"));
    sim.addConnection(mk("sk", server.id, cache.id, "forward", "ks"));
    sim.addConnection(mk("ks", cache.id, server.id, "back", "sk"));
    // Cache ↔ DB
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_6.duration, drainSeconds: 4 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    // batch + writes terminate; reads respond
    expect(metrics.terminated).toBeGreaterThan(0);
    expect(metrics.responded).toBeGreaterThan(0);
  });
});
```

Note on dispatcher index ordering: the test relies on Sim iterating connections in insertion order. Verify by reading `dispatchArrival` in `src/sim/sim.ts` — it iterates `this.connections.values()` (Map iteration is insertion order in JS, so this works as long as the test inserts egresses in the right order).

### Steps

1. Create test.
2. `pnpm test tests/integration/sim/waves/wave-6-queue-worker.test.ts 2>&1 | tail -15`
3. If SLA fails, report metrics and STOP — don't tune SLA. Likely tuning points: increase `worker.pullRate`, increase `db.capacityPerSecond`, lower `WAVE_6.intensity`.
4. Commit: `test(sim): Wave 6 — Queue+Worker handles batch alongside Cache+DB read path`

---

## Task 3: Wave 8 — Streaming traffic

**Files:**
- Create: `tests/integration/sim/waves/wave-8-streaming.test.ts`

Wave 8: 80 req/sec with 30% stream traffic. Streams need bandwidth reservation; non-streams go through normal Cache → DB.

Topology: `Client → Server → [Cache → DB]` for reads/writes, plus a `Server → StreamingServer` branch for streams. Server uses a dispatcher: stream → StreamingServer (egress 0), else → Cache (egress 1).

### Test (verbatim)

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { CachingCapability } from "@sim/capabilities/caching";
import { StreamingCapability } from "@sim/capabilities/streaming";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

class StreamSplitDispatcher implements SimCapability {
  readonly id = "stream-split";
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const isStream = packet.requests[0]?.stream !== undefined;
    const idx = isStream ? 0 : 1;
    const egress = ctx.egressEdges[idx];
    if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    const child: Packet = {
      id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
      spawnedAt: packet.spawnedAt, parentId: packet.id, direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }
}

const WAVE_8: WaveDef = {
  intensity: 80,
  packetRate: 8,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0.3, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 5 },
  streamConfig: { duration: 1.5, bandwidth: 50 },
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 };

describe("Wave 8 — streaming bandwidth reservation", () => {
  beforeEach(() => resetIdCountersForTest());

  it("streams reserve bandwidth on dedicated server, others go through cache", () => {
    const sim = new Sim({ seed: 42 });
    const ts = new TrafficSource(WAVE_8, makeSimRng(42));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_8.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_8.duration,
    });
    const server = new SimComponent({
      id: "server" as ComponentId,
      capabilities: [new StreamSplitDispatcher()],
    });
    const ss = new SimComponent({
      id: "stream-server" as ComponentId,
      capabilities: [new StreamingCapability({ revenuePerStream: WAVE_8.revenue.perStream })],
    });
    const cache = new SimComponent({
      id: "cache" as ComponentId,
      capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_8.revenue.perRead })],
    });
    const db = new SimComponent({
      id: "db" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: WAVE_8.revenue.perRead })],
      capacityPerSecond: 60,
    });
    sim.addClient(client);
    sim.addComponent(server);
    sim.addComponent(ss);
    sim.addComponent(cache);
    sim.addComponent(db);
    const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string, bandwidth = 500) =>
      new SimConnection({
        id: id as ConnectionId,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth, latencySeconds: 0.05, twinId: twin as ConnectionId, direction: dir,
      });
    // Client ↔ Server
    sim.addConnection(mk("cs", client.id, server.id, "forward", "sc"));
    sim.addConnection(mk("sc", server.id, client.id, "back", "cs"));
    // Server egresses MUST be ordered [streamServer, cache] to match dispatcher
    // The streaming-server ingress needs ample bandwidth for stream reservations
    // (peak: 24 streams/sec × 1.5s × 50 bw = 1800 bw).
    sim.addConnection(mk("sst", server.id, ss.id, "forward", "sts", 5000));
    sim.addConnection(mk("sts", ss.id, server.id, "back", "sst"));
    sim.addConnection(mk("sk", server.id, cache.id, "forward", "ks"));
    sim.addConnection(mk("ks", cache.id, server.id, "back", "sk"));
    // Cache ↔ DB
    sim.addConnection(mk("kd", cache.id, db.id, "forward", "dk"));
    sim.addConnection(mk("dk", db.id, cache.id, "back", "kd"));
    const metrics = runWave(sim, { durationSeconds: WAVE_8.duration, drainSeconds: 4 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.terminated).toBeGreaterThan(0); // streams terminate at SS
    expect(metrics.responded).toBeGreaterThan(0);  // reads respond
  });
});
```

### Steps

1. Create test.
2. `pnpm test tests/integration/sim/waves/wave-8-streaming.test.ts 2>&1 | tail -15`
3. If SLA fails: likely the stream-server ingress bandwidth (5000 in the test) is insufficient for peak reservation — bump it. Or stream count is too high — lower `streamRatio` or `streamConfig.bandwidth`.
4. Commit: `test(sim): Wave 8 — StreamingServer bandwidth reservation isolated from read path`

---

## Task 4: Wave 9 — multi-zone GeoRouting

**Files:**
- Create: `tests/integration/sim/waves/wave-9-multi-zone.test.ts`

Wave 9: 60 req/sec across 3 zones (NA 50%, EU 30%, AP 20%). DNS/GTM routes each request by `originZone` to a zone-specific Server. Each zone has its own `Server → Cache → DB` stack.

Topology: `Client → DNS → [NA-Server, EU-Server, AP-Server] → ... → DB` per zone.

For simplicity, each zone has its own Cache and DB (no cross-zone replication). The Servers in different zones have `zone` set, and DNS uses `GeoRoutingCapability` to route by matching `originZone` to target component zone.

### Test (verbatim)

```ts
import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { GeoRoutingCapability } from "@sim/capabilities/geo-routing";
import { resetIdCountersForTest } from "@sim/packet";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import { evaluateSLA } from "@sim/sla";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const WAVE_9: WaveDef = {
  intensity: 60,
  packetRate: 6,
  duration: 5,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
  zoneDistribution: new Map<string, number>([["NA", 0.5], ["EU", 0.3], ["AP", 0.2]]),
  entryClients: ["client" as ComponentId],
};

const SLA = { availability: 0.9, maxAvgLatencySeconds: 1, maxDropRate: 0.1 };

describe("Wave 9 — multi-zone GeoRouting", () => {
  beforeEach(() => resetIdCountersForTest());

  it("DNS routes packets to their origin-zone stack; each zone serves locally", () => {
    const sim = new Sim({ seed: 53 });
    const ts = new TrafficSource(WAVE_9, makeSimRng(53));
    const client = new SimClient({
      id: "client" as ComponentId, capabilities: [],
      packetRate: WAVE_9.packetRate,
      trafficSource: ts, waveStartTime: 0, waveEndTime: WAVE_9.duration,
    });
    const dns = new SimComponent({
      id: "dns" as ComponentId,
      capabilities: [new GeoRoutingCapability()],
    });
    sim.addClient(client);
    sim.addComponent(dns);
    sim.addConnection(new SimConnection({
      id: "cd" as ConnectionId,
      from: { componentId: client.id, portId: "p" as PortId },
      to: { componentId: dns.id, portId: "p" as PortId },
      bandwidth: 500, latencySeconds: 0.05, twinId: "dc" as ConnectionId, direction: "forward",
    }));
    sim.addConnection(new SimConnection({
      id: "dc" as ConnectionId,
      from: { componentId: dns.id, portId: "p" as PortId },
      to: { componentId: client.id, portId: "p" as PortId },
      bandwidth: 500, latencySeconds: 0.05, twinId: "cd" as ConnectionId, direction: "back",
    }));
    const zones = ["NA", "EU", "AP"] as const;
    for (const zone of zones) {
      const server = new SimComponent({
        id: `server-${zone}` as ComponentId,
        capabilities: [new ForwardingCapability()],
        zone,
      });
      const cache = new SimComponent({
        id: `cache-${zone}` as ComponentId,
        capabilities: [new CachingCapability({ capacity: 32, revenuePerRead: WAVE_9.revenue.perRead })],
        zone,
      });
      const db = new SimComponent({
        id: `db-${zone}` as ComponentId,
        capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: WAVE_9.revenue.perRead })],
        capacityPerSecond: 30,
        zone,
      });
      sim.addComponent(server);
      sim.addComponent(cache);
      sim.addComponent(db);
      const mk = (id: string, from: ComponentId, to: ComponentId, dir: "forward" | "back", twin: string, latency = 0.05) =>
        new SimConnection({
          id: id as ConnectionId,
          from: { componentId: from, portId: "p" as PortId },
          to: { componentId: to, portId: "p" as PortId },
          bandwidth: 500, latencySeconds: latency, twinId: twin as ConnectionId, direction: dir,
        });
      // DNS ↔ zone server (cross-zone latency = 0.2s; longer than intra-zone)
      sim.addConnection(mk(`d-${zone}`, dns.id, server.id, "forward", `${zone}-d`, 0.2));
      sim.addConnection(mk(`${zone}-d`, server.id, dns.id, "back", `d-${zone}`, 0.2));
      // server ↔ cache
      sim.addConnection(mk(`${zone}-sk`, server.id, cache.id, "forward", `${zone}-ks`));
      sim.addConnection(mk(`${zone}-ks`, cache.id, server.id, "back", `${zone}-sk`));
      // cache ↔ db
      sim.addConnection(mk(`${zone}-kd`, cache.id, db.id, "forward", `${zone}-dk`));
      sim.addConnection(mk(`${zone}-dk`, db.id, cache.id, "back", `${zone}-kd`));
    }
    const metrics = runWave(sim, { durationSeconds: WAVE_9.duration, drainSeconds: 3 });
    const sla = evaluateSLA(metrics, SLA);
    expect(sla.passed).toBe(true);
    expect(metrics.responded).toBeGreaterThan(0);
  });
});
```

### Steps

1. Create test.
2. `pnpm test tests/integration/sim/waves/wave-9-multi-zone.test.ts 2>&1 | tail -15`
3. If SLA fails: most likely culprit is GeoRouting failing to find a zone match (drops as `no_zone_match`). Check that DNS's egress targets all have zone set correctly. Or DB capacity per zone too low — bump capacity.
4. Commit: `test(sim): Wave 9 — multi-zone DNS routes to per-zone stacks`

---

## Task 5: Final regression + commit obsolete plans

### Step 1: Full sim regression

```bash
pnpm test tests/unit/sim/ tests/unit/dashboard/ tests/integration/sim/ 2>&1 | tail -10
```

Expected:
- Sim unit: 60 passing (was 59 + 3 zone-distribution tests)
- Dashboard unit: 59 passing
- Integration: 9 passing (was 6 + 3 new waves)

### Step 2: Typecheck

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: only the documented pre-existing pull-from-buffers noise.

### Step 3: No commit (verification only)

---

## Completion

Plan 4b yields:
- TrafficSource zoneDistribution rolls
- Wave 6, 8, 9 integration tests
- 3 new sim unit tests + 3 new wave integration tests

Waves 7 + 10 still deferred. They need:
- CircuitBreakerCapability + chaos scheduling (Wave 7)
- AutoScaleCapability + chaos scheduling (Wave 10)

That can be a focused Plan 4c later.

## Self-review notes

- All three wave tests use **inline dispatcher capabilities** because `dispatchArrival` only invokes `capabilities[0]`. Composing multiple capabilities into a single component requires either (a) a custom dispatcher, or (b) a future engine extension that walks all capabilities by phase. (b) is likely needed when Wave 7 lands so chaos events can be observed without blocking the main outcome — design point for Plan 4c.
- Egress index ordering matters for the dispatchers — it depends on Map insertion order which is JS-spec stable but fragile. If Plan 4c needs richer routing, consider attaching named ports to egresses and have dispatchers look up by name.
- Wave 9's "cross-zone" latency is hand-set per connection (`0.2s` from DNS to zone Server) rather than via a global zone-pair latency model. The richer model can come back when Wave 10 chaos work makes it meaningful.
- StreamingCapability requires the full stream bandwidth to be available on the ingress edge for the entire stream duration. Wave 8's test uses a 5000-bandwidth edge to absorb peak reservation; if the stream count or duration changes, this needs re-tuning.

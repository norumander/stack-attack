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
    isAsync: false,
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
    const p = sim.activePackets[0]!;
    expect(p.edgeId).toBe(bc.id);
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

function mkLargeRead(key: string): Request {
  return { ...mkRead(key), isLarge: true };
}

describe("CachingCapability — largeOnly filter", () => {
  beforeEach(() => resetIdCountersForTest());

  it("partitions large reads (hits respond, misses forward) and lumps non-large reads into the forward as if uncached", () => {
    const cache = new CachingCapability({ capacity: 8, revenuePerRead: 1, largeOnly: true });
    cache.__preloadForTest(["k_large_hit"]);
    const b = new SimComponent({ id: "b" as ComponentId, capabilities: [cache] });
    const c = new SimComponent({
      id: "c" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 0, revenuePerRead: 1 })],
      capacityPerSecond: 100,
    });
    const { sim, ab, bc } = threeHopTopology(b, c);
    sim.spawnPacket(makePacket({
      requests: [mkLargeRead("k_large_hit"), mkLargeRead("k_large_miss"), mkRead("k_small")],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60);
    // After cache dispatch: one forward on bc (the large miss + the small read,
    // both bypass the cache slot under largeOnly), and one back-leg packet (the
    // large hit responding).
    const forward = sim.activePackets.find((p) => p.edgeId === bc.id);
    const respond = sim.activePackets.find((p) => p.direction === "back");
    expect(forward).toBeDefined();
    expect(respond).toBeDefined();
    expect(forward!.requests.map((r) => r.key).sort()).toEqual(["k_large_miss", "k_small"]);
    expect(respond!.requests).toHaveLength(1);
    expect(respond!.requests[0]!.key).toBe("k_large_hit");
  });

  it("does not populate slots from non-large response-leg requests", () => {
    const cache = new CachingCapability({ capacity: 8, revenuePerRead: 1, largeOnly: true });
    // Synthesize a back-leg packet carrying a small (non-large) read and feed
    // it through onArriveResponse directly — ctx is unused for populate.
    const responsePacket = makePacket({
      requests: [mkRead("k_small_resp")],
      edgeId: "x" as ConnectionId, speed: 0, spawnedAt: 0, direction: "back",
    });
    cache.onArriveResponse?.(responsePacket, {} as never);
    expect(cache.hasKey("k_small_resp")).toBe(false);
  });
});

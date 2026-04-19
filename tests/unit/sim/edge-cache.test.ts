import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { makePacket, resetIdCountersForTest, mintRequestId } from "@sim/packet";
import { CachingCapability } from "@sim/capabilities/caching";
import { ProcessingCapability } from "@sim/capabilities/processing";
import type { Request } from "@sim/types";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

/**
 * Edge Cache is configured via CachingCapability with
 * `cacheableTypes: ["api_read"]`. It participates only in api_read lookups:
 *  - hits respond terminally from the edge,
 *  - misses forward downstream and populate on the return leg,
 *  - writes / auth / large / stream / async pass through unchanged.
 */

function mkRead(key: string, overrides: Partial<Request> = {}): Request {
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
    ...overrides,
  };
}

function threeHop(b: SimComponent, c: SimComponent) {
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

function mkEdgeCache(capacity = 8): { cache: CachingCapability; comp: SimComponent } {
  const cache = new CachingCapability({
    capacity,
    revenuePerRead: 3,
    cacheableTypes: ["api_read"],
  });
  const comp = new SimComponent({ id: "b" as ComponentId, capabilities: [cache] });
  return { cache, comp };
}

function mkDB(): SimComponent {
  return new SimComponent({
    id: "c" as ComponentId,
    capabilities: [new ProcessingCapability({ revenuePerWrite: 1, revenuePerRead: 1 })],
    capacityPerSecond: 100,
  });
}

describe("Edge Cache — api_read handling", () => {
  beforeEach(() => resetIdCountersForTest());

  it("api_read hits respond terminally at the edge", () => {
    const { cache, comp } = mkEdgeCache();
    cache.__preloadForTest(["k_hit"]);
    const { sim, ab, a } = threeHop(comp, mkDB());
    sim.spawnPacket(makePacket({
      requests: [mkRead("k_hit")],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60); // hit → respond packet on ba
    const respond = sim.activePackets.find((p) => p.direction === "back");
    expect(respond).toBeDefined();
    sim.step(1 / 60); // respond arrives at a
    const delivered = sim.lastStepEvents.filter((e) => e.kind === "respond-delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ componentId: a.id, revenue: 3 });
  });

  it("api_read misses forward to downstream, populate on response", () => {
    const { cache, comp } = mkEdgeCache();
    const { sim, ab, bc } = threeHop(comp, mkDB());
    sim.spawnPacket(makePacket({
      requests: [mkRead("k_miss")],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60); // miss → forward on bc
    const fwd = sim.activePackets.find((p) => p.edgeId === bc.id);
    expect(fwd).toBeDefined();
    expect(fwd!.requests.map((r) => r.key)).toEqual(["k_miss"]);
    // Run enough steps for the round-trip: request to DB, response back through cache to client.
    for (let i = 0; i < 6; i++) sim.step(1 / 60);
    expect(cache.hasKey("k_miss")).toBe(true);
  });

  it("api_write bypasses cache — forwards unchanged (no slot churn)", () => {
    const { cache, comp } = mkEdgeCache();
    const { sim, ab, bc } = threeHop(comp, mkDB());
    const write = mkRead("k_w", { isWrite: true });
    sim.spawnPacket(makePacket({
      requests: [write],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60);
    const fwd = sim.activePackets.find((p) => p.edgeId === bc.id);
    expect(fwd).toBeDefined();
    expect(cache.hasKey("k_w")).toBe(false);
  });

  it("auth_required / large_payload / async bypass cache — forward, do not populate", () => {
    const { cache, comp } = mkEdgeCache();
    const { sim, ab, bc } = threeHop(comp, mkDB());
    sim.spawnPacket(makePacket({
      requests: [
        mkRead("k_auth", { requiresAuth: true }),
        mkRead("k_large", { isLarge: true }),
        mkRead("k_async", { isAsync: true }),
      ],
      edgeId: ab.id, speed: ab.speed, spawnedAt: 0, direction: "forward",
    }));
    sim.step(1 / 60);
    const fwd = sim.activePackets.find((p) => p.edgeId === bc.id);
    expect(fwd).toBeDefined();
    expect(fwd!.requests.map((r) => r.key).sort()).toEqual(["k_async", "k_auth", "k_large"]);
    // Response-leg populate also skips these non-api_read types.
    for (let i = 0; i < 8; i++) sim.step(1 / 60);
    expect(cache.hasKey("k_auth")).toBe(false);
    expect(cache.hasKey("k_large")).toBe(false);
    expect(cache.hasKey("k_async")).toBe(false);
  });

  it("capacity saturation evicts LRU entries", () => {
    const cache = new CachingCapability({
      capacity: 3,
      revenuePerRead: 1,
      cacheableTypes: ["api_read"],
    });
    cache.__preloadForTest(["k1", "k2", "k3"]);
    cache.__populateForTest("k4"); // k1 (oldest) evicted
    expect(cache.hasKey("k1")).toBe(false);
    expect(cache.hasKey("k2")).toBe(true);
    expect(cache.hasKey("k3")).toBe(true);
    expect(cache.hasKey("k4")).toBe(true);
    // Touch k2, add k5 → k3 evicted.
    cache.__touchForTest("k2");
    cache.__populateForTest("k5");
    expect(cache.hasKey("k3")).toBe(false);
    expect(cache.hasKey("k2")).toBe(true);
    expect(cache.hasKey("k5")).toBe(true);
  });
});

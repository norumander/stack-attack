import { describe, it, expect } from "vitest";
import { CachingCapability } from "@capabilities/caching/caching-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(type: string, id: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-a" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function reqWithPayload(type: string, id: string, payload: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type,
    payload,
    origin: "c-a" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function ctx(tier = 1): ProcessContext {
  return {
    state: { currentTick: 0 } as any,
    componentId: "c-a" as ComponentId,
    effectiveTier: tier,
    effectiveTiers: new Map([["caching" as CapabilityId, tier]]),
    activeCapabilityIds: new Set(),
    currentTick: 0,
    rng: createRng("t"),
    directories: [],
    childResponses: new Map(),
  };
}

describe("CachingCapability per-type stats", () => {
  it("tracks api_read hits and misses separately from static_asset", () => {
    const cap = new CachingCapability("caching" as CapabilityId);

    // 3 unique api_read requests → 3 misses (slot pool is 10; 3 don't collide)
    cap.process(req("api_read", "r-1"), ctx());
    cap.process(req("api_read", "r-2"), ctx());
    cap.process(req("api_read", "r-3"), ctx());
    // Repeat r-1 → expected hit (same id → same slot)
    cap.process(req("api_read", "r-1"), ctx());

    // 2 unique static_asset requests → 2 misses
    cap.process(req("static_asset", "s-1"), ctx());
    cap.process(req("static_asset", "s-2"), ctx());
    // Repeat s-1 → expected hit
    cap.process(req("static_asset", "s-1"), ctx());

    const stats = cap.getStats();
    expect(stats.hitRateByType).toBeDefined();
    const byType = stats.hitRateByType!;
    expect(byType.api_read).toEqual({ hits: 1, misses: 3, hitRate: 0.25 });
    expect(byType.static_asset).toEqual({ hits: 1, misses: 2, hitRate: 1 / 3 });
  });

  it("preserves aggregate hitRate", () => {
    const cap = new CachingCapability("caching" as CapabilityId);
    cap.process(req("api_read", "r-1"), ctx());
    cap.process(req("api_read", "r-1"), ctx());
    const stats = cap.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  it("returns empty hitRateByType when no requests processed", () => {
    const cap = new CachingCapability("caching" as CapabilityId);
    const stats = cap.getStats();
    expect(stats.hitRateByType).toEqual({});
  });

  it("uses request.payload as the cache key when payload is present", () => {
    const cap = new CachingCapability("caching" as CapabilityId);

    // Two different ids but same payload → second should hit.
    const r1 = reqWithPayload("api_read", "r-1", "hot-key");
    const r2 = reqWithPayload("api_read", "r-2", "hot-key");
    cap.process(r1, ctx());
    const result = cap.process(r2, ctx());
    expect(result.outcome.kind).toBe("RESPOND"); // hit on the shared payload

    // Different payload → miss.
    const r3 = reqWithPayload("api_read", "r-3", "cold-key");
    const result3 = cap.process(r3, ctx());
    expect(result3.outcome.kind).toBe("PASS"); // miss on new payload
  });
});

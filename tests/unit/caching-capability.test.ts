import { describe, it, expect } from "vitest";
import { CachingCapability } from "@capabilities/caching/caching-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

let reqCounter = 0;
function req(type = "api_read"): Request {
  reqCounter++;
  return { id: `r-${reqCounter}` as RequestId, parentId: null, type, payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

function ctx(tier = 1, tick = 0): ProcessContext {
  return { state: { currentTick: tick } as any, componentId: "c-a" as ComponentId, effectiveTier: tier, effectiveTiers: new Map([["cache" as CapabilityId, tier]]), activeCapabilityIds: new Set(), currentTick: tick, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("CachingCapability", () => {
  beforeEach(() => { reqCounter = 0; });

  it("has INTERCEPT phase", () => {
    expect(new CachingCapability("cache" as CapabilityId).phase).toBe("INTERCEPT");
  });

  it("canHandle returns true for cacheable types", () => {
    const cap = new CachingCapability("cache" as CapabilityId);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("static_asset")).toBe(true);
  });

  it("canHandle returns false for non-cacheable types", () => {
    const cap = new CachingCapability("cache" as CapabilityId);
    expect(cap.canHandle("api_write")).toBe(false);
    expect(cap.canHandle("batch")).toBe(false);
    expect(cap.canHandle("stream")).toBe(false);
  });

  it("first request is a cache miss (PASS)", () => {
    const cap = new CachingCapability("cache" as CapabilityId);
    const result = cap.process(req("api_read"), ctx());
    expect(result.outcome.kind).toBe("PASS");
    expect(result.events[0]!.type).toBe("CACHED_MISS");
  });

  it("repeated identical cache key produces a hit (RESPOND)", () => {
    const cap = new CachingCapability("cache" as CapabilityId);
    // Generate enough requests that one will hash to the same slot as a previous one
    // With base keys = 10 for api_read, after 10+ requests we should see collisions
    const results: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = req("api_read");
      const result = cap.process(r, ctx(1, 0));
      results.push(result.outcome.kind);
    }
    // At least one should be a RESPOND (cache hit)
    expect(results.filter(k => k === "RESPOND").length).toBeGreaterThan(0);
  });

  it("cache miss and hit events are emitted", () => {
    const cap = new CachingCapability("cache" as CapabilityId);
    const r1 = cap.process(req("api_read"), ctx());
    expect(r1.events[0]!.type).toBe("CACHED_MISS");

    // Generate many requests to get a hit
    let hitFound = false;
    for (let i = 0; i < 20; i++) {
      const result = cap.process(req("api_read"), ctx(1, 0));
      if (result.events[0]?.type === "CACHED_HIT") {
        hitFound = true;
        break;
      }
    }
    expect(hitFound).toBe(true);
  });

  it("stats track hits and misses", () => {
    const cap = new CachingCapability("cache" as CapabilityId);
    for (let i = 0; i < 30; i++) {
      cap.process(req("api_read"), ctx(1, 0));
    }
    const stats = cap.getStats();
    expect((stats.hits ?? 0) + (stats.misses ?? 0)).toBe(30);
    expect(stats.hits).toBeGreaterThan(0);
  });

  it("different request types produce different cache entries", () => {
    const cap = new CachingCapability("cache" as CapabilityId);
    // A static_asset and api_read with same counter value should be different entries
    const r1: Request = { id: "r-same" as RequestId, parentId: null, type: "api_read", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
    const r2: Request = { id: "r-same" as RequestId, parentId: null, type: "static_asset", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };

    cap.process(r1, ctx()); // miss for api_read:slot
    const result = cap.process(r2, ctx()); // should also be miss (different type scope)
    expect(result.outcome.kind).toBe("PASS"); // miss, not hit
  });

  it("getUpkeepCost scales with tier", () => {
    const cap = new CachingCapability("cache" as CapabilityId);
    expect(cap.getUpkeepCost(1)).toBe(3);
    expect(cap.getUpkeepCost(3)).toBe(9);
  });
});

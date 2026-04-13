import { describe, it, expect } from "vitest";
import { RateLimitCapability } from "@capabilities/rate-limit/rate-limit-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(): Request {
  return { id: "r-1" as RequestId, parentId: null, type: "api_read", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

function ctx(tier = 1): ProcessContext {
  return { state: { currentTick: 0 } as any, componentId: "c-a" as ComponentId, effectiveTier: tier, effectiveTiers: new Map([["rl" as CapabilityId, tier]]), activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("RateLimitCapability", () => {
  it("has INTERCEPT phase", () => {
    expect(new RateLimitCapability("rl" as CapabilityId).phase).toBe("INTERCEPT");
  });

  it("passes requests within token limit", () => {
    const cap = new RateLimitCapability("rl" as CapabilityId);
    const c = ctx(1); // tier 1 = 20 tokens
    for (let i = 0; i < 20; i++) {
      expect(cap.process(req(), c).outcome.kind).toBe("PASS");
    }
  });

  it("drops requests beyond token limit", () => {
    const cap = new RateLimitCapability("rl" as CapabilityId);
    const c = ctx(1);
    for (let i = 0; i < 20; i++) cap.process(req(), c); // exhaust tokens
    const result = cap.process(req(), c);
    expect(result.outcome.kind).toBe("DROP");
    if (result.outcome.kind === "DROP") expect(result.outcome.reason).toBe("rate_limited");
  });

  it("refills tokens on resetPerTickState", () => {
    const cap = new RateLimitCapability("rl" as CapabilityId);
    const c = ctx(1);
    for (let i = 0; i < 20; i++) cap.process(req(), c);
    cap.resetPerTickState();
    expect(cap.process(req(), c).outcome.kind).toBe("PASS");
  });

  it("tier 2 has 40 tokens", () => {
    const cap = new RateLimitCapability("rl" as CapabilityId);
    const c = ctx(2);
    let passed = 0;
    for (let i = 0; i < 50; i++) {
      if (cap.process(req(), c).outcome.kind === "PASS") passed++;
    }
    expect(passed).toBe(40);
  });

  it("tracks totalDropped in stats", () => {
    const cap = new RateLimitCapability("rl" as CapabilityId);
    const c = ctx(1);
    for (let i = 0; i < 25; i++) cap.process(req(), c);
    expect(cap.getStats().totalDropped).toBe(5);
  });
});

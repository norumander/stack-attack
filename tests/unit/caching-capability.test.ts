import { describe, it, expect } from "vitest";
import { CachingCapability } from "@capabilities/caching/caching-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "caching" as CapabilityId;

function req(type: string, payload: string, id = "r-1"): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type,
    payload,
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

// Minimal stub — capabilities mostly ignore context. `as unknown as` cast
// is required because the real ProcessContext has 9 fields including a
// DeterministicRng object (not a function) and a SimulationStateReader.
// We provide only the fields the capability actually reads.
const ctx = {
  currentTick: 0,
  componentId: "c-1" as ComponentId,
  effectiveTier: 1,
  activeCapabilityIds: new Set([CAP_ID]),
} as unknown as ProcessContext;

describe("CachingCapability", () => {
  it("passes non-read requests through", () => {
    const cap = new CachingCapability(CAP_ID);
    const result = cap.process(req("api_write", "w-1"), ctx);
    expect(result.outcome.kind).toBe("PASS");
  });

  it("first read on a key returns PASS (miss)", () => {
    const cap = new CachingCapability(CAP_ID);
    const result = cap.process(req("api_read", "key-1"), ctx);
    expect(result.outcome.kind).toBe("PASS");
  });

  it("second read on the same key returns RESPOND (hit)", () => {
    const cap = new CachingCapability(CAP_ID);
    cap.process(req("api_read", "key-1", "r-1"), ctx);
    const result = cap.process(req("api_read", "key-1", "r-2"), ctx);
    expect(result.outcome.kind).toBe("RESPOND");
    const hitEvent = result.events.find((e) => e.type === "CACHED_HIT");
    expect(hitEvent).toBeDefined();
  });

  it("different keys don't collide", () => {
    const cap = new CachingCapability(CAP_ID);
    cap.process(req("api_read", "key-1"), ctx);
    const result = cap.process(req("api_read", "key-2"), ctx);
    expect(result.outcome.kind).toBe("PASS"); // key-2 is a miss
  });

  it("FIFO evicts when full (capacity=10 at T1)", () => {
    const cap = new CachingCapability(CAP_ID);
    // Fill cache: key-0 through key-9
    for (let i = 0; i < 10; i++) {
      cap.process(req("api_read", `key-${i}`), ctx);
    }
    // Insert key-10 — should evict key-0
    cap.process(req("api_read", "key-10"), ctx);

    // key-0 should now be a miss
    const result0 = cap.process(req("api_read", "key-0"), ctx);
    expect(result0.outcome.kind).toBe("PASS");
    // key-9 should still hit
    const result9 = cap.process(req("api_read", "key-9"), ctx);
    expect(result9.outcome.kind).toBe("RESPOND");
  });

  it("phase is INTERCEPT", () => {
    const cap = new CachingCapability(CAP_ID);
    expect(cap.phase).toBe("INTERCEPT");
  });
});

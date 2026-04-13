import { describe, it, expect } from "vitest";
import { QueueCapability } from "@capabilities/queue/queue-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";

function req(id = "r-1"): Request {
  return { id: id as RequestId, parentId: null, type: "api_read", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

const passResult: ProcessResult = { outcome: { kind: "PASS" }, sideEffects: [], events: [] };

describe("QueueCapability", () => {
  it("has INTERCEPT phase", () => {
    expect(new QueueCapability("q" as CapabilityId).phase).toBe("INTERCEPT");
  });

  it("canHandle returns false (doesn't intercept pipeline)", () => {
    expect(new QueueCapability("q" as CapabilityId).canHandle("api_read")).toBe(false);
  });

  it("enqueueForRetry accepts requests within capacity", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1); // set tier to 1, capacity 32
    expect(cap.enqueueForRetry(req(), passResult)).toBe(true);
    expect(cap.getStats().queueDepth).toBe(1);
  });

  it("enqueueForRetry rejects when at capacity", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1); // tier 1, capacity 32
    for (let i = 0; i < 32; i++) {
      cap.enqueueForRetry(req(`r-${i}`), passResult);
    }
    expect(cap.enqueueForRetry(req("r-overflow"), passResult)).toBe(false);
    expect(cap.getStats().totalDroppedFull).toBe(1);
  });

  it("emitReady drains entire buffer", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(req("r-1"), passResult);
    cap.enqueueForRetry(req("r-2"), passResult);

    const ready = cap.emitReady();
    expect(ready.awaitingDelivery).toHaveLength(2);
    expect(ready.awaitingPipeline).toHaveLength(0);
    expect(cap.getStats().queueDepth).toBe(0);
  });

  it("dequeueBatch returns up to n items", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(req("r-1"), passResult);
    cap.enqueueForRetry(req("r-2"), passResult);
    cap.enqueueForRetry(req("r-3"), passResult);

    const batch = cap.dequeueBatch(2);
    expect(batch).toHaveLength(2);
    expect(cap.getStats().queueDepth).toBe(1);
  });

  it("getUpkeepCost scales with tier", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    expect(cap.getUpkeepCost(1)).toBe(4);
    expect(cap.getUpkeepCost(3)).toBe(12);
  });

  it("tracks totalEnqueued in stats", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(req("r-1"), passResult);
    cap.enqueueForRetry(req("r-2"), passResult);
    expect(cap.getStats().totalEnqueued).toBe(2);
  });
});

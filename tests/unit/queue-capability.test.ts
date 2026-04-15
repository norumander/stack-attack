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

  it("dequeueBatch returns up to n items from heldBuffer", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    const hold: ProcessResult = { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] };
    cap.enqueueForRetry(req("r-1"), hold);
    cap.enqueueForRetry(req("r-2"), hold);
    cap.enqueueForRetry(req("r-3"), hold);

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

const holdResult: ProcessResult = { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] };

function batchReq(id = "r-1"): Request {
  return { id: id as RequestId, parentId: null, type: "batch", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

describe("QueueCapability — hold semantics", () => {
  it("canHandle returns true for holdTypes, false for others", () => {
    const cap = new QueueCapability("q" as CapabilityId, { holdTypes: new Set(["batch"]) });
    expect(cap.canHandle("batch")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });

  it("process returns QUEUE_HOLD for held types, PASS otherwise", () => {
    const cap = new QueueCapability("q" as CapabilityId, { holdTypes: new Set(["batch"]) });
    const heldReq = batchReq("r-1");
    const normalReq = req("r-2");
    expect(cap.process(heldReq, {} as any).outcome.kind).toBe("QUEUE_HOLD");
    expect(cap.process(normalReq, {} as any).outcome.kind).toBe("PASS");
  });

  it("enqueueForRetry routes QUEUE_HOLD → heldBuffer", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(batchReq("r-1"), holdResult);
    expect(cap.getStats().heldDepth).toBe(1);
    expect(cap.getStats().overflowDepth).toBe(0);
  });

  it("enqueueForRetry routes backpressure → overflowBuffer", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(req("r-1"), passResult);
    expect(cap.getStats().heldDepth).toBe(0);
    expect(cap.getStats().overflowDepth).toBe(1);
  });

  it("emitReady drains only overflowBuffer", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(batchReq("r-1"), holdResult);
    cap.enqueueForRetry(req("r-2"), passResult);

    const ready = cap.emitReady();
    expect(ready.awaitingDelivery).toHaveLength(1);
    expect(ready.awaitingDelivery[0]!.request.id).toBe("r-2");
    expect(cap.getStats().heldDepth).toBe(1);
    expect(cap.getStats().overflowDepth).toBe(0);
  });

  it("dequeueBatch pulls from heldBuffer", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(batchReq("r-1"), holdResult);
    cap.enqueueForRetry(batchReq("r-2"), holdResult);
    cap.enqueueForRetry(req("r-3"), passResult);

    const batch = cap.dequeueBatch(2);
    expect(batch).toHaveLength(2);
    expect(batch[0]!.id).toBe("r-1");
    expect(batch[1]!.id).toBe("r-2");
    // overflow untouched
    expect(cap.getStats().overflowDepth).toBe(1);
  });

  it("capacity shared across both buffers", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1); // capacity 32
    for (let i = 0; i < 16; i++) {
      cap.enqueueForRetry(batchReq(`rh-${i}`), holdResult);
    }
    for (let i = 0; i < 16; i++) {
      cap.enqueueForRetry(req(`ro-${i}`), passResult);
    }
    // buffer is full at 32
    expect(cap.enqueueForRetry(req("r-overflow"), passResult)).toBe(false);
    expect(cap.getStats().totalDroppedFull).toBe(1);
  });

  it("peekBuffered returns both buffers combined", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(batchReq("r-1"), holdResult);
    cap.enqueueForRetry(req("r-2"), passResult);

    const peeked = cap.peekBuffered();
    expect(peeked).toHaveLength(2);
    const ids = peeked.map((e) => e.request.id);
    expect(ids).toContain("r-1");
    expect(ids).toContain("r-2");
  });

  it("removeRequest works across both buffers", () => {
    const cap = new QueueCapability("q" as CapabilityId);
    cap.getUpkeepCost(1);
    cap.enqueueForRetry(batchReq("r-1"), holdResult);
    cap.enqueueForRetry(req("r-2"), passResult);

    expect(cap.removeRequest("r-1" as RequestId)).toBe(true);
    expect(cap.getStats().heldDepth).toBe(0);
    expect(cap.removeRequest("r-2" as RequestId)).toBe(true);
    expect(cap.getStats().overflowDepth).toBe(0);
    expect(cap.removeRequest("r-999" as RequestId)).toBe(false);
  });
});

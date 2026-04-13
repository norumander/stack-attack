import { describe, it, expect } from "vitest";
import { RetryCapability } from "@capabilities/retry/retry-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";

function req(id = "r-1"): Request {
  return { id: id as RequestId, parentId: null, type: "api_read", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}
const passResult: ProcessResult = { outcome: { kind: "PASS" }, sideEffects: [], events: [] };

describe("RetryCapability", () => {
  it("has INTERCEPT phase", () => { expect(new RetryCapability("retry" as CapabilityId).phase).toBe("INTERCEPT"); });
  it("canHandle returns false (doesn't intercept pipeline)", () => { expect(new RetryCapability("retry" as CapabilityId).canHandle("api_read")).toBe(false); });

  it("enqueueForRetry accepts and buffers requests", () => {
    const cap = new RetryCapability("retry" as CapabilityId);
    expect(cap.enqueueForRetry(req(), passResult)).toBe(true);
    expect(cap.getStats().buffered).toBe(1);
  });

  it("emitReady returns requests after backoff period", () => {
    const cap = new RetryCapability("retry" as CapabilityId);
    cap.setCurrentTick(0);
    cap.enqueueForRetry(req(), passResult); // retryAt = 0 + 2^1 = 2
    cap.setCurrentTick(2);
    const ready = cap.emitReady();
    expect(ready.awaitingDelivery).toHaveLength(1);
    expect(cap.getStats().buffered).toBe(0);
  });

  it("does not emit before backoff elapses", () => {
    const cap = new RetryCapability("retry" as CapabilityId);
    cap.setCurrentTick(0);
    cap.enqueueForRetry(req(), passResult);
    cap.setCurrentTick(1); // too early
    const ready = cap.emitReady();
    expect(ready.awaitingDelivery).toHaveLength(0);
  });

  it("rejects after max retries", () => {
    const cap = new RetryCapability("retry" as CapabilityId);
    cap.setCurrentTick(0);
    // Max retries = 4
    for (let i = 0; i < 4; i++) cap.enqueueForRetry(req(), passResult);
    expect(cap.enqueueForRetry(req(), passResult)).toBe(false);
    expect(cap.getStats().totalExhausted).toBe(1);
  });
});

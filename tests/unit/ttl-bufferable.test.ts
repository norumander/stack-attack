import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { checkTTL } from "@core/engine/check-ttl";
import { makeComponent } from "@harness/fixtures";
import {
  TestQueueCapability,
  ForwardingCapability,
} from "@harness/test-capabilities";
import { computeVisitOrder } from "@core/engine/visit-order";
import type { Request } from "@core/types/request";
import type {
  CapabilityId,
  ComponentId,
  RequestId,
} from "@core/types/ids";
import type { ProcessResult } from "@core/types/result";
import type { Capability } from "@core/capability/capability";

function makeRequest(opts: {
  id: string;
  createdAt?: number;
  ttl?: number;
}): Request {
  return {
    id: opts.id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "origin" as ComponentId,
    createdAt: opts.createdAt ?? 0,
    ttl: opts.ttl ?? 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

const passResult: ProcessResult = {
  outcome: { kind: "PASS" },
  sideEffects: [],
  events: [],
};

describe("checkTTL Scan 3: bufferable partitions", () => {
  it("expires a buffered request whose TTL has elapsed", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const fwdCap = new ForwardingCapability("fwd" as CapabilityId);
    const caps = new Map<CapabilityId, Capability>();
    caps.set("q1" as CapabilityId, queueCap);
    caps.set("fwd" as CapabilityId, fwdCap);
    const comp = makeComponent({
      id: "c1",
      capabilities: caps,
    });
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeRequest({ id: "r1", createdAt: 0, ttl: 5 });
    state.requestLog.set(req.id, []);
    queueCap.enqueueForRetry(req, passResult);

    state.currentTick = 5; // createdAt(0) + ttl(5) <= 5 → expired

    checkTTL(state);

    // Request removed from buffer
    expect(queueCap.peekBuffered()).toHaveLength(0);
    // TIMED_OUT event appended
    const events = state.requestLog.get(req.id)!;
    expect(events.some((e) => e.type === "TIMED_OUT")).toBe(true);
  });

  it("does NOT expire a buffered request whose TTL has NOT elapsed", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["q1" as CapabilityId, queueCap]]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeRequest({ id: "r1", createdAt: 0, ttl: 10 });
    state.requestLog.set(req.id, []);
    queueCap.enqueueForRetry(req, passResult);

    state.currentTick = 5; // createdAt(0) + ttl(10) = 10 > 5 → NOT expired

    checkTTL(state);

    expect(queueCap.peekBuffered()).toHaveLength(1);
    const events = state.requestLog.get(req.id)!;
    expect(events.some((e) => e.type === "TIMED_OUT")).toBe(false);
  });

  it("skips already-removed requests (cascade removed it first)", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["q1" as CapabilityId, queueCap]]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeRequest({ id: "r1", createdAt: 0, ttl: 5 });
    state.requestLog.set(req.id, []);
    queueCap.enqueueForRetry(req, passResult);

    // Pre-remove the request (simulating cascade)
    queueCap.removeRequest(req.id);

    state.currentTick = 5;
    checkTTL(state);

    // No TIMED_OUT event (was already removed)
    const events = state.requestLog.get(req.id)!;
    expect(events.some((e) => e.type === "TIMED_OUT")).toBe(false);
  });

  it("increments timeout counter for the component", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["q1" as CapabilityId, queueCap]]),
    });
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeRequest({ id: "r1", createdAt: 0, ttl: 5 });
    state.requestLog.set(req.id, []);
    queueCap.enqueueForRetry(req, passResult);
    state.currentTick = 5;

    checkTTL(state);

    const counters = state.perComponentThisTick.get("c1" as ComponentId);
    expect(counters?.timeouts).toBe(1);
  });
});

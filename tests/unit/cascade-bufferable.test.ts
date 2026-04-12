import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import {
  applyStrictCascade,
  cascadeParentTimeoutToChildren,
} from "@core/engine/cascade";
import { computeVisitOrder } from "@core/engine/visit-order";
import { makeComponent } from "@harness/fixtures";
import { TestQueueCapability } from "@harness/test-capabilities";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { Capability } from "@core/capability/capability";
import type {
  CapabilityId,
  ComponentId,
  RequestId,
} from "@core/types/ids";

function makeReq(opts: {
  id: string;
  parentId?: RequestId | null;
  createdAt?: number;
  ttl?: number;
}): Request {
  return {
    id: opts.id as RequestId,
    parentId: opts.parentId ?? null,
    type: "api_read",
    payload: null,
    origin: "origin" as ComponentId,
    createdAt: opts.createdAt ?? 0,
    ttl: opts.ttl ?? 100,
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

describe("cascade — bufferable partition scanning (Stage 2c)", () => {
  it("applyStrictCascade finds and removes a sibling from a bufferable partition", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // Component with a test queue buffer that will hold sibling childB.
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const caps = new Map<CapabilityId, Capability>();
    caps.set("q1" as CapabilityId, queueCap);
    const buffered = makeComponent({ id: "c-buffered", capabilities: caps });
    state.placeComponent(buffered);
    state.visitOrder.push(...computeVisitOrder(state.components));

    // Set up a blocking parent with two children: childA (triggers) and childB (buffered).
    const parent = makeReq({ id: "r-parent" });
    const childA = makeReq({ id: "r-child-a", parentId: parent.id });
    const childB = makeReq({ id: "r-child-b", parentId: parent.id });
    state.requestLog.set(parent.id, []);
    state.requestLog.set(childA.id, []);
    state.requestLog.set(childB.id, []);

    state.blockedParents.set(parent.id, {
      request: parent,
      originComponentId: "c-origin" as ComponentId,
      blockedOn: new Set([childA.id, childB.id]),
      childResponses: new Map(),
    });
    state.childToParent.set(childA.id, parent.id);
    state.childToParent.set(childB.id, parent.id);

    // childB is sitting in the bufferable partition.
    queueCap.enqueueForRetry(childB, passResult);

    // childA fails → trigger cascade.
    applyStrictCascade(state, childA.id);

    // Parent is CHILD_FAILED.
    expect(
      state.requestLog.get(parent.id)!.some((e) => e.type === "CHILD_FAILED"),
    ).toBe(true);
    expect(state.blockedParents.has(parent.id)).toBe(false);

    // childB was removed from the buffer.
    expect(queueCap.peekBuffered()).toHaveLength(0);

    // childB got SIBLING_CANCELLED + DROPPED events, attributed to c-buffered.
    const childBEvents = state.requestLog.get(childB.id)!;
    const sibCancel = childBEvents.find((e) => e.type === "SIBLING_CANCELLED");
    const dropped = childBEvents.find((e) => e.type === "DROPPED");
    expect(sibCancel).toBeDefined();
    expect(dropped).toBeDefined();
    expect(sibCancel!.componentId).toBe("c-buffered" as ComponentId);
    expect(dropped!.componentId).toBe("c-buffered" as ComponentId);
  });

  it("cascadeParentTimeoutToChildren finds and removes a child from a bufferable partition", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const caps = new Map<CapabilityId, Capability>();
    caps.set("q1" as CapabilityId, queueCap);
    const buffered = makeComponent({ id: "c1", capabilities: caps });
    state.placeComponent(buffered);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const parent = makeReq({ id: "r-parent" });
    const child = makeReq({ id: "r-child", parentId: parent.id });
    state.requestLog.set(child.id, []);

    // Registered in childToParent map.
    state.childToParent.set(child.id, parent.id);

    // Child is sitting in the bufferable partition.
    queueCap.enqueueForRetry(child, passResult);

    cascadeParentTimeoutToChildren(
      state,
      [child.id],
      "fallback" as ComponentId,
    );

    // Child removed from buffer.
    expect(queueCap.peekBuffered()).toHaveLength(0);

    // TIMED_OUT event attributed to c1 (where it was found), NOT fallback.
    const events = state.requestLog.get(child.id)!;
    const timedOut = events.find((e) => e.type === "TIMED_OUT");
    expect(timedOut).toBeDefined();
    expect(timedOut!.componentId).toBe("c1" as ComponentId);

    // Counter incremented on c1.
    expect(state.perComponentThisTick.get("c1" as ComponentId)?.timeouts).toBe(1);
  });

  it("cascadeParentTimeoutToChildren falls back when child is in neither pending nor bufferable", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // Component has an (empty) bufferable to ensure the scan runs but finds nothing.
    const queueCap = new TestQueueCapability("q1" as CapabilityId);
    const caps = new Map<CapabilityId, Capability>();
    caps.set("q1" as CapabilityId, queueCap);
    const comp = makeComponent({ id: "c1", capabilities: caps });
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const parent = makeReq({ id: "r-parent" });
    const child = makeReq({ id: "r-child", parentId: parent.id });
    state.requestLog.set(child.id, []);
    state.childToParent.set(child.id, parent.id);

    cascadeParentTimeoutToChildren(
      state,
      [child.id],
      "fallback" as ComponentId,
    );

    const events = state.requestLog.get(child.id)!;
    const timedOut = events.find((e) => e.type === "TIMED_OUT");
    expect(timedOut).toBeDefined();
    expect(timedOut!.componentId).toBe("fallback" as ComponentId);
    expect(state.perComponentThisTick.get("fallback" as ComponentId)?.timeouts).toBe(
      1,
    );
  });
});

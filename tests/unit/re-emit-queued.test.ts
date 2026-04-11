import { describe, it, expect } from "vitest";
import { reEmitQueued } from "@core/engine/re-emit-queued";
import { SimulationState } from "@core/state/simulation-state";
import { computeVisitOrder } from "@core/engine/visit-order";
import { makeComponent } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { EngineBufferable } from "@core/capability/engine-interfaces";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";

function makeReq(id: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "c-client" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function makeStatefulBufferable(opts: {
  awaitingPipeline?: Request[];
  awaitingDelivery?: { request: Request; result: ProcessResult }[];
}): Capability & EngineBufferable {
  const pipeline = opts.awaitingPipeline ? [...opts.awaitingPipeline] : [];
  const delivery = opts.awaitingDelivery ? [...opts.awaitingDelivery] : [];
  return {
    id: "buf" as CapabilityId,
    phase: "INTERCEPT",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
    enqueueForRetry: () => true,
    emitReady: () => {
      const outPipe = pipeline.slice();
      const outDeliv = delivery.slice();
      pipeline.length = 0;
      delivery.length = 0;
      return { awaitingPipeline: outPipe, awaitingDelivery: outDeliv };
    },
    dequeueBatch: () => [],
  };
}

describe("reEmitQueued", () => {
  it("drains awaitingPipeline into pending and awaitingDelivery into stagedOutcomes", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const pipelineReq = makeReq("r-pipe");
    const deliveryReq = makeReq("r-deliv");
    const fakeResult: ProcessResult = {
      outcome: { kind: "FORWARD" },
      sideEffects: [],
      events: [],
    };

    const buf = makeStatefulBufferable({
      awaitingPipeline: [pipelineReq],
      awaitingDelivery: [{ request: deliveryReq, result: fakeResult }],
    });

    const q = makeComponent({
      id: "q1",
      capabilities: new Map<CapabilityId, Capability>([["buf" as CapabilityId, buf]]),
    });
    state.placeComponent(q);
    state.visitOrder.push(...computeVisitOrder(state.components));

    state.requestLog.set(pipelineReq.id, []);
    state.requestLog.set(deliveryReq.id, []);

    reEmitQueued(state);

    expect(state.pending.get(q.id)).toContain(pipelineReq);
    expect(state.stagedOutcomes).toHaveLength(1);
    expect(state.stagedOutcomes[0]!.request).toBe(deliveryReq);
    expect(state.stagedOutcomes[0]!.result).toBe(fakeResult);
    expect(state.stagedOutcomes[0]!.sourceComponentId).toBe(q.id);

    // Second call: buffers drained, no-op.
    reEmitQueued(state);
    expect(state.pending.get(q.id)).toHaveLength(1); // unchanged
    expect(state.stagedOutcomes).toHaveLength(1);    // unchanged
  });

  it("processes bufferables in state.visitOrder deterministically", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const r1 = makeReq("r-1");
    const r2 = makeReq("r-2");
    const buf1 = makeStatefulBufferable({ awaitingPipeline: [r1] });
    const buf2 = makeStatefulBufferable({ awaitingPipeline: [r2] });

    // Place q-alpha first, q-beta second. Visit order uses (zone, placementTick, id) — both have
    // placementTick 0 and no zone, so ID ordering breaks the tie. "q-alpha" < "q-beta".
    const q1 = makeComponent({
      id: "q-alpha",
      capabilities: new Map<CapabilityId, Capability>([["buf" as CapabilityId, buf1]]),
    });
    const q2 = makeComponent({
      id: "q-beta",
      capabilities: new Map<CapabilityId, Capability>([["buf" as CapabilityId, buf2]]),
    });
    state.placeComponent(q1);
    state.placeComponent(q2);
    state.visitOrder.push(...computeVisitOrder(state.components));

    state.requestLog.set(r1.id, []);
    state.requestLog.set(r2.id, []);

    reEmitQueued(state);

    expect(state.pending.get(q1.id)).toEqual([r1]);
    expect(state.pending.get(q2.id)).toEqual([r2]);
    expect(state.visitOrder).toEqual([q1.id, q2.id]);
  });
});

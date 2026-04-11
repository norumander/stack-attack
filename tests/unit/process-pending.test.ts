import { describe, it, expect } from "vitest";
import { processPending } from "@core/engine/process-pending";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { computeVisitOrder } from "@core/engine/visit-order";
import type { Capability } from "@core/capability/capability";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ChildResponseSnapshot } from "@core/engine/blocked-parent";

function makeMC() {
  return new NoOpModeController({
    targetEntryPointId: "irrelevant" as ComponentId,
    intensity: 0,
    requestType: "api_read",
  });
}

function makeProcessCap(id: string, throughput: number): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
    getThroughputPerTick: () => throughput,
  };
}

function makeCapturingCap(id: string, sink: { ctx: ProcessContext | null }): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: (_req, ctx) => {
      sink.ctx = ctx;
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    },
    getUpkeepCost: () => 0,
    getStats: () => ({}),
    getThroughputPerTick: () => 100,
  };
}

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

describe("processPending", () => {
  it("processes a pending request on every component in visitOrder and stages the outcomes", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const caps1 = new Map<CapabilityId, Capability>([["proc" as CapabilityId, makeProcessCap("proc", 10)]]);
    const caps2 = new Map<CapabilityId, Capability>([["proc" as CapabilityId, makeProcessCap("proc", 10)]]);
    const c1 = makeComponent({
      id: "c-1",
      capabilities: caps1,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    const c2 = makeComponent({
      id: "c-2",
      capabilities: caps2,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    state.placeComponent(c1);
    state.placeComponent(c2);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const r1 = makeReq("r-1");
    const r2 = makeReq("r-2");
    state.requestLog.set(r1.id, []);
    state.requestLog.set(r2.id, []);
    state.enqueuePending(c1.id, r1);
    state.enqueuePending(c2.id, r2);

    const progressed = processPending(state, makeMC());

    expect(progressed).toBe(true);
    expect(state.stagedOutcomes).toHaveLength(2);
    expect(state.stagedOutcomes[0]!.sourceComponentId).toBe(c1.id);
    expect(state.stagedOutcomes[1]!.sourceComponentId).toBe(c2.id);
    expect(state.pending.get(c1.id)).toHaveLength(0);
    expect(state.pending.get(c2.id)).toHaveLength(0);
    expect(state.perComponentThisTick.get(c1.id)?.processed).toBe(1);
    expect(state.perComponentThisTick.get(c2.id)?.processed).toBe(1);
  });

  it("respects the per-component throughput gate", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const caps = new Map<CapabilityId, Capability>([["proc" as CapabilityId, makeProcessCap("proc", 2)]]);
    const c = makeComponent({
      id: "c-1",
      capabilities: caps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    for (let i = 0; i < 5; i++) {
      const r = makeReq(`r-${i}`);
      state.requestLog.set(r.id, []);
      state.enqueuePending(c.id, r);
    }

    processPending(state, makeMC());

    expect(state.stagedOutcomes).toHaveLength(2);
    expect(state.pending.get(c.id)).toHaveLength(3);
    expect(state.perComponentThisTick.get(c.id)?.processed).toBe(2);
  });

  it("returns progressed=false when no component has pending requests", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const caps = new Map<CapabilityId, Capability>([["proc" as CapabilityId, makeProcessCap("proc", 10)]]);
    const c = makeComponent({
      id: "c-1",
      capabilities: caps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const progressed = processPending(state, makeMC());

    expect(progressed).toBe(false);
    expect(state.stagedOutcomes).toHaveLength(0);
  });

  it("pulls childResponses from state.pendingChildResponses into the ProcessContext and clears the entry", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const sink = { ctx: null as ProcessContext | null };
    const caps = new Map<CapabilityId, Capability>([["cap" as CapabilityId, makeCapturingCap("cap", sink)]]);
    const c = makeComponent({
      id: "c-1",
      capabilities: caps,
      tiers: new Map([["cap" as CapabilityId, 1]]),
    });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const parent = makeReq("r-parent");
    state.requestLog.set(parent.id, []);
    state.enqueuePending(c.id, parent);

    const childId = "r-child" as RequestId;
    const snapshot: ChildResponseSnapshot = {
      outcome: { kind: "RESPOND" },
      events: [],
      returnLatency: 3,
    };
    const childMap = new Map<RequestId, ChildResponseSnapshot>([[childId, snapshot]]);
    state.pendingChildResponses.set(parent.id, childMap);

    processPending(state, makeMC());

    expect(sink.ctx).not.toBeNull();
    expect(sink.ctx!.childResponses.size).toBe(1);
    expect(sink.ctx!.childResponses.get(childId)).toEqual(snapshot);
    expect(state.pendingChildResponses.has(parent.id)).toBe(false);
  });
});

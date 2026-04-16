import { describe, it, expect } from "vitest";
import { checkTTL } from "@core/engine/check-ttl";
import { SimulationState } from "@core/state/simulation-state";
import { computeVisitOrder } from "@core/engine/visit-order";
import { makeComponent } from "@harness/fixtures";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

function makeReq(opts: {
  id: string;
  createdAt: number;
  ttl: number;
  parentId?: RequestId | null;
}): Request {
  return {
    id: opts.id as RequestId,
    parentId: opts.parentId ?? null,
    type: "api_read",
    payload: null,
    origin: "c-client" as ComponentId,
    createdAt: opts.createdAt,
    ttl: opts.ttl,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("checkTTL — pending location (§8.1/§8.2)", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("does NOT time out a request at currentTick == createdAt + ttl - 1 (still fresh)", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const r = makeReq({ id: "r-fresh", createdAt: 0, ttl: 2 });
    state.requestLog.set(r.id, []);
    state.enqueuePending(c.id, r);

    state.currentTick = 1; // 0 + 2 = 2 > 1 → still fresh
    checkTTL(state, mc);

    expect(state.pending.get(c.id)).toContain(r);
    expect(state.requestLog.get(r.id)!.some((e) => e.type === "TIMED_OUT")).toBe(false);
    expect(state.perComponentThisTick.get(c.id)?.timeouts ?? 0).toBe(0);
  });

  it("times out a request when currentTick >= createdAt + ttl", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const r = makeReq({ id: "r-expired", createdAt: 0, ttl: 2 });
    state.requestLog.set(r.id, []);
    state.enqueuePending(c.id, r);

    state.currentTick = 2; // 0 + 2 = 2 <= 2 → expired
    checkTTL(state, mc);

    expect(state.pending.get(c.id)).not.toContain(r);
    const timedOut = state.requestLog.get(r.id)!.find((e) => e.type === "TIMED_OUT");
    expect(timedOut).toBeDefined();
    expect(timedOut!.componentId).toBe(c.id);
    expect(state.perComponentThisTick.get(c.id)?.timeouts).toBe(1);
  });

  it("preserves FIFO order for survivors when timing out a middle request", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const r1 = makeReq({ id: "r-1", createdAt: 5, ttl: 10 });
    const r2 = makeReq({ id: "r-2", createdAt: 0, ttl: 3 }); // will expire at tick 3
    const r3 = makeReq({ id: "r-3", createdAt: 5, ttl: 10 });
    state.requestLog.set(r1.id, []);
    state.requestLog.set(r2.id, []);
    state.requestLog.set(r3.id, []);
    state.enqueuePending(c.id, r1);
    state.enqueuePending(c.id, r2);
    state.enqueuePending(c.id, r3);

    state.currentTick = 3;
    checkTTL(state, mc);

    const survivors = state.pending.get(c.id)!;
    expect(survivors).toEqual([r1, r3]);
    expect(state.requestLog.get(r2.id)!.some((e) => e.type === "TIMED_OUT")).toBe(true);
    expect(state.perComponentThisTick.get(c.id)?.timeouts).toBe(1);
  });

  it("times out across multiple components in visitOrder", () => {
    const state = new SimulationState(topo);
    const c1 = makeComponent({ id: "c-alpha" });
    const c2 = makeComponent({ id: "c-beta" });
    state.placeComponent(c1);
    state.placeComponent(c2);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const r1 = makeReq({ id: "r-1", createdAt: 0, ttl: 1 });
    const r2 = makeReq({ id: "r-2", createdAt: 0, ttl: 1 });
    state.requestLog.set(r1.id, []);
    state.requestLog.set(r2.id, []);
    state.enqueuePending(c1.id, r1);
    state.enqueuePending(c2.id, r2);

    state.currentTick = 5;
    checkTTL(state, mc);

    expect(state.pending.get(c1.id)).toHaveLength(0);
    expect(state.pending.get(c2.id)).toHaveLength(0);
    expect(state.perComponentThisTick.get(c1.id)?.timeouts).toBe(1);
    expect(state.perComponentThisTick.get(c2.id)?.timeouts).toBe(1);
  });

  it("triggers applyStrictCascade when a blocking child times out (parent CHILD_FAILED)", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    // Set up a blocking parent waiting on r-child.
    const parent = makeReq({ id: "r-parent", createdAt: 0, ttl: 100 });
    const child = makeReq({ id: "r-child", createdAt: 0, ttl: 1, parentId: parent.id });
    state.requestLog.set(parent.id, []);
    state.requestLog.set(child.id, []);
    state.blockedParents.set(parent.id, {
      request: parent,
      originComponentId: c.id,
      blockedOn: new Set([child.id]),
      childResponses: new Map(),
    });
    state.childToParent.set(child.id, parent.id);
    state.enqueuePending(c.id, child);

    state.currentTick = 1; // child expires (0 + 1 <= 1)
    checkTTL(state, mc);

    // Child is timed out.
    expect(state.requestLog.get(child.id)!.some((e) => e.type === "TIMED_OUT")).toBe(true);
    // Parent cascaded to CHILD_FAILED.
    expect(state.requestLog.get(parent.id)!.some((e) => e.type === "CHILD_FAILED")).toBe(true);
    expect(state.blockedParents.has(parent.id)).toBe(false);
  });
});

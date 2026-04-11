import { describe, it, expect } from "vitest";
import { checkTTL } from "@core/engine/check-ttl";
import { SimulationState } from "@core/state/simulation-state";
import { computeVisitOrder } from "@core/engine/visit-order";
import { makeComponent } from "@harness/fixtures";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

function makeReq(args: {
  id: string;
  createdAt: number;
  ttl: number;
  parentId?: string;
}): Request {
  return {
    id: args.id as RequestId,
    parentId: args.parentId != null ? (args.parentId as RequestId) : null,
    type: "api_read",
    payload: null,
    origin: "c-origin" as ComponentId,
    createdAt: args.createdAt,
    ttl: args.ttl,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("checkTTL — blocked pool and down-cascade (§8.1/§8.2)", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("times out a blocked parent and cascades to both blocking children sitting in pending", () => {
    const state = new SimulationState(topo);
    const parentComp = makeComponent({ id: "c-parent" });
    const dbA = makeComponent({ id: "c-db-a" });
    const dbB = makeComponent({ id: "c-db-b" });
    state.placeComponent(parentComp);
    state.placeComponent(dbA);
    state.placeComponent(dbB);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const parent = makeReq({ id: "r-parent", createdAt: 0, ttl: 5 });
    const childA = makeReq({ id: "r-child-a", createdAt: 0, ttl: 100, parentId: "r-parent" });
    const childB = makeReq({ id: "r-child-b", createdAt: 0, ttl: 100, parentId: "r-parent" });
    state.requestLog.set(parent.id, []);
    state.requestLog.set(childA.id, []);
    state.requestLog.set(childB.id, []);

    state.blockedParents.set(parent.id, {
      request: parent,
      originComponentId: parentComp.id,
      blockedOn: new Set([childA.id, childB.id]),
      childResponses: new Map(),
    });
    state.childToParent.set(childA.id, parent.id);
    state.childToParent.set(childB.id, parent.id);
    state.enqueuePending(dbA.id, childA);
    state.enqueuePending(dbB.id, childB);

    state.currentTick = 5; // 0 + 5 <= 5 → parent expired
    checkTTL(state);

    // Parent entry removed from blockedParents.
    expect(state.blockedParents.has(parent.id)).toBe(false);

    // Parent timed out at its origin component.
    const parentEvs = state.requestLog.get(parent.id)!;
    expect(parentEvs.some((e) => e.type === "TIMED_OUT" && e.componentId === parentComp.id)).toBe(
      true,
    );
    expect(state.perComponentThisTick.get(parentComp.id)?.timeouts).toBe(1);

    // Children timed out at their respective pending components.
    expect(
      state.requestLog.get(childA.id)!.some((e) => e.type === "TIMED_OUT" && e.componentId === dbA.id),
    ).toBe(true);
    expect(
      state.requestLog.get(childB.id)!.some((e) => e.type === "TIMED_OUT" && e.componentId === dbB.id),
    ).toBe(true);
    expect(state.perComponentThisTick.get(dbA.id)?.timeouts).toBe(1);
    expect(state.perComponentThisTick.get(dbB.id)?.timeouts).toBe(1);

    // Children removed from pending queues.
    expect(state.pending.get(dbA.id)).toHaveLength(0);
    expect(state.pending.get(dbB.id)).toHaveLength(0);

    // childToParent entries cleaned up.
    expect(state.childToParent.has(childA.id)).toBe(false);
    expect(state.childToParent.has(childB.id)).toBe(false);
  });

  it("does NOT time out a blocked parent whose TTL has not elapsed", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const parent = makeReq({ id: "r-parent", createdAt: 0, ttl: 10 });
    const child = makeReq({ id: "r-child", createdAt: 0, ttl: 100, parentId: "r-parent" });
    state.requestLog.set(parent.id, []);
    state.requestLog.set(child.id, []);
    state.blockedParents.set(parent.id, {
      request: parent,
      originComponentId: c.id,
      blockedOn: new Set([child.id]),
      childResponses: new Map(),
    });
    state.childToParent.set(child.id, parent.id);

    state.currentTick = 5; // 0 + 10 = 10 > 5 → still fresh
    checkTTL(state);

    expect(state.blockedParents.has(parent.id)).toBe(true);
    expect(state.requestLog.get(parent.id)!.some((e) => e.type === "TIMED_OUT")).toBe(false);
  });

  it("recursively cascades a nested blocking parent (grandparent → parent → grandchild)", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    const cChild = makeComponent({ id: "c-2" });
    state.placeComponent(c);
    state.placeComponent(cChild);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const gp = makeReq({ id: "r-gp", createdAt: 0, ttl: 2 });
    const parent = makeReq({ id: "r-parent", createdAt: 0, ttl: 100, parentId: "r-gp" });
    const grandchild = makeReq({ id: "r-gc", createdAt: 0, ttl: 100, parentId: "r-parent" });
    state.requestLog.set(gp.id, []);
    state.requestLog.set(parent.id, []);
    state.requestLog.set(grandchild.id, []);

    // Grandparent blocked on parent; parent blocked on grandchild.
    state.blockedParents.set(gp.id, {
      request: gp,
      originComponentId: c.id,
      blockedOn: new Set([parent.id]),
      childResponses: new Map(),
    });
    state.blockedParents.set(parent.id, {
      request: parent,
      originComponentId: c.id,
      blockedOn: new Set([grandchild.id]),
      childResponses: new Map(),
    });
    state.childToParent.set(parent.id, gp.id);
    state.childToParent.set(grandchild.id, parent.id);
    state.enqueuePending(cChild.id, grandchild);

    state.currentTick = 2; // 0 + 2 <= 2 → gp expired
    checkTTL(state);

    // Both blocked entries removed.
    expect(state.blockedParents.has(gp.id)).toBe(false);
    expect(state.blockedParents.has(parent.id)).toBe(false);

    // Grandchild removed from pending.
    expect(state.pending.get(cChild.id)).toHaveLength(0);

    // All three requests received a TIMED_OUT event.
    expect(state.requestLog.get(gp.id)!.some((e) => e.type === "TIMED_OUT")).toBe(true);
    expect(state.requestLog.get(parent.id)!.some((e) => e.type === "TIMED_OUT")).toBe(true);
    expect(state.requestLog.get(grandchild.id)!.some((e) => e.type === "TIMED_OUT")).toBe(true);
  });
});

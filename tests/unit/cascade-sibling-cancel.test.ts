import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { BlockedParentEntry } from "@core/engine/blocked-parent";

describe("strict cascade — child DROP → parent CHILD_FAILED + sibling cancel", () => {
  const topo = { zones: [], pairLatency: new Map() };

  function req(id: string, origin = "c-client"): Request {
    return {
      id: id as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: origin as ComponentId,
      createdAt: 0,
      ttl: 10,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
  }

  function preBlock(
    state: SimulationState,
    parent: Request,
    childIds: RequestId[],
    originComponentId: ComponentId,
  ) {
    const entry: BlockedParentEntry = {
      request: parent,
      originComponentId,
      blockedOn: new Set(childIds),
      childResponses: new Map(),
    };
    state.blockedParents.set(parent.id, entry);
    for (const c of childIds) state.childToParent.set(c, parent.id);
  }

  it("DROPping a blocking child cascades: parent CHILD_FAILED, siblings SIBLING_CANCELLED", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-parent" }));
    state.placeComponent(makeComponent({ id: "c-db-a" }));
    state.placeComponent(makeComponent({ id: "c-db-b" }));

    const parent = req("p1");
    const childA = req("ca");
    const childB = req("cb");
    state.requestLog.set("p1" as RequestId, []);
    state.requestLog.set("ca" as RequestId, []);
    state.requestLog.set("cb" as RequestId, []);
    preBlock(
      state,
      parent,
      ["ca" as RequestId, "cb" as RequestId],
      "c-parent" as ComponentId,
    );

    // Sibling ca sitting in c-db-a's pending (as if enqueued by blocking SPAWN delivery)
    state.enqueuePending("c-db-a" as ComponentId, childA);
    state.enqueuePending("c-db-b" as ComponentId, childB);

    // Simulate childA being DROPPED by c-db-a's processing pipeline.
    deliverStaged(state, {
      sourceComponentId: "c-db-a" as ComponentId,
      request: childA,
      result: { outcome: { kind: "DROP", reason: "db_error" }, sideEffects: [], events: [] },
    });

    // Parent no longer blocked
    expect(state.blockedParents.has("p1" as RequestId)).toBe(false);

    // childToParent cleaned up for both children
    expect(state.childToParent.has("ca" as RequestId)).toBe(false);
    expect(state.childToParent.has("cb" as RequestId)).toBe(false);

    // CHILD_FAILED event on parent at originComponentId
    const parentLog = state.requestLog.get("p1" as RequestId)!;
    const failed = parentLog.find((e) => e.type === "CHILD_FAILED");
    expect(failed).toBeDefined();
    expect(failed?.componentId).toBe("c-parent");
    expect(failed?.metadata?.childId).toBe("ca");

    // Sibling cb removed from c-db-b pending
    expect(state.pending.get("c-db-b" as ComponentId) ?? []).not.toContain(childB);

    // SIBLING_CANCELLED + DROPPED on cb's log
    const cbLog = state.requestLog.get("cb" as RequestId)!;
    expect(cbLog.find((e) => e.type === "SIBLING_CANCELLED")).toBeDefined();
    expect(cbLog.find((e) => e.type === "DROPPED" && e.metadata?.reason === "SIBLING_CANCELLED")).toBeDefined();

    // Counter bumps: c-parent (parent CHILD_FAILED), c-db-a (childA DROPped), c-db-b (sibling drop)
    expect(state.perComponentThisTick.get("c-parent" as ComponentId)?.drops).toBe(1);
    expect(state.perComponentThisTick.get("c-db-a" as ComponentId)?.drops).toBe(1);
    expect(state.perComponentThisTick.get("c-db-b" as ComponentId)?.drops).toBe(1);
  });

  it("DROPping a non-child request does not touch blockedParents", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c1" }));
    const r = req("r-free");
    state.requestLog.set("r-free" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c1" as ComponentId,
      request: r,
      result: { outcome: { kind: "DROP", reason: "plain" }, sideEffects: [], events: [] },
    });

    expect(state.blockedParents.size).toBe(0);
    // And the original DROPPED event still fires (Task 11 behavior)
    expect(state.requestLog.get("r-free" as RequestId)!.find((e) => e.type === "DROPPED")).toBeDefined();
  });

  it("late-arriving: triggering child has childToParent but parent already gone → cleanup only", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c1" }));
    const r = req("c-late");
    state.requestLog.set("c-late" as RequestId, []);
    state.childToParent.set("c-late" as RequestId, "ghost-parent" as RequestId);

    deliverStaged(state, {
      sourceComponentId: "c1" as ComponentId,
      request: r,
      result: { outcome: { kind: "DROP", reason: "x" }, sideEffects: [], events: [] },
    });

    expect(state.childToParent.has("c-late" as RequestId)).toBe(false);
  });

  it("multi-sibling: one child fails, all remaining siblings cancelled", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-parent" }));
    state.placeComponent(makeComponent({ id: "c-a" }));
    state.placeComponent(makeComponent({ id: "c-b" }));
    state.placeComponent(makeComponent({ id: "c-c" }));

    const parent = req("p2");
    const ca = req("a");
    const cb = req("b");
    const cc = req("c");
    state.requestLog.set("p2" as RequestId, []);
    state.requestLog.set("a" as RequestId, []);
    state.requestLog.set("b" as RequestId, []);
    state.requestLog.set("c" as RequestId, []);
    preBlock(
      state,
      parent,
      ["a" as RequestId, "b" as RequestId, "c" as RequestId],
      "c-parent" as ComponentId,
    );
    state.enqueuePending("c-a" as ComponentId, ca);
    state.enqueuePending("c-b" as ComponentId, cb);
    state.enqueuePending("c-c" as ComponentId, cc);

    deliverStaged(state, {
      sourceComponentId: "c-a" as ComponentId,
      request: ca,
      result: { outcome: { kind: "DROP", reason: "fail" }, sideEffects: [], events: [] },
    });

    // Both siblings b and c cancelled
    expect(state.requestLog.get("b" as RequestId)!.find((e) => e.type === "SIBLING_CANCELLED")).toBeDefined();
    expect(state.requestLog.get("c" as RequestId)!.find((e) => e.type === "SIBLING_CANCELLED")).toBeDefined();
    expect(state.pending.get("c-b" as ComponentId) ?? []).toHaveLength(0);
    expect(state.pending.get("c-c" as ComponentId) ?? []).toHaveLength(0);
  });
});

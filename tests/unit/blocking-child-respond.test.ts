// tests/unit/blocking-child-respond.test.ts
import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { BlockedParentEntry } from "@core/engine/blocked-parent";
import { NoOpModeController } from "@harness/noop-mode-controller";

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("deliverStaged — blocking child RESPOND unblocks parent", () => {
  const topo = { zones: [], pairLatency: new Map() };

  function req(id: string, origin: string): Request {
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

  it("single-child blocking SPAWN: child RESPOND unblocks parent and front-inserts into origin pending", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-parent" }));
    state.placeComponent(makeComponent({ id: "c-child" }));
    const p = req("p1", "c-client");
    const c = req("c1", "c-client");
    state.requestLog.set("p1" as RequestId, []);
    state.requestLog.set("c1" as RequestId, []);
    preBlock(state, p, ["c1" as RequestId], "c-parent" as ComponentId);

    // Simulate an existing request already in c-parent's pending, to verify front-insert.
    const other = req("other", "c-client");
    state.requestLog.set("other" as RequestId, []);
    state.enqueuePending("c-parent" as ComponentId, other);

    deliverStaged(state, {
      sourceComponentId: "c-child" as ComponentId,
      request: c,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    }, mc);

    // Parent unblocked
    expect(state.blockedParents.has("p1" as RequestId)).toBe(false);
    expect(state.childToParent.has("c1" as RequestId)).toBe(false);

    // Parent re-enqueued at FRONT of c-parent pending
    const pending = state.pending.get("c-parent" as ComponentId)!;
    expect(pending[0]?.id).toBe("p1");
    expect(pending[1]?.id).toBe("other");

    // CHILD_RESOLVED event on parent log
    const parentLog = state.requestLog.get("p1" as RequestId)!;
    const resolved = parentLog.find((e) => e.type === "CHILD_RESOLVED");
    expect(resolved).toBeDefined();
    expect(resolved?.metadata?.childId).toBe("c1");
    expect(resolved?.componentId).toBe("c-parent");
  });

  it("multi-child blocking: parent stays blocked until all children have RESPONDed", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-parent" }));
    const p = req("p2", "c-client");
    const c1 = req("ca", "c-client");
    const c2 = req("cb", "c-client");
    state.requestLog.set("p2" as RequestId, []);
    state.requestLog.set("ca" as RequestId, []);
    state.requestLog.set("cb" as RequestId, []);
    preBlock(state, p, ["ca" as RequestId, "cb" as RequestId], "c-parent" as ComponentId);

    // First child responds: parent still blocked
    deliverStaged(state, {
      sourceComponentId: "c-x" as ComponentId,
      request: c1,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    }, mc);
    expect(state.blockedParents.has("p2" as RequestId)).toBe(true);
    const entry = state.blockedParents.get("p2" as RequestId)!;
    expect(entry.blockedOn.size).toBe(1);
    expect(entry.childResponses.size).toBe(1);
    expect(state.pending.get("c-parent" as ComponentId) ?? []).not.toContain(p);

    // Second child responds: parent unblocked + re-enqueued
    deliverStaged(state, {
      sourceComponentId: "c-y" as ComponentId,
      request: c2,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    }, mc);
    expect(state.blockedParents.has("p2" as RequestId)).toBe(false);
    expect(state.pending.get("c-parent" as ComponentId)?.[0]?.id).toBe("p2");
  });

  it("late-arriving RESPOND (parent already removed): cleans up childToParent silently", () => {
    const state = new SimulationState(topo);
    const c = req("c-late", "c-client");
    state.requestLog.set("c-late" as RequestId, []);
    // No blockedParents entry, but childToParent points to a missing parent.
    state.childToParent.set("c-late" as RequestId, "ghost-parent" as RequestId);

    const moved = deliverStaged(state, {
      sourceComponentId: "c-x" as ComponentId,
      request: c,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    }, mc);

    expect(moved).toBe(true);
    expect(state.childToParent.has("c-late" as RequestId)).toBe(false);
    // No crash, no blockedParents touched
  });

  it("non-blocking-child RESPOND (no childToParent entry) does nothing extra", () => {
    const state = new SimulationState(topo);
    const r = req("r-free", "c-client");
    state.requestLog.set("r-free" as RequestId, []);
    // childToParent not touched — it's a regular RESPOND

    deliverStaged(state, {
      sourceComponentId: "c-x" as ComponentId,
      request: r,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    }, mc);

    // RESPONDED event should still exist (Task 13 behavior preserved)
    const evs = state.requestLog.get("r-free" as RequestId)!;
    expect(evs.find((e) => e.type === "RESPONDED")).toBeDefined();
    expect(state.blockedParents.size).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { SideEffect } from "@core/types/result";
import { NoOpModeController } from "@harness/noop-mode-controller";

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("deliverStaged — blocking SPAWN side effect", () => {
  const topo = { zones: [], pairLatency: new Map() };

  function parent(id: string): Request {
    return {
      id: id as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: "c-src" as ComponentId,
      createdAt: 0,
      ttl: 10,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
  }

  function childTemplate(id: string, origin = "c-tgt"): Request {
    return {
      id: id as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: origin as ComponentId,
      createdAt: 0,
      ttl: 20,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
  }

  it("creates blocked-parent entry with blockedOn={childId} and childToParent wiring", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-src" }));
    state.placeComponent(makeComponent({ id: "c-tgt" }));
    const p = parent("p1");
    state.requestLog.set("p1" as RequestId, []);

    const se: SideEffect = { kind: "SPAWN", request: childTemplate("c1"), blocking: true };
    state.currentTick = 2;
    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: p,
      result: {
        outcome: { kind: "PASS" },
        sideEffects: [se],
        events: [],
      },
    }, mc);

    // Child should be in target pending
    expect(state.pending.get("c-tgt" as ComponentId)?.length).toBe(1);

    // Blocked parent tracking
    const entry = state.blockedParents.get("p1" as RequestId);
    expect(entry).toBeDefined();
    expect(entry?.originComponentId).toBe("c-src");
    expect(entry?.blockedOn.has("c1" as RequestId)).toBe(true);
    expect(entry?.blockedOn.size).toBe(1);
    expect(entry?.childResponses.size).toBe(0);

    // Inverse lookup
    expect(state.childToParent.get("c1" as RequestId)).toBe("p1");

    // SPAWNED_SUB event on parent with blocking: true
    const parentLog = state.requestLog.get("p1" as RequestId)!;
    const spawned = parentLog.find((e) => e.type === "SPAWNED_SUB");
    expect(spawned?.metadata?.blocking).toBe(true);
    expect(spawned?.metadata?.childId).toBe("c1");
  });

  it("accumulates multiple blocking SPAWNs onto the same blocked-parent entry", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-src" }));
    state.placeComponent(makeComponent({ id: "c-a" }));
    state.placeComponent(makeComponent({ id: "c-b" }));
    const p = parent("p2");
    state.requestLog.set("p2" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: p,
      result: {
        outcome: { kind: "PASS" },
        sideEffects: [
          { kind: "SPAWN", request: childTemplate("ca", "c-a"), blocking: true },
          { kind: "SPAWN", request: childTemplate("cb", "c-b"), blocking: true },
        ],
        events: [],
      },
    }, mc);

    const entry = state.blockedParents.get("p2" as RequestId);
    expect(entry?.blockedOn.size).toBe(2);
    expect(entry?.blockedOn.has("ca" as RequestId)).toBe(true);
    expect(entry?.blockedOn.has("cb" as RequestId)).toBe(true);
    expect(state.childToParent.get("ca" as RequestId)).toBe("p2");
    expect(state.childToParent.get("cb" as RequestId)).toBe("p2");
  });

  it("does not re-enqueue the parent into pending", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-src" }));
    state.placeComponent(makeComponent({ id: "c-tgt" }));
    const p = parent("p3");
    state.requestLog.set("p3" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: p,
      result: {
        outcome: { kind: "PASS" },
        sideEffects: [{ kind: "SPAWN", request: childTemplate("c3"), blocking: true }],
        events: [],
      },
    }, mc);

    // Parent should NOT be re-enqueued in source pending
    expect(state.pending.get("c-src" as ComponentId) ?? []).not.toContain(p);
  });

  it("non-blocking spawns still work unchanged alongside blocking ones", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-src" }));
    state.placeComponent(makeComponent({ id: "c-a" }));
    state.placeComponent(makeComponent({ id: "c-b" }));
    const p = parent("p4");
    state.requestLog.set("p4" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: p,
      result: {
        outcome: { kind: "PASS" },
        sideEffects: [
          { kind: "SPAWN", request: childTemplate("nb", "c-a"), blocking: false },
          { kind: "SPAWN", request: childTemplate("bl", "c-b"), blocking: true },
        ],
        events: [],
      },
    }, mc);

    // Non-blocking child does NOT appear in blockedOn or childToParent
    const entry = state.blockedParents.get("p4" as RequestId);
    expect(entry?.blockedOn.size).toBe(1);
    expect(entry?.blockedOn.has("bl" as RequestId)).toBe(true);
    expect(entry?.blockedOn.has("nb" as RequestId)).toBe(false);
    expect(state.childToParent.has("nb" as RequestId)).toBe(false);
    expect(state.childToParent.get("bl" as RequestId)).toBe("p4");
  });
});

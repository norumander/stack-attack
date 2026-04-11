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

describe("deliverStaged — non-blocking SPAWN side effect", () => {
  const topo = { zones: [], pairLatency: new Map() };

  function buildParent(id: string): Request {
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

  it("enqueues the child in the target's pending and emits SPAWNED_SUB on parent, ENTERED on child", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-src" }));
    state.placeComponent(makeComponent({ id: "c-tgt" }));
    const parent = buildParent("p1");
    state.requestLog.set("p1" as RequestId, []);

    const child: Request = {
      id: "child1" as RequestId,
      parentId: null, // will be overridden by delivery
      type: "event",
      payload: null,
      origin: "c-tgt" as ComponentId,
      createdAt: -1, // will be overridden
      ttl: 20,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
    const sideEffect: SideEffect = { kind: "SPAWN", request: child, blocking: false };

    state.currentTick = 3;
    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: parent,
      result: {
        outcome: { kind: "DROP", reason: "done" },
        sideEffects: [sideEffect],
        events: [],
      },
    }, mc);

    const targetPending = state.pending.get("c-tgt" as ComponentId) ?? [];
    expect(targetPending.length).toBe(1);
    const stored = targetPending[0]!;
    expect(stored.id).toBe("child1");
    expect(stored.parentId).toBe("p1");
    expect(stored.createdAt).toBe(3);
    expect(stored.ttl).toBeLessThanOrEqual(7); // floor: parent remaining = 0 + 10 - 3 = 7

    const parentLog = state.requestLog.get("p1" as RequestId)!;
    const spawned = parentLog.find((e) => e.type === "SPAWNED_SUB");
    expect(spawned).toBeDefined();
    expect(spawned?.metadata?.childId).toBe("child1");
    expect(spawned?.metadata?.blocking).toBe(false);

    const childLog = state.requestLog.get("child1" as RequestId)!;
    expect(childLog[0]?.type).toBe("ENTERED");
    expect(childLog[0]?.componentId).toBe("c-tgt");
  });

  it("inherits TTL as min(parent remaining, child template ttl)", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-src" }));
    state.placeComponent(makeComponent({ id: "c-tgt" }));
    const parent = buildParent("p2");
    state.requestLog.set("p2" as RequestId, []);

    // parent remaining at tick 6: 0 + 10 - 6 = 4
    // child template ttl = 20, so inherited = min(4, 20) = 4
    state.currentTick = 6;
    const child: Request = {
      id: "c1" as RequestId,
      parentId: null,
      type: "event",
      payload: null,
      origin: "c-tgt" as ComponentId,
      createdAt: 0,
      ttl: 20,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: parent,
      result: {
        outcome: { kind: "DROP", reason: "done" },
        sideEffects: [{ kind: "SPAWN", request: child, blocking: false }],
        events: [],
      },
    }, mc);

    const stored = (state.pending.get("c-tgt" as ComponentId) ?? [])[0];
    expect(stored?.ttl).toBe(4);
  });

  it("does not touch blockedParents or childToParent for non-blocking spawns", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-src" }));
    state.placeComponent(makeComponent({ id: "c-tgt" }));
    const parent = buildParent("p3");
    state.requestLog.set("p3" as RequestId, []);
    const child: Request = {
      id: "c3" as RequestId,
      parentId: null,
      type: "event",
      payload: null,
      origin: "c-tgt" as ComponentId,
      createdAt: 0,
      ttl: 5,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: parent,
      result: {
        outcome: { kind: "DROP", reason: "done" },
        sideEffects: [{ kind: "SPAWN", request: child, blocking: false }],
        events: [],
      },
    }, mc);
    expect(state.blockedParents.size).toBe(0);
    expect(state.childToParent.size).toBe(0);
  });
});

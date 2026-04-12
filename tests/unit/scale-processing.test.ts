import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { deliverStaged } from "@core/engine/deliver-staged";
import { makeComponent } from "@harness/fixtures";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { computeVisitOrder } from "@core/engine/visit-order";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { StagedOutcome } from "@core/engine/staged-outcome";
import type { ComponentId, RequestId } from "@core/types/ids";

function makeRequest(id: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "c1" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function makeMC(): NoOpModeController {
  return new NoOpModeController({
    targetEntryPointId: "c1" as ComponentId,
    intensity: 0,
    requestType: "api_read",
  });
}

describe("deliverStaged: SCALE side effect processing", () => {
  it("scales instanceCount and emits SCALED event", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({ id: "c1" });
    (comp as { maxInstances: number }).maxInstances = 5;
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeRequest("r1");
    state.requestLog.set(req.id, []);

    const result: ProcessResult = {
      outcome: { kind: "RESPOND" },
      sideEffects: [{ kind: "SCALE", targetInstanceCount: 3 }],
      events: [],
    };
    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result,
    };

    deliverStaged(state, staged, makeMC());

    expect(comp.instanceCount).toBe(3);
    const events = state.requestLog.get(req.id)!;
    const scaled = events.find((e) => e.type === "SCALED");
    expect(scaled).toBeDefined();
    expect(scaled!.metadata).toEqual({ from: 1, to: 3 });
  });

  it("clamps SCALE target to maxInstances", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({ id: "c1" });
    (comp as { maxInstances: number }).maxInstances = 3;
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeRequest("r1");
    state.requestLog.set(req.id, []);

    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: {
        outcome: { kind: "RESPOND" },
        sideEffects: [{ kind: "SCALE", targetInstanceCount: 10 }],
        events: [],
      },
    };

    deliverStaged(state, staged, makeMC());

    expect(comp.instanceCount).toBe(3);
    const events = state.requestLog.get(req.id)!;
    const scaled = events.find((e) => e.type === "SCALED");
    expect(scaled!.metadata).toEqual({ from: 1, to: 3 });
  });

  it("clamps SCALE target to minInstances", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({ id: "c1" });
    (comp as { minInstances: number }).minInstances = 2;
    (comp as { maxInstances: number }).maxInstances = 5;
    comp.instanceCount = 3;
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeRequest("r1");
    state.requestLog.set(req.id, []);

    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: {
        outcome: { kind: "RESPOND" },
        sideEffects: [{ kind: "SCALE", targetInstanceCount: 0 }],
        events: [],
      },
    };

    deliverStaged(state, staged, makeMC());

    expect(comp.instanceCount).toBe(2);
    const events = state.requestLog.get(req.id)!;
    const scaled = events.find((e) => e.type === "SCALED");
    expect(scaled!.metadata).toEqual({ from: 3, to: 2 });
  });

  it("is a no-op when clamped value matches current instanceCount", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeComponent({ id: "c1" });
    // defaults: minInstances=1, maxInstances=1, instanceCount=1
    state.placeComponent(comp);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeRequest("r1");
    state.requestLog.set(req.id, []);

    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: {
        outcome: { kind: "RESPOND" },
        sideEffects: [{ kind: "SCALE", targetInstanceCount: 5 }],
        events: [],
      },
    };

    deliverStaged(state, staged, makeMC());

    expect(comp.instanceCount).toBe(1);
    const events = state.requestLog.get(req.id)!;
    expect(events.some((e) => e.type === "SCALED")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { IllegalStateError } from "@core/engine/errors";
import { makeComponent } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { EngineBufferable } from "@core/capability/engine-interfaces";
import type { ComponentId, CapabilityId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";

function makeBufferable(opts: { accept: boolean }): Capability & EngineBufferable {
  return {
    id: "q" as CapabilityId,
    phase: "INTERCEPT",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
    enqueueForRetry: () => opts.accept,
    emitReady: () => ({ awaitingPipeline: [], awaitingDelivery: [] }),
    dequeueBatch: () => [],
  };
}

describe("deliverStaged — QUEUE_HOLD", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("accepts into bufferable and appends QUEUED", () => {
    const state = new SimulationState(topo);
    const buf = makeBufferable({ accept: true });
    const queue = makeComponent({
      id: "q1",
      capabilities: new Map<CapabilityId, Capability>([["q" as CapabilityId, buf]]),
    });
    state.placeComponent(queue);
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    const result: ProcessResult = { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] };
    const moved = deliverStaged(state, {
      sourceComponentId: "q1" as ComponentId,
      request: req,
      result,
    });

    expect(moved).toBe(true);
    const evs = state.requestLog.get("r1" as RequestId)!;
    expect(evs.some((e) => e.type === "QUEUED")).toBe(true);
    expect(evs.some((e) => e.type === "DROPPED")).toBe(false);
    expect(state.perComponentThisTick.get("q1" as ComponentId)?.drops ?? 0).toBe(0);
  });

  it("degrades to DROP(QUEUE_FULL) when bufferable rejects", () => {
    const state = new SimulationState(topo);
    const buf = makeBufferable({ accept: false });
    const queue = makeComponent({
      id: "q1",
      capabilities: new Map<CapabilityId, Capability>([["q" as CapabilityId, buf]]),
    });
    state.placeComponent(queue);
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    const result: ProcessResult = { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] };
    deliverStaged(state, {
      sourceComponentId: "q1" as ComponentId,
      request: req,
      result,
    });

    const drop = state.requestLog.get("r1" as RequestId)!.find((e) => e.type === "DROPPED");
    expect(drop?.metadata?.reason).toBe("QUEUE_FULL");
    expect(state.perComponentThisTick.get("q1" as ComponentId)?.drops).toBe(1);
  });

  it("throws IllegalStateError when source has no EngineBufferable", () => {
    const state = new SimulationState(topo);
    const plain = makeComponent({ id: "c-plain" });
    state.placeComponent(plain);
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    expect(() =>
      deliverStaged(state, {
        sourceComponentId: "c-plain" as ComponentId,
        request: req,
        result: { outcome: { kind: "QUEUE_HOLD" }, sideEffects: [], events: [] },
      }),
    ).toThrow(IllegalStateError);
  });
});

import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { EngineBufferable } from "@core/capability/engine-interfaces";
import type { ComponentId, CapabilityId, ConnectionId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import { NoOpModeController } from "@harness/noop-mode-controller";

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

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

describe("deliverStaged — FORWARD backpressure (§6.2)", () => {
  it("enqueues into target bufferable when bandwidth is exhausted (accepts)", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeComponent({ id: "c-src", ports: [makePort("p-out", "egress")] });
    const buf = makeBufferable({ accept: true });
    const dst = makeComponent({
      id: "c-dst",
      ports: [makePort("p-in", "ingress")],
      capabilities: new Map<CapabilityId, Capability>([["q" as CapabilityId, buf]]),
    });
    state.placeComponent(src);
    state.placeComponent(dst);
    state.addConnection(
      makeConnection(
        "cx",
        { componentId: "c-src", portId: "p-out" },
        { componentId: "c-dst", portId: "p-in" },
        { bandwidth: 1, latency: 1 },
      ),
    );
    state.connectionLoadThisTick.set("cx" as ConnectionId, 1); // saturate

    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: req,
      result: { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] },
    }, mc);

    const evs = state.requestLog.get("r1" as RequestId)!;
    const bp = evs.find((e) => e.type === "BACKPRESSURED");
    expect(bp).toBeDefined();
    expect(bp!.componentId).toBe("c-dst" as ComponentId);
    expect(evs.some((e) => e.type === "DROPPED")).toBe(false);
    expect(state.perComponentThisTick.get("c-dst" as ComponentId)?.backpressured).toBe(1);
    expect(state.perComponentThisTick.get("c-src" as ComponentId)?.drops ?? 0).toBe(0);
    expect(state.pending.get("c-dst" as ComponentId) ?? []).not.toContain(req);
  });

  it("drops with DROPPED(BACKPRESSURED) at target when bufferable is full", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeComponent({ id: "c-src", ports: [makePort("p-out", "egress")] });
    const buf = makeBufferable({ accept: false });
    const dst = makeComponent({
      id: "c-dst",
      ports: [makePort("p-in", "ingress")],
      capabilities: new Map<CapabilityId, Capability>([["q" as CapabilityId, buf]]),
    });
    state.placeComponent(src);
    state.placeComponent(dst);
    state.addConnection(
      makeConnection(
        "cx",
        { componentId: "c-src", portId: "p-out" },
        { componentId: "c-dst", portId: "p-in" },
        { bandwidth: 1, latency: 1 },
      ),
    );
    state.connectionLoadThisTick.set("cx" as ConnectionId, 1); // saturate

    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: req,
      result: { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] },
    }, mc);

    const evs = state.requestLog.get("r1" as RequestId)!;
    const drop = evs.find((e) => e.type === "DROPPED");
    expect(drop).toBeDefined();
    expect(drop!.componentId).toBe("c-dst" as ComponentId);
    expect(drop!.metadata?.reason).toBe("BACKPRESSURED");
    expect(state.perComponentThisTick.get("c-dst" as ComponentId)?.drops).toBe(1);
    expect(state.perComponentThisTick.get("c-src" as ComponentId)?.drops ?? 0).toBe(0);
    expect(evs.some((e) => e.type === "BACKPRESSURED")).toBe(false);
  });

  it("drops with DROPPED(BACKPRESSURED) at target when target has no bufferable", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeComponent({ id: "c-src", ports: [makePort("p-out", "egress")] });
    const dst = makeComponent({
      id: "c-dst",
      ports: [makePort("p-in", "ingress")],
    });
    state.placeComponent(src);
    state.placeComponent(dst);
    state.addConnection(
      makeConnection(
        "cx",
        { componentId: "c-src", portId: "p-out" },
        { componentId: "c-dst", portId: "p-in" },
        { bandwidth: 1, latency: 1 },
      ),
    );
    state.connectionLoadThisTick.set("cx" as ConnectionId, 1); // saturate

    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: req,
      result: { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] },
    }, mc);

    const evs = state.requestLog.get("r1" as RequestId)!;
    const drop = evs.find((e) => e.type === "DROPPED");
    expect(drop).toBeDefined();
    expect(drop!.componentId).toBe("c-dst" as ComponentId);
    expect(drop!.metadata?.reason).toBe("BACKPRESSURED");
    expect(state.perComponentThisTick.get("c-dst" as ComponentId)?.drops).toBe(1);
    expect(state.perComponentThisTick.get("c-src" as ComponentId)?.drops ?? 0).toBe(0);
    expect(evs.some((e) => e.type === "BACKPRESSURED")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { resetPerTickState } from "@core/engine/reset-per-tick";
import { SimulationState } from "@core/state/simulation-state";
import { IllegalStateError } from "@core/engine/errors";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId, ConnectionId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";

function makeCapWithHook(id: string, sink: { calls: number }): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
    resetPerTickState: () => {
      sink.calls += 1;
    },
  };
}

function makeCapWithoutHook(id: string): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

describe("resetPerTickState (step 9)", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("clears per-tick counters and per-tick connection load on every reset", () => {
    const state = new SimulationState(topo);
    const src = makeComponent({ id: "c-src", ports: [makePort("p-out", "egress")] });
    const dst = makeComponent({ id: "c-dst", ports: [makePort("p-in", "ingress")] });
    state.placeComponent(src);
    state.placeComponent(dst);
    state.addConnection(
      makeConnection(
        "cx",
        { componentId: "c-src", portId: "p-out" },
        { componentId: "c-dst", portId: "p-in" },
        { bandwidth: 100, latency: 1 },
      ),
    );

    state.perComponentThisTick.set("c-src" as ComponentId, {
      processed: 5,
      drops: 1,
      timeouts: 0,
      overloaded: 0,
      backpressured: 0,
    });
    state.incrementConnectionLoad("cx" as ConnectionId, 30);

    resetPerTickState(state);

    expect(state.perComponentThisTick.size).toBe(0);
    expect(state.connectionLoadThisTick.size).toBe(0);
    expect(state.connections.get("cx" as ConnectionId)!.currentLoad).toBe(0);
  });

  it("calls resetPerTickState on each capability exactly once", () => {
    const state = new SimulationState(topo);
    const sink1 = { calls: 0 };
    const sink2 = { calls: 0 };
    const sink3 = { calls: 0 };

    const comp1 = makeComponent({
      id: "c-1",
      capabilities: new Map<CapabilityId, Capability>([
        ["a" as CapabilityId, makeCapWithHook("a", sink1)],
        ["b" as CapabilityId, makeCapWithHook("b", sink2)],
      ]),
    });
    const comp2 = makeComponent({
      id: "c-2",
      capabilities: new Map<CapabilityId, Capability>([
        ["c" as CapabilityId, makeCapWithHook("c", sink3)],
        ["d" as CapabilityId, makeCapWithoutHook("d")], // no hook — should be skipped safely
      ]),
    });
    state.placeComponent(comp1);
    state.placeComponent(comp2);

    resetPerTickState(state);

    expect(sink1.calls).toBe(1);
    expect(sink2.calls).toBe(1);
    expect(sink3.calls).toBe(1);
  });

  it("throws IllegalStateError when stagedOutcomes is non-empty", () => {
    const state = new SimulationState(topo);

    const fakeResult: ProcessResult = {
      outcome: { kind: "PASS" },
      sideEffects: [],
      events: [],
    };
    state.stagedOutcomes.push({
      sourceComponentId: "c-ghost" as ComponentId,
      request: {
        id: "r-ghost" as RequestId,
        parentId: null,
        type: "api_read",
        payload: null,
        origin: "c-ghost" as ComponentId,
        createdAt: 0,
        ttl: 100,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      } as Request,
      result: fakeResult,
    });

    expect(() => resetPerTickState(state)).toThrow(IllegalStateError);
  });

  it("is idempotent when called on an already-clean state", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);
    resetPerTickState(state);
    expect(() => resetPerTickState(state)).not.toThrow();
    expect(state.perComponentThisTick.size).toBe(0);
  });
});

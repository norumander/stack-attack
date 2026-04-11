import { describe, it, expect } from "vitest";
import { updateActiveStreams } from "@core/engine/active-streams";
import { SimulationState } from "@core/state/simulation-state";
import type { ActiveStream } from "@core/types/stream";
import type { Request } from "@core/types/request";
import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids";
import { NoOpModeController } from "@harness/noop-mode-controller";

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

function makeRequest(id: string, origin: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: origin as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: 3,
    streamBandwidth: 10,
  };
}

function makeStream(overrides: Partial<ActiveStream> = {}): ActiveStream {
  const requestId = (overrides.requestId ?? ("r-1" as RequestId)) as RequestId;
  const originComponentId =
    (overrides.originComponentId ?? ("c-origin" as ComponentId)) as ComponentId;
  return {
    requestId,
    connectionId: "cx" as ConnectionId,
    originComponentId,
    baseRevenue: 0,
    request: makeRequest(requestId, originComponentId),
    remainingDuration: 3,
    reservedBandwidth: 10,
    ...overrides,
  };
}

describe("updateActiveStreams (step 4b)", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("decrements remainingDuration once per call and does NOT complete early", () => {
    const state = new SimulationState(topo);
    const stream = makeStream({ remainingDuration: 3 });
    state.registerActiveStream(stream);
    state.requestLog.set(stream.requestId, []);

    updateActiveStreams(state, mc);
    expect(stream.remainingDuration).toBe(2);
    expect(state.activeStreams.has(stream.requestId)).toBe(true);
    expect(state.requestLog.get(stream.requestId)!.some((e) => e.type === "STREAM_COMPLETED")).toBe(false);
  });

  it("releases the stream and appends STREAM_COMPLETED when remainingDuration reaches zero", () => {
    const state = new SimulationState(topo);
    const stream = makeStream({ remainingDuration: 3 });
    state.registerActiveStream(stream);
    state.requestLog.set(stream.requestId, []);

    updateActiveStreams(state, mc); // 3 -> 2
    updateActiveStreams(state, mc); // 2 -> 1
    updateActiveStreams(state, mc); // 1 -> 0, release + STREAM_COMPLETED

    expect(state.activeStreams.has(stream.requestId)).toBe(false);
    const evs = state.requestLog.get(stream.requestId)!;
    const completed = evs.find((e) => e.type === "STREAM_COMPLETED");
    expect(completed).toBeDefined();
    expect(completed!.componentId).toBe(stream.originComponentId);
    expect(completed!.connectionId).toBe(stream.connectionId);
  });

  it("handles multiple streams independently", () => {
    const state = new SimulationState(topo);
    const s1 = makeStream({
      requestId: "r-a" as RequestId,
      remainingDuration: 1,
    });
    const s2 = makeStream({
      requestId: "r-b" as RequestId,
      remainingDuration: 2,
    });
    state.registerActiveStream(s1);
    state.registerActiveStream(s2);
    state.requestLog.set(s1.requestId, []);
    state.requestLog.set(s2.requestId, []);

    updateActiveStreams(state, mc); // s1: 1->0 release, s2: 2->1

    expect(state.activeStreams.has(s1.requestId)).toBe(false);
    expect(state.activeStreams.has(s2.requestId)).toBe(true);
    expect(s2.remainingDuration).toBe(1);
    expect(state.requestLog.get(s1.requestId)!.some((e) => e.type === "STREAM_COMPLETED")).toBe(true);
    expect(state.requestLog.get(s2.requestId)!.some((e) => e.type === "STREAM_COMPLETED")).toBe(false);
  });

  it("is a no-op when there are no active streams", () => {
    const state = new SimulationState(topo);
    expect(() => updateActiveStreams(state, mc)).not.toThrow();
    expect(state.activeStreams.size).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { updateActiveStreams } from "@core/engine/active-streams";
import { SimulationState } from "@core/state/simulation-state";
import type { ActiveStream } from "@core/types/stream";
import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids";

function makeStream(overrides: Partial<ActiveStream> = {}): ActiveStream {
  return {
    requestId: "r-1" as RequestId,
    connectionId: "cx" as ConnectionId,
    originComponentId: "c-origin" as ComponentId,
    baseRevenue: 0,
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

    updateActiveStreams(state);
    expect(stream.remainingDuration).toBe(2);
    expect(state.activeStreams.has(stream.requestId)).toBe(true);
    expect(state.requestLog.get(stream.requestId)!.some((e) => e.type === "STREAM_COMPLETED")).toBe(false);
  });

  it("releases the stream and appends STREAM_COMPLETED when remainingDuration reaches zero", () => {
    const state = new SimulationState(topo);
    const stream = makeStream({ remainingDuration: 3 });
    state.registerActiveStream(stream);
    state.requestLog.set(stream.requestId, []);

    updateActiveStreams(state); // 3 -> 2
    updateActiveStreams(state); // 2 -> 1
    updateActiveStreams(state); // 1 -> 0, release + STREAM_COMPLETED

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

    updateActiveStreams(state); // s1: 1->0 release, s2: 2->1

    expect(state.activeStreams.has(s1.requestId)).toBe(false);
    expect(state.activeStreams.has(s2.requestId)).toBe(true);
    expect(s2.remainingDuration).toBe(1);
    expect(state.requestLog.get(s1.requestId)!.some((e) => e.type === "STREAM_COMPLETED")).toBe(true);
    expect(state.requestLog.get(s2.requestId)!.some((e) => e.type === "STREAM_COMPLETED")).toBe(false);
  });

  it("is a no-op when there are no active streams", () => {
    const state = new SimulationState(topo);
    expect(() => updateActiveStreams(state)).not.toThrow();
    expect(state.activeStreams.size).toBe(0);
  });
});

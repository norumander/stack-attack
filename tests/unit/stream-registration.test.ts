import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    id: "r1" as RequestId,
    parentId: null,
    type: "stream",
    payload: null,
    origin: "c-client" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
    ...overrides,
  };
}

describe("deliverStaged — RESPOND stream registration (§6.4)", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("registers an ActiveStream and emits STREAM_STARTED when RESPOND carries streamDuration (with a TRAVERSED hop)", () => {
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
        { bandwidth: 100, latency: 2 },
      ),
    );

    const req = makeReq({
      id: "r-stream" as RequestId,
      origin: "c-src" as ComponentId,
      streamDuration: 10,
      streamBandwidth: 25,
    });
    // Simulate that the request arrived at c-dst via cx — the RESPOND fires at c-dst and
    // pickStreamConnection should pick cx as the last forward hop.
    state.requestLog.set(req.id, [
      {
        tick: 0,
        componentId: "c-dst" as ComponentId,
        capabilityId: null,
        connectionId: "cx" as ConnectionId,
        type: "TRAVERSED",
        latencyAdded: 2,
      },
    ]);

    const result: ProcessResult = { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
    const moved = deliverStaged(state, {
      sourceComponentId: "c-dst" as ComponentId,
      request: req,
      result,
    });

    expect(moved).toBe(true);
    const evs = state.requestLog.get(req.id)!;
    const streamStarted = evs.find((e) => e.type === "STREAM_STARTED");
    expect(streamStarted).toBeDefined();
    expect(streamStarted!.connectionId).toBe("cx" as ConnectionId);
    expect(streamStarted!.componentId).toBe("c-dst" as ComponentId);

    const stream = state.activeStreams.get(req.id);
    expect(stream).toBeDefined();
    expect(stream!.connectionId).toBe("cx" as ConnectionId);
    expect(stream!.remainingDuration).toBe(10);
    expect(stream!.reservedBandwidth).toBe(25);
    expect(stream!.originComponentId).toBe("c-src" as ComponentId);
    expect(stream!.baseRevenue).toBe(0);

    // Normal RESPOND path still runs.
    expect(evs.some((e) => e.type === "RESPONDED")).toBe(true);
  });

  it("degrades RESPOND to DROP(NO_STREAM_EGRESS) when the source has no egress and no TRAVERSED history", () => {
    const state = new SimulationState(topo);
    // Isolated component: no egress connections, no prior TRAVERSED events.
    state.placeComponent(makeComponent({ id: "c-iso" }));

    const req = makeReq({
      id: "r-iso" as RequestId,
      origin: "c-iso" as ComponentId,
      streamDuration: 10,
      streamBandwidth: 25,
    });
    state.requestLog.set(req.id, []);

    const result: ProcessResult = { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
    deliverStaged(state, {
      sourceComponentId: "c-iso" as ComponentId,
      request: req,
      result,
    });

    const evs = state.requestLog.get(req.id)!;
    const drop = evs.find((e) => e.type === "DROPPED");
    expect(drop).toBeDefined();
    expect(drop!.metadata?.reason).toBe("NO_STREAM_EGRESS");
    expect(state.perComponentThisTick.get("c-iso" as ComponentId)?.drops).toBe(1);

    // Should NOT have fired RESPONDED or STREAM_STARTED.
    expect(evs.some((e) => e.type === "RESPONDED")).toBe(false);
    expect(evs.some((e) => e.type === "STREAM_STARTED")).toBe(false);
    expect(state.activeStreams.size).toBe(0);
  });

  it("leaves non-stream RESPOND unchanged (no STREAM_STARTED, no ActiveStream)", () => {
    const state = new SimulationState(topo);
    state.placeComponent(makeComponent({ id: "c-src" }));

    const req = makeReq({
      id: "r-normal" as RequestId,
      origin: "c-src" as ComponentId,
      streamDuration: null,
    });
    state.requestLog.set(req.id, []);

    const result: ProcessResult = { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: req,
      result,
    });

    const evs = state.requestLog.get(req.id)!;
    expect(evs.some((e) => e.type === "RESPONDED")).toBe(true);
    expect(evs.some((e) => e.type === "STREAM_STARTED")).toBe(false);
    expect(state.activeStreams.size).toBe(0);
  });
});

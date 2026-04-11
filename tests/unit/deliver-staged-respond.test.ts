import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeConnection } from "@harness/fixtures";
import type { ComponentId, RequestId, ConnectionId } from "@core/types/ids";
import type { Request, RequestEvent } from "@core/types/request";
import { NoOpModeController } from "@harness/noop-mode-controller";

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("deliverStaged — RESPOND", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("appends RESPONDED with returnLatency / returnPath / forwardLatency metadata", () => {
    const state = new SimulationState(topo);
    state.addConnection(
      makeConnection(
        "cx",
        { componentId: "c-src", portId: "p" },
        { componentId: "c-dst", portId: "p" },
        { latency: 7 },
      ),
    );
    const req = {
      id: "r1" as RequestId,
      createdAt: 0,
      ttl: 10,
      origin: "c-src" as ComponentId,
    } as Request;
    state.requestLog.set("r1" as RequestId, [
      {
        tick: 0,
        componentId: "c-src" as ComponentId,
        capabilityId: null,
        connectionId: "cx" as ConnectionId,
        type: "TRAVERSED",
        latencyAdded: 7,
      } satisfies RequestEvent,
    ]);

    const moved = deliverStaged(state, {
      sourceComponentId: "c-dst" as ComponentId,
      request: req,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    }, mc);

    expect(moved).toBe(true);
    const responded = state.requestLog
      .get("r1" as RequestId)!
      .find((e) => e.type === "RESPONDED");
    expect(responded).toBeDefined();
    expect(responded?.componentId).toBe("c-src");
    expect(responded?.metadata?.returnLatency).toBe(7);
    expect(responded?.metadata?.forwardLatency).toBe(7);
    expect(responded?.metadata?.returnPath).toEqual(["cx"]);
  });

  it("handles local RESPOND with empty return path", () => {
    const state = new SimulationState(topo);
    const req = {
      id: "r1" as RequestId,
      createdAt: 0,
      ttl: 10,
      origin: "c1" as ComponentId,
    } as Request;
    state.requestLog.set("r1" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    }, mc);

    const responded = state.requestLog
      .get("r1" as RequestId)!
      .find((e) => e.type === "RESPONDED");
    expect(responded?.metadata?.returnLatency).toBe(0);
    expect(responded?.metadata?.forwardLatency).toBe(0);
    expect(responded?.metadata?.returnPath).toEqual([]);
  });

  it("returns true (moved) on RESPOND", () => {
    const state = new SimulationState(topo);
    const req = {
      id: "r1" as RequestId,
      createdAt: 0,
      ttl: 10,
      origin: "c1" as ComponentId,
    } as Request;
    state.requestLog.set("r1" as RequestId, []);
    const moved = deliverStaged(state, {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] },
    }, mc);
    expect(moved).toBe(true);
  });
});

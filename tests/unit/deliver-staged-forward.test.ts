import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { ComponentId, RequestId, ConnectionId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import { NoOpModeController } from "@harness/noop-mode-controller";

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("deliverStaged — FORWARD", () => {
  it("moves request to target pending and appends FORWARDED + TRAVERSED", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeComponent({ id: "c-src", ports: [makePort("p-out", "egress")] });
    const dst = makeComponent({ id: "c-dst", ports: [makePort("p-in", "ingress")] });
    state.placeComponent(src);
    state.placeComponent(dst);
    state.addConnection(
      makeConnection(
        "cx",
        { componentId: "c-src", portId: "p-out" },
        { componentId: "c-dst", portId: "p-in" },
        { bandwidth: 100, latency: 4 },
      ),
    );
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    const moved = deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: req,
      result: { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] },
    }, mc);

    expect(moved).toBe(true);
    expect(state.pending.get("c-dst" as ComponentId)).toContain(req);
    const evs = state.requestLog.get("r1" as RequestId)!;
    const types = evs.map((e) => e.type);
    expect(types).toContain("TRAVERSED");
    expect(types).toContain("FORWARDED");
    expect(state.connectionLoadThisTick.get("cx" as ConnectionId)).toBe(1);
  });

  it("drops with NO_EGRESS when source has no egress connections", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComponent({ id: "c-src" }));
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    deliverStaged(state, {
      sourceComponentId: "c-src" as ComponentId,
      request: req,
      result: { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] },
    }, mc);

    const drop = state.requestLog.get("r1" as RequestId)!.find((e) => e.type === "DROPPED");
    expect(drop?.metadata?.reason).toBe("NO_EGRESS");
    expect(state.perComponentThisTick.get("c-src" as ComponentId)?.drops).toBe(1);
  });
});

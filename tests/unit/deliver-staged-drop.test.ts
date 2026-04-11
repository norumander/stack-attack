import { describe, it, expect } from "vitest";
import { deliverStaged } from "@core/engine/deliver-staged";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import { NoOpModeController } from "@harness/noop-mode-controller";

const mc = new NoOpModeController({
  targetEntryPointId: "x" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("deliverStaged — DROP", () => {
  it("appends DROPPED event and increments source counter", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeComponent({ id: "c1" });
    state.placeComponent(src);
    const req = { id: "r1" as RequestId, createdAt: 0, ttl: 10 } as Request;
    state.requestLog.set("r1" as RequestId, []);

    const moved = deliverStaged(state, {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result: { outcome: { kind: "DROP", reason: "bad" }, sideEffects: [], events: [] },
    }, mc);

    expect(moved).toBe(true);
    const events = state.requestLog.get("r1" as RequestId)!;
    expect(events.find((e) => e.type === "DROPPED")?.metadata?.reason).toBe("bad");
    expect(state.perComponentThisTick.get("c1" as ComponentId)?.drops).toBe(1);
  });
});

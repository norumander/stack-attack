import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { makeComponent } from "@harness/fixtures";
import type { ComponentId } from "@core/types/ids";

describe("Engine.tick — 12-step ordering", () => {
  it("invokes all 12 step functions in spec order and then advances the tick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const order: string[] = [];
    const record = (name: string) => () => {
      order.push(name);
    };

    const engine = new Engine(state, {
      injectTraffic: record("injectTraffic"),
      reEmitQueued: record("reEmitQueued"),
      runFixedPointLoop: record("runFixedPointLoop"),
      sweepOverloaded: record("sweepOverloaded"),
      updateActiveStreams: record("updateActiveStreams"),
      checkTTL: record("checkTTL"),
      updateCondition: record("updateCondition"),
      injectChaos: record("injectChaos"),
      deductUpkeep: record("deductUpkeep"),
      recordMetrics: record("recordMetrics"),
      resetPerTickState: record("resetPerTickState"),
    });

    const mc = new NoOpModeController({
      targetEntryPointId: "x" as ComponentId,
      intensity: 0,
      requestType: "api_read",
    });

    const tickBefore = state.currentTick;
    engine.tick(mc);

    expect(order).toEqual([
      "injectTraffic",
      "reEmitQueued",
      "runFixedPointLoop",
      "sweepOverloaded",
      "updateActiveStreams",
      "checkTTL",
      "updateCondition",
      "injectChaos",
      "deductUpkeep",
      "recordMetrics",
      "resetPerTickState",
    ]);
    expect(state.currentTick).toBe(tickBefore + 1);
  });

  it("constructor populates state.visitOrder from the components map", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComponent({ id: "c-zzz" }));
    state.placeComponent(makeComponent({ id: "c-aaa" }));

    new Engine(state);

    expect(state.visitOrder).toEqual(["c-aaa" as ComponentId, "c-zzz" as ComponentId]);
  });
});

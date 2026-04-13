import { describe, it, expect } from "vitest";
import { computeVisitOrder } from "@core/engine/visit-order";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { makeComponent } from "@harness/fixtures";

describe("computeVisitOrder", () => {
  it("sorts by (zone, placementTick, componentId) deterministically", () => {
    const c1 = makeComponent({ id: "c-b", zone: "us-east" });
    (c1 as any).placementTick = 1;
    const c2 = makeComponent({ id: "c-a", zone: "us-east" });
    (c2 as any).placementTick = 1;
    const c3 = makeComponent({ id: "c-c", zone: "us-west" });
    (c3 as any).placementTick = 0;
    const order = computeVisitOrder(
      new Map([
        ["c-b" as any, c1],
        ["c-a" as any, c2],
        ["c-c" as any, c3],
      ])
    );
    expect(order).toEqual(["c-a", "c-b", "c-c"]); // us-east before us-west; within us-east, "c-a" before "c-b"
  });

  it("handles null zones by sorting them first (empty string)", () => {
    const c1 = makeComponent({ id: "c1", zone: null });
    (c1 as any).placementTick = 0;
    const c2 = makeComponent({ id: "c2", zone: "z1" });
    (c2 as any).placementTick = 0;
    const order = computeVisitOrder(
      new Map([
        ["c2" as any, c2],
        ["c1" as any, c1],
      ])
    );
    expect(order).toEqual(["c1", "c2"]);
  });

  it("is stable when called twice on same input", () => {
    const c1 = makeComponent({ id: "c1" });
    const c2 = makeComponent({ id: "c2" });
    const map = new Map([
      ["c1" as any, c1],
      ["c2" as any, c2],
    ]);
    expect(computeVisitOrder(map)).toEqual(computeVisitOrder(map));
  });
});

describe("SimulationState.recomputeVisitOrder", () => {
  it("picks up components placed after the Engine was constructed", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    const c1 = makeComponent({ id: "c1" });
    (c1 as any).placementTick = 0;
    state.placeComponent(c1);

    // Engine constructor writes the initial visitOrder.
    new Engine(state);
    expect(state.visitOrder).toEqual(["c1"]);

    // Add a component after construction; visitOrder is stale until refreshed.
    const c2 = makeComponent({ id: "c2" });
    (c2 as any).placementTick = 1;
    state.placeComponent(c2);
    expect(state.visitOrder).toEqual(["c1"]);

    state.recomputeVisitOrder();
    expect(state.visitOrder).toEqual(["c1", "c2"]);

    // Result matches what a fresh Engine would compute off the same state.
    const freshState = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    freshState.placeComponent(c1);
    freshState.placeComponent(c2);
    new Engine(freshState);
    expect(state.visitOrder).toEqual(freshState.visitOrder);
  });
});

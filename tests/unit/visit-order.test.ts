import { describe, it, expect } from "vitest";
import { computeVisitOrder } from "@core/engine/visit-order";
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

import { describe, it, expectTypeOf } from "vitest";
import type { RequestId, ComponentId } from "@core/types/ids";
import type { Position } from "@core/types/position";

describe("branded IDs", () => {
  it("treats branded IDs as nominal", () => {
    const r = "r-1" as RequestId;
    const c = "c-1" as ComponentId;
    expectTypeOf<RequestId>().not.toEqualTypeOf<ComponentId>();
    expectTypeOf<typeof r>().toEqualTypeOf<RequestId>();
    expectTypeOf<typeof c>().toEqualTypeOf<ComponentId>();
  });

  it("Position is a readonly 2D point", () => {
    const p: Position = { x: 1, y: 2 };
    expectTypeOf(p).toEqualTypeOf<Position>();
  });
});

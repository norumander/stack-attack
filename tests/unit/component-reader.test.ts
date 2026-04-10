import { describe, it, expectTypeOf } from "vitest";
import type { ComponentReader } from "@core/component/component-reader";
import type { CapabilityId } from "@core/types/ids";

describe("ComponentReader", () => {
  it("exposes getPlayerTier returning number", () => {
    type Reader = ComponentReader;
    expectTypeOf<Reader["getPlayerTier"]>().parameters.toEqualTypeOf<[CapabilityId]>();
    expectTypeOf<Reader["getPlayerTier"]>().returns.toEqualTypeOf<number>();
  });
});

import { describe, it, expect } from "vitest";
import { CompressionCapability } from "@capabilities/compression/compression-capability";
import type { CapabilityId } from "@core/types/ids";

describe("CompressionCapability", () => {
  it("has INTERCEPT phase", () => {
    expect(new CompressionCapability("comp" as CapabilityId).phase).toBe("INTERCEPT");
  });

  it("getUpkeepCost scales with tier", () => {
    const cap = new CompressionCapability("comp" as CapabilityId);
    expect(cap.getUpkeepCost(1)).toBe(2);
    expect(cap.getUpkeepCost(2)).toBe(4);
  });
});

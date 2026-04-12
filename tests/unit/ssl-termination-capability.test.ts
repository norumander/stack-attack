import { describe, it, expect } from "vitest";
import { SSLTerminationCapability } from "@capabilities/ssl-termination/ssl-termination-capability";
import type { CapabilityId } from "@core/types/ids";

describe("SSLTerminationCapability", () => {
  it("has INTERCEPT phase", () => {
    expect(new SSLTerminationCapability("ssl" as CapabilityId).phase).toBe("INTERCEPT");
  });

  it("getUpkeepCost scales with tier", () => {
    const cap = new SSLTerminationCapability("ssl" as CapabilityId);
    expect(cap.getUpkeepCost(1)).toBe(3);
    expect(cap.getUpkeepCost(2)).toBe(6);
  });
});

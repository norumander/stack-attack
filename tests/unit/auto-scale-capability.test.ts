import { describe, it, expect } from "vitest";
import { AutoScaleCapability } from "@capabilities/auto-scale/auto-scale-capability";
import type { CapabilityId } from "@core/types/ids";

describe("AutoScaleCapability", () => {
  it("has OBSERVE phase", () => { expect(new AutoScaleCapability("as" as CapabilityId).phase).toBe("OBSERVE"); });
  it("getUpkeepCost = tier * 3", () => { expect(new AutoScaleCapability("as" as CapabilityId).getUpkeepCost(2)).toBe(6); });
  it("canHandle returns true for all types", () => { expect(new AutoScaleCapability("as" as CapabilityId).canHandle("api_read")).toBe(true); });
});

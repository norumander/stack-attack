import { describe, it, expect } from "vitest";
import { QueryCapability } from "@capabilities/query/query-capability";
import type { CapabilityId } from "@core/types/ids";

describe("QueryCapability", () => {
  it("has PROCESS phase", () => { expect(new QueryCapability("q" as CapabilityId).phase).toBe("PROCESS"); });
  it("canHandle api_read only", () => {
    const cap = new QueryCapability("q" as CapabilityId);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("api_write")).toBe(false);
  });
  it("getThroughputPerTick = tier * 15 (fast)", () => { expect(new QueryCapability("q" as CapabilityId).getThroughputPerTick(2)).toBe(30); });
  it("getUpkeepCost = tier * 4", () => { expect(new QueryCapability("q" as CapabilityId).getUpkeepCost(3)).toBe(12); });
});

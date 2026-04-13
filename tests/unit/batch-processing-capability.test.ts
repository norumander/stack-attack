import { describe, it, expect } from "vitest";
import { BatchProcessingCapability } from "@capabilities/batch-processing/batch-processing-capability";
import type { CapabilityId } from "@core/types/ids";

describe("BatchProcessingCapability", () => {
  it("has PROCESS phase", () => { expect(new BatchProcessingCapability("bp" as CapabilityId).phase).toBe("PROCESS"); });
  it("canHandle batch only", () => {
    const cap = new BatchProcessingCapability("bp" as CapabilityId);
    expect(cap.canHandle("batch")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });
  it("getThroughputPerTick = tier * 5", () => { expect(new BatchProcessingCapability("bp" as CapabilityId).getThroughputPerTick(3)).toBe(15); });
  it("getUpkeepCost = tier * 3", () => { expect(new BatchProcessingCapability("bp" as CapabilityId).getUpkeepCost(2)).toBe(6); });
});

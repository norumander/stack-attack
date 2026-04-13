import { describe, it, expect } from "vitest";
import { StreamingCapability } from "@capabilities/streaming/streaming-capability";
import type { CapabilityId } from "@core/types/ids";

describe("StreamingCapability", () => {
  it("has PROCESS phase", () => { expect(new StreamingCapability("str" as CapabilityId).phase).toBe("PROCESS"); });
  it("canHandle stream only", () => {
    const cap = new StreamingCapability("str" as CapabilityId);
    expect(cap.canHandle("stream")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });
  it("getThroughputPerTick = tier * 4", () => { expect(new StreamingCapability("str" as CapabilityId).getThroughputPerTick(3)).toBe(12); });
  it("getUpkeepCost = tier * 7", () => { expect(new StreamingCapability("str" as CapabilityId).getUpkeepCost(2)).toBe(14); });
});

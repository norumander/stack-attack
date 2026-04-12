import { describe, it, expect } from "vitest";
import { SearchCapability } from "@capabilities/search/search-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function ctx(): ProcessContext {
  return { state: { currentTick: 0 } as any, componentId: "c-a" as ComponentId, effectiveTier: 1, effectiveTiers: new Map(), activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("SearchCapability", () => {
  it("has PROCESS phase", () => { expect(new SearchCapability("s" as CapabilityId).phase).toBe("PROCESS"); });
  it("canHandle search only", () => {
    const cap = new SearchCapability("s" as CapabilityId);
    expect(cap.canHandle("search")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });
  it("getThroughputPerTick = tier * 3 (low)", () => { expect(new SearchCapability("s" as CapabilityId).getThroughputPerTick(2)).toBe(6); });
  it("getUpkeepCost = tier * 8 (expensive)", () => { expect(new SearchCapability("s" as CapabilityId).getUpkeepCost(2)).toBe(16); });
  it("process adds latency of 3", () => {
    const cap = new SearchCapability("s" as CapabilityId);
    const r = { id: "r-1" as RequestId, parentId: null, type: "search", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
    const result = cap.process(r, ctx());
    expect(result.outcome.kind).toBe("RESPOND");
    expect(result.events[0]!.latencyAdded).toBe(3);
  });
});

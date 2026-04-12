import { describe, it, expect } from "vitest";
import { BlobStorageCapability } from "@capabilities/blob-storage/blob-storage-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function ctx(): ProcessContext {
  return { state: { currentTick: 0 } as any, componentId: "c-a" as ComponentId, effectiveTier: 1, effectiveTiers: new Map(), activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("BlobStorageCapability", () => {
  it("has PROCESS phase", () => { expect(new BlobStorageCapability("bs" as CapabilityId).phase).toBe("PROCESS"); });
  it("canHandle static_asset", () => {
    const cap = new BlobStorageCapability("bs" as CapabilityId);
    expect(cap.canHandle("static_asset")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });
  it("process adds latency of 5", () => {
    const r = { id: "r-1" as RequestId, parentId: null, type: "static_asset", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
    const result = new BlobStorageCapability("bs" as CapabilityId).process(r, ctx());
    expect(result.events[0]!.latencyAdded).toBe(5);
  });
  it("getThroughputPerTick = tier * 8", () => { expect(new BlobStorageCapability("bs" as CapabilityId).getThroughputPerTick(2)).toBe(16); });
});

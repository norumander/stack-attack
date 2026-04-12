import { describe, it, expect } from "vitest";
import { StorageCapability } from "@capabilities/storage/storage-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(type: string): Request {
  return { id: "r-1" as RequestId, parentId: null, type, payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}
function ctx(): ProcessContext {
  return { state: { currentTick: 0 } as any, componentId: "c-a" as ComponentId, effectiveTier: 1, effectiveTiers: new Map(), activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("StorageCapability", () => {
  it("has PROCESS phase", () => { expect(new StorageCapability("s" as CapabilityId).phase).toBe("PROCESS"); });
  it("canHandle api_write and api_read", () => {
    const cap = new StorageCapability("s" as CapabilityId);
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("stream")).toBe(false);
  });
  it("process returns RESPOND", () => { expect(new StorageCapability("s" as CapabilityId).process(req("api_write"), ctx()).outcome.kind).toBe("RESPOND"); });
  it("getThroughputPerTick = tier * 5", () => { expect(new StorageCapability("s" as CapabilityId).getThroughputPerTick(2)).toBe(10); });
  it("tracks writes and reads separately", () => {
    const cap = new StorageCapability("s" as CapabilityId);
    cap.process(req("api_write"), ctx());
    cap.process(req("api_read"), ctx());
    cap.process(req("api_write"), ctx());
    expect(cap.getStats().writesProcessed).toBe(2);
    expect(cap.getStats().readsProcessed).toBe(1);
  });
});

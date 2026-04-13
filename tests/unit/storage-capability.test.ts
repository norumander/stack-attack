import { describe, it, expect } from "vitest";
import { StorageCapability } from "@capabilities/storage/storage-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "storage" as CapabilityId;

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: "write-1",
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

// Minimal stub — capabilities mostly ignore context. `as unknown as` cast
// is required because the real ProcessContext has 9 fields including a
// DeterministicRng object (not a function) and a SimulationStateReader.
// We provide only the fields the capability actually reads.
const ctx = {
  currentTick: 0,
  componentId: "c-1" as ComponentId,
  effectiveTier: 1,
  activeCapabilityIds: new Set([CAP_ID]),
} as unknown as ProcessContext;

describe("StorageCapability", () => {
  it("claims api_write", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.canHandle("api_write")).toBe(true);
  });

  it("rejects api_read", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.canHandle("api_read")).toBe(false);
  });

  it("returns RESPOND outcome on writes", () => {
    const cap = new StorageCapability(CAP_ID);
    const result = cap.process(req("api_write"), ctx);
    expect(result.outcome.kind).toBe("RESPOND");
  });

  it("emits a PROCESSED event for integration test counting", () => {
    const cap = new StorageCapability(CAP_ID);
    const result = cap.process(req("api_write"), ctx);
    const ev = result.events.find((e) => e.type === "PROCESSED");
    expect(ev).toBeDefined();
    expect(ev?.componentId).toBe("c-1");
  });

  it("increments writeCount", () => {
    const cap = new StorageCapability(CAP_ID);
    cap.process(req("api_write"), ctx);
    cap.process(req("api_write"), ctx);
    expect(cap.getStats().writeCount).toBe(2);
  });

  it("declares bounded throughput", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.getThroughputPerTick(1)).toBe(25);
    expect(cap.getThroughputPerTick(2)).toBe(45);
    expect(cap.getThroughputPerTick(3)).toBe(80);
  });

  it("has upkeep scaling with tier", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.getUpkeepCost(1)).toBe(4);
    expect(cap.getUpkeepCost(2)).toBe(8);
    expect(cap.getUpkeepCost(3)).toBe(16);
  });

  it("phase is PROCESS", () => {
    const cap = new StorageCapability(CAP_ID);
    expect(cap.phase).toBe("PROCESS");
  });
});

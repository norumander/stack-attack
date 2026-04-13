import { describe, it, expect } from "vitest";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "processing" as CapabilityId;

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: null,
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

describe("ProcessingCapability (production)", () => {
  it("claims api_read via canHandle", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.canHandle("api_read")).toBe(true);
  });

  it("rejects api_write via canHandle", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.canHandle("api_write")).toBe(false);
  });

  it("rejects unknown types", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.canHandle("static_asset")).toBe(false);
    expect(cap.canHandle("batch")).toBe(false);
  });

  it("returns RESPOND outcome on api_read", () => {
    const cap = new ProcessingCapability(CAP_ID);
    const result = cap.process(req("api_read"), ctx);
    expect(result.outcome.kind).toBe("RESPOND");
    expect(result.sideEffects).toEqual([]);
  });

  it("increments processedCount on each process call", () => {
    const cap = new ProcessingCapability(CAP_ID);
    cap.process(req("api_read"), ctx);
    cap.process(req("api_read"), ctx);
    expect(cap.getStats().processedCount).toBe(2);
  });

  it("declares bounded throughput per tier", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.getThroughputPerTick(1)).toBe(20);
    expect(cap.getThroughputPerTick(2)).toBe(35);
    expect(cap.getThroughputPerTick(3)).toBe(60);
  });

  it("emits a PROCESSED event for counting in integration tests", () => {
    const cap = new ProcessingCapability(CAP_ID);
    const result = cap.process(req("api_read"), ctx);
    const processedEvent = result.events.find((e) => e.type === "PROCESSED");
    expect(processedEvent).toBeDefined();
    expect(processedEvent?.componentId).toBe("c-1");
    expect(processedEvent?.capabilityId).toBe(CAP_ID);
  });

  it("has upkeep scaling with tier", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.getUpkeepCost(1)).toBe(2);
    expect(cap.getUpkeepCost(2)).toBe(5);
    expect(cap.getUpkeepCost(3)).toBe(10);
  });

  it("phase is PROCESS", () => {
    const cap = new ProcessingCapability(CAP_ID);
    expect(cap.phase).toBe("PROCESS");
  });
});

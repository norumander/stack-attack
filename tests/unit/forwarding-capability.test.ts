import { describe, it, expect } from "vitest";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "forwarding" as CapabilityId;

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

describe("ForwardingCapability", () => {
  it("claims only the configured handledTypes", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_write"] });
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
    expect(cap.canHandle("static_asset")).toBe(false);
  });

  it("returns FORWARD outcome on handled types", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read", "api_write"] });
    const result = cap.process(req("api_read"), ctx);
    expect(result.outcome.kind).toBe("FORWARD");
    expect(result.sideEffects).toEqual([]);
  });

  it("supports forwarding multiple types via one instance", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read", "api_write"] });
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("api_write")).toBe(true);
  });

  it("declares configurable throughput per tier (default 20/tier)", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read"] });
    expect(cap.getThroughputPerTick(1)).toBe(20);
    expect(cap.getThroughputPerTick(2)).toBe(40);
    expect(cap.getThroughputPerTick(3)).toBe(60);
  });

  it("accepts configured throughputPerTier", () => {
    const cap = new ForwardingCapability(CAP_ID, {
      handledTypes: ["api_read"],
      throughputPerTier: 55,
    });
    expect(cap.getThroughputPerTick(1)).toBe(55);
  });

  it("has upkeep scaling with tier", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read"] });
    expect(cap.getUpkeepCost(1)).toBe(1);
    expect(cap.getUpkeepCost(2)).toBe(2);
    expect(cap.getUpkeepCost(3)).toBe(4);
  });

  it("emits a source-side FORWARDED event for integration test counting", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read"] });
    const result = cap.process(req("api_read"), ctx);
    const fwd = result.events.find((e) => e.type === "FORWARDED");
    expect(fwd).toBeDefined();
    expect(fwd?.capabilityId).toBe(CAP_ID); // non-null → source-side
    expect(fwd?.componentId).toBe("c-1");
  });

  it("phase is PROCESS", () => {
    const cap = new ForwardingCapability(CAP_ID, { handledTypes: ["api_read"] });
    expect(cap.phase).toBe("PROCESS");
  });
});

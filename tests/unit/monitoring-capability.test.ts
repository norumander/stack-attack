import { describe, it, expect } from "vitest";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(): Request {
  return { id: "r-1" as RequestId, parentId: null, type: "api_read", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

function ctx(): ProcessContext {
  return { state: { currentTick: 0 } as any, componentId: "c-a" as ComponentId, effectiveTier: 1, effectiveTiers: new Map(), activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("MonitoringCapability", () => {
  it("has OBSERVE phase", () => {
    expect(new MonitoringCapability("mon" as CapabilityId).phase).toBe("OBSERVE");
  });

  it("canHandle returns true for all types", () => {
    const cap = new MonitoringCapability("mon" as CapabilityId);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("stream")).toBe(true);
  });

  it("process returns PASS", () => {
    const cap = new MonitoringCapability("mon" as CapabilityId);
    expect(cap.process(req(), ctx()).outcome.kind).toBe("PASS");
  });

  it("tracks processedThisTick in stats", () => {
    const cap = new MonitoringCapability("mon" as CapabilityId);
    cap.process(req(), ctx());
    cap.process(req(), ctx());
    expect(cap.getStats().processedThisTick).toBe(2);
  });

  it("resetPerTickState clears counters", () => {
    const cap = new MonitoringCapability("mon" as CapabilityId);
    cap.process(req(), ctx());
    cap.resetPerTickState();
    expect(cap.getStats().processedThisTick).toBe(0);
  });

  it("getUpkeepCost scales with tier", () => {
    const cap = new MonitoringCapability("mon" as CapabilityId);
    expect(cap.getUpkeepCost(1)).toBe(2);
    expect(cap.getUpkeepCost(2)).toBe(4);
  });
});

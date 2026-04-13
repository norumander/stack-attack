import { describe, it, expect } from "vitest";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";

const CAP_ID = "monitoring" as CapabilityId;

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

describe("MonitoringCapability", () => {
  it("claims any request type (canHandle=true)", () => {
    const cap = new MonitoringCapability(CAP_ID);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("anything")).toBe(true);
  });

  it("returns PASS outcome (OBSERVE-phase contract)", () => {
    const cap = new MonitoringCapability(CAP_ID);
    const result = cap.process(req("api_read"), ctx);
    expect(result.outcome.kind).toBe("PASS");
  });

  it("counts every call via getStats", () => {
    const cap = new MonitoringCapability(CAP_ID);
    cap.process(req("api_read"), ctx);
    cap.process(req("api_write"), ctx);
    cap.process(req("api_read"), ctx);
    expect(cap.getStats().observedCount).toBe(3);
  });

  it("has upkeep scaling with tier", () => {
    const cap = new MonitoringCapability(CAP_ID);
    expect(cap.getUpkeepCost(1)).toBe(1);
    expect(cap.getUpkeepCost(2)).toBe(3);
    expect(cap.getUpkeepCost(3)).toBe(5);
  });

  it("phase is OBSERVE", () => {
    const cap = new MonitoringCapability(CAP_ID);
    expect(cap.phase).toBe("OBSERVE");
  });
});

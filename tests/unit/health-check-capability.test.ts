import { describe, it, expect } from "vitest";
import { HealthCheckCapability } from "@capabilities/health-check/health-check-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(): Request {
  return { id: "r-1" as RequestId, parentId: null, type: "api_read", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

function ctx(condition: number): ProcessContext {
  return {
    state: { currentTick: 0, components: new Map([["c-a" as ComponentId, { condition }]]) } as any,
    componentId: "c-a" as ComponentId, effectiveTier: 1, effectiveTiers: new Map(),
    activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map(),
  };
}

describe("HealthCheckCapability", () => {
  it("has OBSERVE phase", () => {
    expect(new HealthCheckCapability("hc" as CapabilityId).phase).toBe("OBSERVE");
  });

  it("process returns PASS", () => {
    expect(new HealthCheckCapability("hc" as CapabilityId).process(req(), ctx(1)).outcome.kind).toBe("PASS");
  });

  it("reports healthy=1 when condition > 0.6", () => {
    const cap = new HealthCheckCapability("hc" as CapabilityId);
    cap.process(req(), ctx(0.8));
    expect(cap.getStats().healthy).toBe(1);
    expect(cap.getStats().condition).toBe(0.8);
  });

  it("reports healthy=0 when condition <= 0.6", () => {
    const cap = new HealthCheckCapability("hc" as CapabilityId);
    cap.process(req(), ctx(0.4));
    expect(cap.getStats().healthy).toBe(0);
  });

  it("getUpkeepCost scales with tier", () => {
    expect(new HealthCheckCapability("hc" as CapabilityId).getUpkeepCost(2)).toBe(2);
  });
});

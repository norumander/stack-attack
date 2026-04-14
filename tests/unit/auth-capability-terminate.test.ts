import { describe, it, expect } from "vitest";
import { AuthCapability } from "@capabilities/auth/auth-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-a" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function ctx(tier = 1): ProcessContext {
  return {
    state: { currentTick: 0 } as any,
    componentId: "c-a" as ComponentId,
    effectiveTier: tier,
    effectiveTiers: new Map([["auth" as CapabilityId, tier]]),
    activeCapabilityIds: new Set(),
    currentTick: 0,
    rng: createRng("t"),
    directories: [],
    childResponses: new Map(),
  };
}

describe("AuthCapability terminateAuthRequired option", () => {
  it("RESPONDs (not PASSes) to auth_required when option is true", () => {
    const cap = new AuthCapability("auth" as CapabilityId, {
      terminateAuthRequired: true,
    });
    const result = cap.process(req("auth_required"), ctx(1));
    expect(result.outcome.kind).toBe("RESPOND");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.latencyAdded).toBe(1);
  });

  it("RESPONDs with zero latency at tier 2 with the option set", () => {
    const cap = new AuthCapability("auth" as CapabilityId, {
      terminateAuthRequired: true,
    });
    const result = cap.process(req("auth_required"), ctx(2));
    expect(result.outcome.kind).toBe("RESPOND");
    expect(result.events).toHaveLength(0);
  });

  it("non-auth requests still PASS even with terminate option", () => {
    const cap = new AuthCapability("auth" as CapabilityId, {
      terminateAuthRequired: true,
    });
    const result = cap.process(req("api_read"), ctx());
    expect(result.outcome.kind).toBe("PASS");
    expect(result.events).toHaveLength(0);
  });

  it("default config (no option) still PASSes auth_required", () => {
    const cap = new AuthCapability("auth" as CapabilityId);
    const result = cap.process(req("auth_required"), ctx(1));
    expect(result.outcome.kind).toBe("PASS");
    expect(result.events[0]!.latencyAdded).toBe(1);
  });
});

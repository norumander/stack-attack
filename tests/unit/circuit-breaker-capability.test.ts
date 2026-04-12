import { describe, it, expect } from "vitest";
import { CircuitBreakerCapability } from "@capabilities/circuit-breaker/circuit-breaker-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(): Request {
  return { id: "r-1" as RequestId, parentId: null, type: "api_read", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}
function ctx(tier = 1, tick = 0): ProcessContext {
  return { state: { currentTick: tick } as any, componentId: "c-a" as ComponentId, effectiveTier: tier, effectiveTiers: new Map([["cb" as CapabilityId, tier]]), activeCapabilityIds: new Set(), currentTick: tick, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("CircuitBreakerCapability", () => {
  it("has INTERCEPT phase", () => { expect(new CircuitBreakerCapability("cb" as CapabilityId).phase).toBe("INTERCEPT"); });

  it("starts CLOSED — passes requests", () => {
    const cap = new CircuitBreakerCapability("cb" as CapabilityId);
    expect(cap.process(req(), ctx()).outcome.kind).toBe("PASS");
    expect(cap.getCircuitState()).toBe("CLOSED");
  });

  it("opens after threshold failures", () => {
    const cap = new CircuitBreakerCapability("cb" as CapabilityId);
    for (let i = 0; i < 5; i++) cap.reportFailure(0);
    expect(cap.getCircuitState()).toBe("OPEN");
  });

  it("drops requests when OPEN", () => {
    const cap = new CircuitBreakerCapability("cb" as CapabilityId);
    for (let i = 0; i < 5; i++) cap.reportFailure(0);
    const result = cap.process(req(), ctx(1, 1)); // tick 1, cooldown is 10
    expect(result.outcome.kind).toBe("DROP");
  });

  it("transitions to HALF_OPEN after cooldown", () => {
    const cap = new CircuitBreakerCapability("cb" as CapabilityId);
    for (let i = 0; i < 5; i++) cap.reportFailure(0);
    // Tier 1 cooldown = 10 ticks
    const result = cap.process(req(), ctx(1, 10));
    expect(result.outcome.kind).toBe("PASS"); // probe request
    expect(cap.getCircuitState()).toBe("HALF_OPEN");
  });

  it("closes on success report in HALF_OPEN", () => {
    const cap = new CircuitBreakerCapability("cb" as CapabilityId);
    for (let i = 0; i < 5; i++) cap.reportFailure(0);
    cap.process(req(), ctx(1, 10)); // transition to HALF_OPEN
    cap.reportSuccess();
    expect(cap.getCircuitState()).toBe("CLOSED");
  });

  it("getUpkeepCost = tier * 2", () => { expect(new CircuitBreakerCapability("cb" as CapabilityId).getUpkeepCost(3)).toBe(6); });
});

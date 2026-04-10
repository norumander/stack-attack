import { describe, it, expect } from "vitest";
import { Component, type ComponentConstructorArgs } from "@core/component/component";
import type { Capability } from "@core/capability/capability";
import type { ProcessResult } from "@core/types/result";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { Port } from "@core/types/port";
import type { ConditionProfile } from "@core/types/condition";

const profile: ConditionProfile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [],
  criticalEffects: [],
};

function makeCap(
  id: string,
  phase: "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE",
  outcome: ProcessResult["outcome"],
): Capability {
  return {
    id: id as CapabilityId,
    phase,
    canHandle: () => true,
    process: () => ({ outcome, sideEffects: [], events: [] }),
    getUpkeepCost: () => 1,
    getStats: () => ({}),
  };
}

function baseArgs(overrides: Partial<ComponentConstructorArgs> = {}): ComponentConstructorArgs {
  const caps = new Map<CapabilityId, Capability>();
  caps.set("cap-a" as CapabilityId, makeCap("cap-a", "PROCESS", { kind: "PASS" }));
  const tiers = new Map<CapabilityId, number>();
  tiers.set("cap-a" as CapabilityId, 1);
  const ports: Port[] = [];
  return {
    id: "c-1" as ComponentId,
    type: "server",
    name: "Server",
    description: "",
    capabilities: caps,
    initialTiers: tiers,
    ports,
    placementCost: 10,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
    ...overrides,
  };
}

describe("Component", () => {
  it("constructor seeds tiers and defaults", () => {
    const c = new Component(baseArgs());
    expect(c.id).toBe("c-1");
    expect(c.instanceCount).toBe(1);
    expect(c.condition).toBe(1);
    expect(c.getPlayerTier("cap-a" as CapabilityId)).toBe(1);
    expect(c.getPlayerTier("cap-missing" as CapabilityId)).toBe(0);
  });

  it("getCapabilityIds lists registered capabilities", () => {
    const c = new Component(baseArgs());
    expect(c.getCapabilityIds()).toEqual(["cap-a"]);
  });

  it("upgrade() clamps to registryMaxTier", () => {
    const c = new Component(baseArgs());
    c.upgrade("cap-a" as CapabilityId, 3);
    expect(c.getPlayerTier("cap-a" as CapabilityId)).toBe(2);
    c.upgrade("cap-a" as CapabilityId, 3);
    expect(c.getPlayerTier("cap-a" as CapabilityId)).toBe(3);
    c.upgrade("cap-a" as CapabilityId, 3);
    expect(c.getPlayerTier("cap-a" as CapabilityId)).toBe(3);
  });

  it("getCapabilitiesByPhase filters by phase", () => {
    const caps = new Map<CapabilityId, Capability>();
    caps.set("i1" as CapabilityId, makeCap("i1", "INTERCEPT", { kind: "PASS" }));
    caps.set("p1" as CapabilityId, makeCap("p1", "PROCESS", { kind: "PASS" }));
    const tiers = new Map<CapabilityId, number>([
      ["i1" as CapabilityId, 1],
      ["p1" as CapabilityId, 1],
    ]);
    const c = new Component(baseArgs({ capabilities: caps, initialTiers: tiers }));
    expect(c.getCapabilitiesByPhase("INTERCEPT").map(x => x.id)).toEqual(["i1"]);
    expect(c.getCapabilitiesByPhase("PROCESS").map(x => x.id)).toEqual(["p1"]);
  });
});

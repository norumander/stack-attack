import { describe, it, expect } from "vitest";
import { getEffectiveTier, computeEffectiveTiers } from "@core/component/effective-tier";
import { Component } from "@core/component/component";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { ComponentReader } from "@core/component/component-reader";
import type { ModeController } from "@core/mode/mode-controller";

const profile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [],
  criticalEffects: [],
};

function makeCap(id: string): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

function makeComp(): Component {
  const caps = new Map<CapabilityId, Capability>([
    ["cap-a" as CapabilityId, makeCap("cap-a")],
    ["cap-b" as CapabilityId, makeCap("cap-b")],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["cap-a" as CapabilityId, 3],
    ["cap-b" as CapabilityId, 1],
  ]);
  return new Component({
    id: "c-1" as ComponentId,
    type: "server",
    name: "Server",
    description: "",
    capabilities: caps,
    initialTiers: tiers,
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
  });
}

function mockMode(caps: Record<string, number>): ModeController {
  return {
    getTierCap: (_comp: ComponentReader, id: CapabilityId) =>
      caps[id as unknown as string] ?? Infinity,
  } as unknown as ModeController;
}

describe("getEffectiveTier", () => {
  it("returns min of player tier and mode cap", () => {
    const comp = makeComp();
    const mode = mockMode({ "cap-a": 2 });
    expect(getEffectiveTier(comp, "cap-a" as CapabilityId, mode)).toBe(2);
  });

  it("returns player tier when mode cap is Infinity", () => {
    const comp = makeComp();
    const mode = mockMode({});
    expect(getEffectiveTier(comp, "cap-a" as CapabilityId, mode)).toBe(3);
  });

  it("returns 0 for unknown capability", () => {
    const comp = makeComp();
    const mode = mockMode({});
    expect(getEffectiveTier(comp, "cap-zzz" as CapabilityId, mode)).toBe(0);
  });
});

describe("computeEffectiveTiers", () => {
  it("builds a full map across component capabilities", () => {
    const comp = makeComp();
    const mode = mockMode({ "cap-a": 2 });
    const map = computeEffectiveTiers(comp, mode);
    expect(map.get("cap-a" as CapabilityId)).toBe(2);
    expect(map.get("cap-b" as CapabilityId)).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ConnectionId } from "@core/types/ids";

function withPhase(id: string): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

function withSubInterfaceOnly(id: string): Capability {
  return {
    id: id as CapabilityId,
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
    selectConnection: () => "cx-1" as ConnectionId,
  } as Capability;
}

function noPhaseNoSub(id: string): Capability {
  return {
    id: id as CapabilityId,
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

const profile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [],
  criticalEffects: [],
};

describe("ComponentRegistry", () => {
  it("registers and creates a component from an entry", () => {
    const caps = new CapabilityRegistry();
    caps.register({ id: "cap-p" as CapabilityId, factory: () => withPhase("cap-p") });
    const comps = new ComponentRegistry(caps);
    comps.register({
      type: "server",
      name: "Server",
      description: "",
      capabilities: [{ id: "cap-p" as CapabilityId, defaultTier: 1, maxTier: 3 }],
      ports: [],
      placementCost: 10,
      upgradeCostCurve: [10, 20, 40],
      visual: { icon: "s", color: "#fff", shape: "rect" },
      conditionProfile: profile,
    });
    comps.validate();
    const comp = comps.create("server", { x: 0, y: 0 }, null);
    expect(comp.type).toBe("server");
    expect(comp.getPlayerTier("cap-p" as CapabilityId)).toBe(1);
  });

  it("accepts sub-interface-only capabilities (no phase)", () => {
    const caps = new CapabilityRegistry();
    caps.register({
      id: "cap-s" as CapabilityId,
      factory: () => withSubInterfaceOnly("cap-s"),
    });
    const comps = new ComponentRegistry(caps);
    comps.register({
      type: "lb",
      name: "LB",
      description: "",
      capabilities: [{ id: "cap-s" as CapabilityId, defaultTier: 1, maxTier: 2 }],
      ports: [],
      placementCost: 10,
      upgradeCostCurve: [10],
      visual: { icon: "l", color: "#fff", shape: "rect" },
      conditionProfile: profile,
    });
    expect(() => comps.validate()).not.toThrow();
  });

  it("validate() rejects a capability with neither phase nor sub-interface", () => {
    const caps = new CapabilityRegistry();
    caps.register({
      id: "cap-bad" as CapabilityId,
      factory: () => noPhaseNoSub("cap-bad"),
    });
    const comps = new ComponentRegistry(caps);
    comps.register({
      type: "broken",
      name: "Broken",
      description: "",
      capabilities: [{ id: "cap-bad" as CapabilityId, defaultTier: 1, maxTier: 1 }],
      ports: [],
      placementCost: 10,
      upgradeCostCurve: [10],
      visual: { icon: "x", color: "#fff", shape: "rect" },
      conditionProfile: profile,
    });
    expect(() => comps.validate()).toThrow(/phase.*or.*sub-interface/i);
  });

  it("validate() rejects components referencing unknown capabilities", () => {
    const caps = new CapabilityRegistry();
    const comps = new ComponentRegistry(caps);
    comps.register({
      type: "orphan",
      name: "Orphan",
      description: "",
      capabilities: [{ id: "cap-missing" as CapabilityId, defaultTier: 1, maxTier: 1 }],
      ports: [],
      placementCost: 0,
      upgradeCostCurve: [],
      visual: { icon: "?", color: "#fff", shape: "rect" },
      conditionProfile: profile,
    });
    expect(() => comps.validate()).toThrow(/unknown capability/i);
  });

  it("create() throws on unknown type", () => {
    const caps = new CapabilityRegistry();
    const comps = new ComponentRegistry(caps);
    expect(() => comps.create("missing", { x: 0, y: 0 }, null)).toThrow();
  });
});

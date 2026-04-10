import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId } from "@core/types/ids";

function stub(id: string): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

describe("CapabilityRegistry", () => {
  it("register + get round-trip", () => {
    const reg = new CapabilityRegistry();
    reg.register({ id: "cap-a" as CapabilityId, factory: () => stub("cap-a") });
    const entry = reg.get("cap-a" as CapabilityId);
    expect(entry?.id).toBe("cap-a");
    expect(entry?.factory().id).toBe("cap-a");
  });

  it("throws on duplicate registration", () => {
    const reg = new CapabilityRegistry();
    reg.register({ id: "cap-a" as CapabilityId, factory: () => stub("cap-a") });
    expect(() =>
      reg.register({ id: "cap-a" as CapabilityId, factory: () => stub("cap-a") }),
    ).toThrow(/already registered/);
  });

  it("get returns undefined for unknown id", () => {
    const reg = new CapabilityRegistry();
    expect(reg.get("cap-missing" as CapabilityId)).toBeUndefined();
  });

  it("validate() passes on an empty registry", () => {
    const reg = new CapabilityRegistry();
    expect(() => reg.validate()).not.toThrow();
  });
});

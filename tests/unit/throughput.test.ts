import { describe, it, expect } from "vitest";
import { componentThroughputPerTick } from "@core/engine/throughput";
import { makeComponent } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId } from "@core/types/ids";

function makeCap(id: string, phase: "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE", tpt?: number): Capability {
  return {
    id: id as CapabilityId,
    phase,
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    ...(tpt !== undefined ? { getThroughputPerTick: () => tpt } : {}),
    getStats: () => ({}),
  };
}

describe("componentThroughputPerTick", () => {
  it("sums PROCESS-phase throughputs, scaled by instanceCount", () => {
    const caps = new Map<CapabilityId, Capability>([
      ["a" as CapabilityId, makeCap("a", "PROCESS", 3)],
      ["b" as CapabilityId, makeCap("b", "PROCESS", 4)],
      ["c" as CapabilityId, makeCap("c", "INTERCEPT", 999)],
    ]);
    const tiers = new Map([["a" as CapabilityId, 1], ["b" as CapabilityId, 1], ["c" as CapabilityId, 1]]);
    const comp = makeComponent({ id: "c1", capabilities: caps, tiers });
    comp.instanceCount = 2;
    expect(componentThroughputPerTick(comp)).toBe((3 + 4) * 2);
  });

  it("returns Infinity when no PROCESS capability implements the hook", () => {
    const caps = new Map<CapabilityId, Capability>([
      ["a" as CapabilityId, makeCap("a", "PROCESS")], // no getThroughputPerTick
    ]);
    const comp = makeComponent({ id: "c1", capabilities: caps, tiers: new Map([["a" as CapabilityId, 1]]) });
    expect(componentThroughputPerTick(comp)).toBe(Infinity);
  });

  it("returns Infinity when component has no PROCESS capabilities", () => {
    const caps = new Map<CapabilityId, Capability>([
      ["a" as CapabilityId, makeCap("a", "INTERCEPT", 5)],
    ]);
    const comp = makeComponent({ id: "c1", capabilities: caps, tiers: new Map([["a" as CapabilityId, 1]]) });
    expect(componentThroughputPerTick(comp)).toBe(Infinity);
  });
});

import { describe, it, expect } from "vitest";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { ComponentId, CapabilityId } from "@core/types/ids";

describe("NoOpModeController", () => {
  it("economy is a NoOpEconomy", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(m.economy.getBudget()).toBe(Infinity);
  });

  it("getActiveCapabilities returns all capability ids on the component", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    const fake = {
      getCapabilityIds: () => ["a", "b"] as CapabilityId[],
    } as any;
    const set = m.getActiveCapabilities(fake);
    expect([...set]).toEqual(["a", "b"]);
  });

  it("getTierCap returns Infinity", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(m.getTierCap({} as any, "x" as CapabilityId)).toBe(Infinity);
  });

  it("getScheduledChaos returns empty", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(m.getScheduledChaos(0)).toEqual([]);
  });

  it("evaluateOutcome returns neutral verdict", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(m.evaluateOutcome([]).verdict).toBe("neutral");
  });
});

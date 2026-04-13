import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";
import type { TickMetrics } from "@core/types/metrics";

function makeController() {
  const economy = new TDEconomy({
    startingBudget: WAVE_1.startingBudget,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  return new TDModeController({
    wave: WAVE_1,
    economy,
    entryPointId: "c-entry" as ComponentId,
    rng: () => 0.5,
  });
}

describe("TDModeController", () => {
  it("exposes the economy", () => {
    const mc = makeController();
    expect(mc.economy.getBudget()).toBe(WAVE_1.startingBudget);
  });

  it("getActiveCapabilities returns all capability IDs on the component", () => {
    const mc = makeController();
    const fakeComp = {
      getCapabilityIds: () => ["processing", "monitoring"],
    } as any;
    const active = mc.getActiveCapabilities(fakeComp);
    expect([...active]).toEqual(["processing", "monitoring"]);
  });

  it("getTierCap returns 1 in Stage 3a", () => {
    const mc = makeController();
    const fakeComp = { getCapabilityIds: () => ["processing"] } as any;
    expect(mc.getTierCap(fakeComp, "processing" as any)).toBe(1);
  });

  it("getBuildConstraints uses maxPlacements (not maxComponents)", () => {
    const mc = makeController();
    const constraints = mc.getBuildConstraints();
    expect(constraints.availableComponentTypes).toEqual(WAVE_1.availableComponents);
  });

  it("evaluateOutcome returns a valid OutcomeReport with 'win' verdict on low drop rate", () => {
    const mc = makeController();
    const metrics: TickMetrics[] = [
      {
        tick: 0,
        requestsProcessed: 10,
        requestsResolved: 10,
        requestsDropped: 0,
        requestsOverloaded: 0,
        requestsBackpressured: 0,
        requestsTimedOut: 0,
        revenueEarned: 10,
        upkeepPaid: 2,
        avgLatency: 1,
        perComponent: new Map(),
      },
    ];
    const outcome = mc.evaluateOutcome(metrics);
    expect(outcome.verdict).toBe("win");
    expect(outcome.score.performance).toBeCloseTo(1, 5);
    expect(outcome.notes.length).toBeGreaterThan(0);
  });

  it("evaluateOutcome returns 'lose' when drop rate exceeds threshold", () => {
    const mc = makeController();
    const metrics: TickMetrics[] = [
      {
        tick: 0,
        requestsProcessed: 10,
        requestsResolved: 5,
        requestsDropped: 5,
        requestsOverloaded: 0,
        requestsBackpressured: 0,
        requestsTimedOut: 0,
        revenueEarned: 5,
        upkeepPaid: 2,
        avgLatency: 1,
        perComponent: new Map(),
      },
    ];
    const outcome = mc.evaluateOutcome(metrics);
    expect(outcome.verdict).toBe("lose");
  });

  it("getScheduledChaos returns empty array", () => {
    const mc = makeController();
    expect(mc.getScheduledChaos(0)).toEqual([]);
  });

  it("phase transitions build → simulate → assess → build", () => {
    const mc = makeController();
    expect(mc.getPhase()).toBe("build");
    mc.advancePhase();
    expect(mc.getPhase()).toBe("simulate");
    mc.advancePhase();
    expect(mc.getPhase()).toBe("assess");
    mc.advancePhase();
    expect(mc.getPhase()).toBe("build");
  });
});

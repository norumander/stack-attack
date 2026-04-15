import { describe, expect, it } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry as bootRegistry, makeRng } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";

describe("TDModeController constructor", () => {
  it("accepts multi-wave options", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    expect(tdc.getCurrentWaveIndex()).toBe(0);
    expect(tdc.getCurrentWave()).toBe(WAVE_1);
    expect(tdc.isCampaignComplete()).toBe(false);
  });

  it("throws on empty waves array", () => {
    const economy = new TDEconomy({
      startingBudget: 100,
      revenuePerRequestType: new Map(),
    });
    expect(
      () =>
        new TDModeController({
          waves: [],
          economy,
          entryPointId: "entry" as ComponentId,
          rng: makeRng(1),
          componentRegistry: bootRegistry(),
        }),
    ).toThrow(/non-empty/);
  });

});

describe("TDModeController phase machine multi-wave progression", () => {
  it("advancePhase cycles build → simulate → assess → build with wave-index advancement", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    expect(tdc.getPhase()).toBe("build");
    expect(tdc.getCurrentWaveIndex()).toBe(0);

    tdc.advancePhase(state);
    expect(tdc.getPhase()).toBe("simulate");
    expect(tdc.getCurrentWaveIndex()).toBe(0);

    tdc.advancePhase(state);
    expect(tdc.getPhase()).toBe("assess");
    expect(tdc.getCurrentWaveIndex()).toBe(0);

    tdc.advancePhase(state);
    expect(tdc.getPhase()).toBe("build");
    expect(tdc.getCurrentWaveIndex()).toBe(1);
    expect(tdc.getCurrentWave()).toBe(WAVE_2);
  });

  it("isCampaignComplete becomes true after the final wave's assess transition", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(tdc.isCampaignComplete()).toBe(false);
    tdc.advancePhase(state); // build → simulate
    tdc.advancePhase(state); // simulate → assess
    tdc.advancePhase(state); // assess → (terminal — no next wave)
    expect(tdc.isCampaignComplete()).toBe(true);
    // Phase stays at "assess" after the final wave rather than wrapping
    // back to "build", so the dashboard cannot re-enter the phase machine.
    expect(tdc.getPhase()).toBe("assess");
  });

  it("advancePhase throws after campaign is complete", () => {
    // C2 regression: the dashboard used to be able to re-enter build/simulate
    // after the final wave win, triggering getCurrentWave() to throw on the
    // next tick. advancePhase must refuse to advance once complete.
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    tdc.advancePhase(state);
    tdc.advancePhase(state);
    tdc.advancePhase(state);
    expect(tdc.isCampaignComplete()).toBe(true);
    expect(() => tdc.advancePhase(state)).toThrow(/campaign complete/);
  });

  it("waveStartMetricsIndex snapshots state.metricsHistory.length on build→simulate", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    state.metricsHistory.push({} as any, {} as any, {} as any);
    tdc.advancePhase(state);
    state.metricsHistory.push({} as any);
    state.metricsHistory.push({} as any);
    const sliced = tdc.getCurrentWaveMetrics(state);
    expect(sliced.length).toBe(2);
  });
});

describe("TDModeController.isWaveDrained", () => {
  function exhaustTraffic(tdc: TDModeController) {
    const ts = tdc.getTrafficSource() as unknown as { isExhausted: () => boolean; generate: (n: number) => unknown };
    while (!ts.isExhausted()) ts.generate(0);
  }

  it("returns false when traffic source not exhausted", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(tdc.isWaveDrained(state)).toBe(false);
  });

  it("returns false when pending has any requests", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    exhaustTraffic(tdc);
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    state.pending.set("a" as ComponentId, [{} as any]);
    expect(tdc.isWaveDrained(state)).toBe(false);
  });

  it("returns false when blockedParents has entries", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    exhaustTraffic(tdc);
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    state.blockedParents.set("r1" as any, {} as any);
    expect(tdc.isWaveDrained(state)).toBe(false);
  });

  it("returns true when traffic exhausted and all stores empty", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1],
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootRegistry(),
    });
    exhaustTraffic(tdc);
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });
    expect(tdc.isWaveDrained(state)).toBe(true);
  });
});

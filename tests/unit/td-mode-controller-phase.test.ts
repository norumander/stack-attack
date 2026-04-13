import { describe, expect, it } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import { SimulationState } from "@core/state/simulation-state";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function bootRegistry(): ComponentRegistry {
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);
  return compRegistry;
}

describe("TDModeController constructor", () => {
  it("accepts multi-wave options", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
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

  it("accepts single-wave back-compat options (no componentRegistry)", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      wave: WAVE_1,
      economy,
      entryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    expect(tdc.getCurrentWaveIndex()).toBe(0);
    expect(tdc.getCurrentWave()).toBe(WAVE_1);
  });
});

describe("TDModeController phase machine multi-wave progression", () => {
  it("advancePhase cycles build → simulate → assess → build with wave-index advancement", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
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

  it("isCampaignComplete becomes true after the final assess→build", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
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
    tdc.advancePhase(state);
    tdc.advancePhase(state);
    tdc.advancePhase(state);
    expect(tdc.isCampaignComplete()).toBe(true);
  });

  it("waveStartMetricsIndex snapshots state.metricsHistory.length on build→simulate", () => {
    const economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget,
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
      startingBudget: WAVE_1.startingBudget,
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
      startingBudget: WAVE_1.startingBudget,
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
      startingBudget: WAVE_1.startingBudget,
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
      startingBudget: WAVE_1.startingBudget,
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

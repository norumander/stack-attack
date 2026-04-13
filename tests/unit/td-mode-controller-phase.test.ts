import { describe, expect, it } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
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

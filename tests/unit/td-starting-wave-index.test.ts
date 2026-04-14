import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";
import { bootTDRegistry, makeRng } from "@harness/td-fixtures";

function makeEconomy(budget: number) {
  return new TDEconomy({
    startingBudget: budget,
    revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
  });
}

describe("TDModeController — startingWaveIndex option", () => {
  it("defaults to wave index 0 when option is omitted", () => {
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy: makeEconomy(500),
      entryPointId: "c-entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootTDRegistry(),
    });
    expect(tdc.getCurrentWaveIndex()).toBe(0);
    expect(tdc.getCurrentWave()).toBe(WAVE_1);
  });

  it("starts at the given wave index when option is passed", () => {
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy: makeEconomy(1000),
      entryPointId: "c-entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootTDRegistry(),
      startingWaveIndex: 1,
    });
    expect(tdc.getCurrentWaveIndex()).toBe(1);
    expect(tdc.getCurrentWave()).toBe(WAVE_2);
  });

  it("starts at the final wave when asked", () => {
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy: makeEconomy(1600),
      entryPointId: "c-entry" as ComponentId,
      rng: makeRng(1),
      componentRegistry: bootTDRegistry(),
      startingWaveIndex: 2,
    });
    expect(tdc.getCurrentWaveIndex()).toBe(2);
    expect(tdc.getCurrentWave()).toBe(WAVE_3);
    expect(tdc.getWaveCount()).toBe(3); // total count unchanged
  });

  it("throws when startingWaveIndex is out of range", () => {
    expect(() =>
      new TDModeController({
        waves: [WAVE_1, WAVE_2, WAVE_3],
        economy: makeEconomy(500),
        entryPointId: "c-entry" as ComponentId,
        rng: makeRng(1),
        componentRegistry: bootTDRegistry(),
        startingWaveIndex: 3, // past the end
      }),
    ).toThrow(/out of range/);

    expect(() =>
      new TDModeController({
        waves: [WAVE_1, WAVE_2, WAVE_3],
        economy: makeEconomy(500),
        entryPointId: "c-entry" as ComponentId,
        rng: makeRng(1),
        componentRegistry: bootTDRegistry(),
        startingWaveIndex: -1,
      }),
    ).toThrow(/out of range/);
  });
});

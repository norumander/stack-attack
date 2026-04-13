import { describe, expect, it } from "vitest";
import { TDTrafficSource } from "@modes/td/td-traffic-source.js";
import { WAVE_1 } from "@modes/td/td-waves.js";
import { makeRng } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids.js";

describe("TDTrafficSource self-counting", () => {
  it("isExhausted is false on a fresh source", () => {
    const source = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    expect(source.isExhausted()).toBe(false);
  });

  it("isExhausted becomes true after wave.duration generate() calls", () => {
    const source = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    for (let i = 0; i < WAVE_1.duration; i++) {
      source.generate(i);
    }
    expect(source.isExhausted()).toBe(true);
  });

  it("generate returns empty after exhaustion regardless of tick arg", () => {
    const source = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    for (let i = 0; i < WAVE_1.duration; i++) source.generate(i);
    expect(source.generate(0)).toEqual([]);
    expect(source.generate(99999)).toEqual([]);
  });

  it("a fresh source for the same wave starts at ticksGenerated=0 regardless of tick arg", () => {
    // First source exhausts
    const s1 = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    for (let i = 0; i < WAVE_1.duration; i++) s1.generate(i);
    expect(s1.isExhausted()).toBe(true);

    // Second source for the same wave, called with a high tick value (simulating
    // multi-wave campaign where state.currentTick is already past wave.duration)
    const s2 = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "entry" as ComponentId,
      rng: makeRng(1),
    });
    expect(s2.isExhausted()).toBe(false);
    const batch = s2.generate(99999);
    expect(batch.length).toBe(WAVE_1.intensity);
    expect(s2.isExhausted()).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { TDTrafficSource, buildTypeSchedule } from "@modes/td/td-traffic-source";
import { WAVE_1, WAVE_2, WAVE_3, type TDWaveDefinition } from "@modes/td/td-waves";
import { makeRng } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";

describe("TDTrafficSource: one type per tick", () => {
  it("all requests in a single tick share the same type", () => {
    // Wave 2 is 70% reads / 30% writes — with pre-change per-request
    // sampling, a tick would see a mix. Now it must be uniform.
    const src = new TDTrafficSource({
      wave: WAVE_2,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    for (let t = 0; t < WAVE_2.duration; t++) {
      const reqs = src.generate(t);
      expect(reqs.length).toBe(WAVE_2.intensity);
      const types = new Set(reqs.map((r) => r.type));
      expect(types.size).toBe(1);
    }
  });

  it("composition ratio converges exactly across the wave (stratified rounding)", () => {
    const src = new TDTrafficSource({
      wave: WAVE_2,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const tickTypes: string[] = [];
    for (let t = 0; t < WAVE_2.duration; t++) {
      const reqs = src.generate(t);
      tickTypes.push(reqs[0]!.type);
    }
    const readTicks = tickTypes.filter((t) => t === "api_read").length;
    const writeTicks = tickTypes.filter((t) => t === "api_write").length;
    // 30 × 0.7 = 21 read ticks; 30 × 0.3 = 9 write ticks.
    expect(readTicks).toBe(21);
    expect(writeTicks).toBe(9);
    expect(readTicks + writeTicks).toBe(WAVE_2.duration);
  });

  it("schedule is shuffled (not clustered) to avoid long single-type runs", () => {
    // Wave 3 has 21 reads + 9 writes ticks. Unshuffled it would be
    // 21 consecutive reads then 9 consecutive writes, with a single
    // run boundary. A shuffled schedule produces interleaved ticks.
    const schedule = buildTypeSchedule(WAVE_3, makeRng(42));
    expect(schedule.length).toBe(WAVE_3.duration);
    // Count the number of transitions (type changes between consecutive ticks).
    let transitions = 0;
    for (let i = 1; i < schedule.length; i++) {
      if (schedule[i] !== schedule[i - 1]) transitions += 1;
    }
    // Unshuffled would have exactly 1 transition. Any Fisher-Yates
    // shuffle of a 21R/9W bag should produce many more transitions
    // than that — at least 5 is a very loose floor.
    expect(transitions).toBeGreaterThan(5);
  });

  it("same RNG seed produces the same schedule (deterministic)", () => {
    const s1 = buildTypeSchedule(WAVE_2, makeRng(7));
    const s2 = buildTypeSchedule(WAVE_2, makeRng(7));
    expect(s1).toEqual(s2);
  });

  it("100%-single-type wave produces all ticks of that type", () => {
    const schedule = buildTypeSchedule(WAVE_1, makeRng(1));
    expect(schedule.length).toBe(WAVE_1.duration);
    expect(schedule.every((t) => t === "api_read")).toBe(true);
  });

  it("handles a degenerate duration=0 wave", () => {
    const wave: TDWaveDefinition = { ...WAVE_1, duration: 0 };
    expect(buildTypeSchedule(wave, makeRng(1))).toEqual([]);
  });
});

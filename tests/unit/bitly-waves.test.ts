import { describe, it, expect } from "vitest";
import { BITLY_WAVES } from "../../src/physics-td/bitly-waves";

describe("BITLY_WAVES shape", () => {
  it("has exactly 4 waves", () => {
    expect(BITLY_WAVES.length).toBe(4);
  });

  it("ids are unique and bw-prefixed in order", () => {
    const ids = BITLY_WAVES.map((w) => w.id);
    expect(ids).toEqual(["bw1", "bw2", "bw3", "bw4"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each wave has briefing, sla, budget, and a WaveDef", () => {
    for (const w of BITLY_WAVES) {
      expect(typeof w.title).toBe("string");
      expect(w.title.length).toBeGreaterThan(0);
      expect(typeof w.briefing).toBe("string");
      expect(w.briefing.length).toBeGreaterThan(0);
      expect(w.sla.availability).toBeGreaterThan(0);
      expect(w.sla.availability).toBeLessThanOrEqual(1);
      expect(w.sla.maxAvgLatencySeconds).toBeGreaterThan(0);
      expect(w.sla.maxDropRate).toBeGreaterThan(0);
      expect(w.startBudget).toBeGreaterThan(0);
      expect(w.wave.duration).toBeGreaterThan(0);
      expect(w.wave.intensity).toBeGreaterThan(0);
    }
  });

  it("intensity monotonically non-decreasing across waves", () => {
    for (let i = 1; i < BITLY_WAVES.length; i += 1) {
      expect(BITLY_WAVES[i]!.wave.intensity).toBeGreaterThanOrEqual(
        BITLY_WAVES[i - 1]!.wave.intensity,
      );
    }
  });

  it("wave 2 uses a hot zipf distribution (Reddit Front Page)", () => {
    const w2 = BITLY_WAVES[1]!;
    expect(w2.wave.keyDistribution.kind).toBe("zipf");
    if (w2.wave.keyDistribution.kind === "zipf") {
      expect(w2.wave.keyDistribution.alpha).toBeGreaterThanOrEqual(1.4);
    }
  });

  it("wave 3 has asyncRatio >= 0.15 for analytics pipeline", () => {
    expect(BITLY_WAVES[2]!.wave.composition.asyncRatio).toBeGreaterThanOrEqual(0.15);
  });

  it("wave 4 has a zoneDistribution covering multiple zones", () => {
    const zd = BITLY_WAVES[3]!.wave.zoneDistribution;
    expect(zd).toBeDefined();
    expect((zd as ReadonlyMap<string, number>).size).toBeGreaterThanOrEqual(3);
  });
});

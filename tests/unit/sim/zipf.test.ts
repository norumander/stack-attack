import { describe, it, expect } from "vitest";
import { makeZipfSampler } from "@sim/zipf";
import { makeSimRng } from "@sim/rng";

describe("makeZipfSampler", () => {
  it("returns integers in [0, spaceSize)", () => {
    const rng = makeSimRng(1);
    const sample = makeZipfSampler({ alpha: 1.07, spaceSize: 10 });
    for (let i = 0; i < 100; i += 1) {
      const k = sample(rng());
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(10);
      expect(Number.isInteger(k)).toBe(true);
    }
  });

  it("produces a skewed distribution: key 0 is most frequent", () => {
    const rng = makeSimRng(7);
    const sample = makeZipfSampler({ alpha: 1.5, spaceSize: 10 });
    const counts = new Array(10).fill(0) as number[];
    for (let i = 0; i < 10_000; i += 1) {
      counts[sample(rng())]! += 1;
    }
    const max = Math.max(...counts);
    expect(counts[0]).toBe(max);
    expect(counts[0]!).toBeGreaterThan(counts[9]! * 3);
  });

  it("is deterministic given the same RNG draws", () => {
    const rngA = makeSimRng(42);
    const rngB = makeSimRng(42);
    const sample = makeZipfSampler({ alpha: 1.07, spaceSize: 100 });
    const seqA = Array.from({ length: 50 }, () => sample(rngA()));
    const seqB = Array.from({ length: 50 }, () => sample(rngB()));
    expect(seqA).toEqual(seqB);
  });
});

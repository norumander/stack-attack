import { describe, it, expect } from "vitest";
import { makeSimRng } from "@sim/rng";

describe("makeSimRng", () => {
  it("produces deterministic sequences for identical seeds", () => {
    const a = makeSimRng(42);
    const b = makeSimRng(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces divergent sequences for different seeds", () => {
    const a = makeSimRng(1);
    const b = makeSimRng(2);
    const valA = a();
    const valB = b();
    expect(valA).not.toBe(valB);
  });

  it("outputs values in [0, 1)", () => {
    const rng = makeSimRng(99);
    for (let i = 0; i < 100; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

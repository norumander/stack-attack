import { describe, it, expect } from "vitest";
import { createRng } from "@core/engine/rng";

describe("DeterministicRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-1");
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");
    expect(a.next()).not.toBe(b.next());
  });

  it("next() returns a float in [0, 1)", () => {
    const rng = createRng("seed");
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt(n) returns an int in [0, n)", () => {
    const rng = createRng("seed");
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it("fork(tag) derives deterministic child RNGs independent of parent advance", () => {
    const parentA = createRng("seed");
    const childA = parentA.fork("child");
    const parentB = createRng("seed");
    // Advance parentB — should not affect a freshly forked child.
    parentB.next();
    parentB.next();
    const childB = parentB.fork("child");
    expect(childA.next()).toBe(childB.next());
    expect(childA.next()).toBe(childB.next());
  });
});

import { describe, it, expect } from "vitest";
import { Viability, DAMAGE_PER_FAILURE } from "../../../../src/physics-td/viability";

describe("Viability", () => {
  it("starts full at 100", () => {
    const v = new Viability();
    expect(v.value).toBe(100);
    expect(v.fraction).toBe(1);
    expect(v.isDead).toBe(false);
  });

  it("damage decreases value", () => {
    const v = new Viability();
    v.damage(30);
    expect(v.value).toBe(70);
    expect(v.fraction).toBeCloseTo(0.7);
  });

  it("clamps at zero and flags dead", () => {
    const v = new Viability();
    v.damage(500);
    expect(v.value).toBe(0);
    expect(v.isDead).toBe(true);
  });

  it("ignores non-positive damage", () => {
    const v = new Viability();
    v.damage(0);
    v.damage(-5);
    expect(v.value).toBe(100);
  });

  it("DAMAGE_PER_FAILURE is a positive number", () => {
    expect(DAMAGE_PER_FAILURE).toBeGreaterThan(0);
  });
});

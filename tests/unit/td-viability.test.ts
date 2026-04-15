import { describe, it, expect } from "vitest";
import { TDViability } from "@modes/td/td-viability";

describe("TDViability", () => {
  it("starts at 100 by default", () => {
    const v = new TDViability();
    expect(v.value).toBe(100);
    expect(v.maxValue).toBe(100);
    expect(v.fraction).toBe(1);
    expect(v.isDead).toBe(false);
  });

  it("accepts a custom initial and max", () => {
    const v = new TDViability(50, 200);
    expect(v.value).toBe(50);
    expect(v.maxValue).toBe(200);
    expect(v.fraction).toBe(0.25);
    expect(v.isDead).toBe(false);
  });

  it("damage subtracts from value", () => {
    const v = new TDViability(100);
    v.damage(30);
    expect(v.value).toBe(70);
    expect(v.fraction).toBe(0.7);
  });

  it("damage clamps at 0", () => {
    const v = new TDViability(10);
    v.damage(50);
    expect(v.value).toBe(0);
    expect(v.fraction).toBe(0);
    expect(v.isDead).toBe(true);
  });

  it("ignores negative damage amounts", () => {
    const v = new TDViability(50);
    v.damage(-20);
    expect(v.value).toBe(50);
  });

  it("supports fractional damage", () => {
    const v = new TDViability(100);
    v.damage(0.5);
    v.damage(0.3);
    expect(v.value).toBeCloseTo(99.2);
  });

  it("isDead is true when value reaches exactly 0", () => {
    const v = new TDViability(10);
    v.damage(10);
    expect(v.isDead).toBe(true);
  });

  it("isDead is false at 0.01", () => {
    const v = new TDViability(0.01);
    expect(v.isDead).toBe(false);
  });
});

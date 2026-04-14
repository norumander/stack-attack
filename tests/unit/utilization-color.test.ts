import { describe, it, expect } from "vitest";
import { utilizationColor } from "../../src/dashboard/render/utilization-color.js";

describe("utilizationColor", () => {
  it("returns pure green at utilization 0 (healthy)", () => {
    expect(utilizationColor(0)).toBe(0x22c55e);
  });

  it("returns yellow-ish at utilization 0.7", () => {
    const c = utilizationColor(0.7);
    const r = (c >> 16) & 0xff;
    const g = (c >> 8) & 0xff;
    const b = c & 0xff;
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeLessThan(100);
  });

  it("returns red at utilization 1.0 or above", () => {
    expect(utilizationColor(1.0)).toBe(0xef4444);
    expect(utilizationColor(1.5)).toBe(0xef4444);
  });

  it("clamps negative utilization to green", () => {
    expect(utilizationColor(-0.5)).toBe(0x22c55e);
  });
});

import { describe, it, expect } from "vitest";
import { utilizationColor } from "../../src/dashboard/render/utilization-color.js";

describe("utilizationColor", () => {
  it("returns slate gray at utilization 0 (idle/dormant)", () => {
    expect(utilizationColor(0)).toBe(0x94a3b8);
  });

  it("returns pure green at utilization 0.3 (healthy under light load)", () => {
    expect(utilizationColor(0.3)).toBe(0x22c55e);
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

  it("clamps negative utilization to gray", () => {
    expect(utilizationColor(-0.5)).toBe(0x94a3b8);
  });

  it("interpolates gray → green in the [0, 0.3] band", () => {
    // At u=0.15, color should be somewhere between gray and green —
    // with green dominating the RGB signal.
    const c = utilizationColor(0.15);
    const r = (c >> 16) & 0xff;
    const g = (c >> 8) & 0xff;
    const b = c & 0xff;
    // Midpoint of gray (148,163,184) and green (34,197,94) → (91,180,139).
    expect(r).toBeGreaterThan(70);
    expect(r).toBeLessThan(110);
    expect(g).toBeGreaterThan(160);
    expect(g).toBeLessThan(200);
  });
});

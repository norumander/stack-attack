import { describe, it, expect } from "vitest";
import { frameRects } from "../../../src/dashboard/render/cyberpunk/sprite-sheet";

describe("frameRects", () => {
  it("returns one rect for a square bitmap", () => {
    expect(frameRects(64, 64)).toEqual([{ x: 0, y: 0, w: 64, h: 64 }]);
  });

  it("slices a 3-frame horizontal sheet", () => {
    expect(frameRects(192, 64)).toEqual([
      { x: 0, y: 0, w: 64, h: 64 },
      { x: 64, y: 0, w: 64, h: 64 },
      { x: 128, y: 0, w: 64, h: 64 },
    ]);
  });

  it("slices a 2-frame horizontal sheet", () => {
    expect(frameRects(128, 64)).toEqual([
      { x: 0, y: 0, w: 64, h: 64 },
      { x: 64, y: 0, w: 64, h: 64 },
    ]);
  });

  it("throws on non-integer frame ratio", () => {
    expect(() => frameRects(100, 64)).toThrow(/ratio/);
  });
});

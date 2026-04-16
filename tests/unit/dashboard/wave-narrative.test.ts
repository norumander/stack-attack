import { describe, it, expect } from "vitest";
import {
  WAVE_NARRATIVES,
  getNarrative,
} from "../../../src/dashboard/td/wave-narrative.js";

describe("wave-narrative", () => {
  it("wave 1 has an authored narrative", () => {
    expect(getNarrative(1)).toBe(
      "Your service just went live. A trickle of users is knocking.",
    );
  });

  it("unknown wave ids return undefined", () => {
    expect(getNarrative(42)).toBeUndefined();
  });

  it("WAVE_NARRATIVES is keyed by wave id", () => {
    expect(WAVE_NARRATIVES[1]).toBeDefined();
  });
});

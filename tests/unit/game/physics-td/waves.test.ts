import { describe, it, expect } from "vitest";
import { CAMPAIGN_WAVES } from "../../../../src/physics-td/waves";

describe("CAMPAIGN_WAVES catalog", () => {
  it("includes W1, W2, W3, W4, W5 in order", () => {
    expect(CAMPAIGN_WAVES.map((w) => w.id)).toEqual(["w1", "w2", "w3", "w4", "w5"]);
  });

  it("Wave 4 carries 40% largeRatio for the CDN rescue", () => {
    const w4 = CAMPAIGN_WAVES.find((w) => w.id === "w4");
    expect(w4).toBeDefined();
    expect(w4!.wave.composition.largeRatio).toBeCloseTo(0.4);
  });

  it("Wave 1 briefing instructs Server + Database (post Data Cache redesign)", () => {
    const w1 = CAMPAIGN_WAVES.find((w) => w.id === "w1");
    expect(w1).toBeDefined();
    expect(w1!.briefing.toLowerCase()).toContain("database");
    expect(w1!.briefing.toLowerCase()).not.toContain("lone server");
    // $300 affords Server ($100) + Database ($200).
    expect(w1!.startBudget).toBeGreaterThanOrEqual(300);
  });
});

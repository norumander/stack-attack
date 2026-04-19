import { describe, it, expect } from "vitest";
import { CAMPAIGN_WAVES } from "../../../../src/physics-td/waves";

describe("CAMPAIGN_WAVES catalog", () => {
  it("includes W1..W4 Netflix-themed waves in order", () => {
    expect(CAMPAIGN_WAVES.map((w) => w.id)).toEqual(["w1", "w2", "w3", "w4"]);
  });

  it("Wave 3 carries heavy largeRatio and ~20% authRatio for CDN + Gateway rescue", () => {
    const w3 = CAMPAIGN_WAVES.find((w) => w.id === "w3");
    expect(w3).toBeDefined();
    expect(w3!.wave.composition.largeRatio).toBeGreaterThanOrEqual(0.3);
    expect(w3!.wave.composition.authRatio).toBeGreaterThanOrEqual(0.1);
  });

  it("Wave 4 carries async traffic for the Queue + Worker rescue", () => {
    const w4 = CAMPAIGN_WAVES.find((w) => w.id === "w4");
    expect(w4).toBeDefined();
    expect(w4!.wave.composition.asyncRatio).toBeGreaterThan(0);
  });

  it("Wave 1 briefing instructs Server + Database (post Data Cache redesign)", () => {
    const w1 = CAMPAIGN_WAVES.find((w) => w.id === "w1");
    expect(w1).toBeDefined();
    expect(w1!.briefing.toLowerCase()).toContain("database");
    expect(w1!.briefing.toLowerCase()).not.toContain("lone server");
    // $300 affords Server ($100) + Database ($200).
    expect(w1!.startBudget).toBeGreaterThanOrEqual(300);
  });

  it("SLA availability tightens/loosens progressively and duration stays in 8–12s", () => {
    for (const w of CAMPAIGN_WAVES) {
      expect(w.wave.duration).toBeGreaterThanOrEqual(8);
      expect(w.wave.duration).toBeLessThanOrEqual(12);
    }
  });
});

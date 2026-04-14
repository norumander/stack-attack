import { describe, it, expect } from "vitest";
import { WAVE_4 } from "@modes/td/td-waves";

describe("WAVE_4 — Marketing Adds Images", () => {
  it("has correct id, name, and starting budget", () => {
    expect(WAVE_4.id).toBe(4);
    expect(WAVE_4.name).toBe("Marketing Adds Images");
    expect(WAVE_4.startingBudget).toBe(700);
  });

  it("composition is 40% api_read / 20% api_write / 40% static_asset", () => {
    expect(WAVE_4.composition.get("api_read")).toBeCloseTo(0.4);
    expect(WAVE_4.composition.get("api_write")).toBeCloseTo(0.2);
    expect(WAVE_4.composition.get("static_asset")).toBeCloseTo(0.4);
  });

  it("includes cdn in availableComponents", () => {
    expect(WAVE_4.availableComponents).toContain("cdn");
  });

  it("revenue table includes static_asset at 0.3", () => {
    expect(WAVE_4.revenuePerRequestType.get("static_asset")).toBe(0.3);
  });

  it("has SLA gate at availability 0.92, max latency 6", () => {
    expect(WAVE_4.sla?.availabilityTarget).toBe(0.92);
    expect(WAVE_4.sla?.maxAvgLatency).toBe(6);
  });
});

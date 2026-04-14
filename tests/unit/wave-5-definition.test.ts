import { describe, it, expect } from "vitest";
import { WAVE_5 } from "@modes/td/td-waves";

describe("WAVE_5 — The Authentication Wall", () => {
  it("has correct id, name, and starting budget", () => {
    expect(WAVE_5.id).toBe(5);
    expect(WAVE_5.name).toBe("The Authentication Wall");
    expect(WAVE_5.startingBudget).toBe(800);
  });

  it("composition includes auth_required at 0.2", () => {
    expect(WAVE_5.composition.get("auth_required")).toBeCloseTo(0.2);
    expect(WAVE_5.composition.get("static_asset")).toBeCloseTo(0.3);
    expect(WAVE_5.composition.get("api_read")).toBeCloseTo(0.3);
  });

  it("includes api_gateway in availableComponents", () => {
    expect(WAVE_5.availableComponents).toContain("api_gateway");
    expect(WAVE_5.availableComponents).toContain("cdn");
  });

  it("revenue table includes auth_required at 1.5", () => {
    expect(WAVE_5.revenuePerRequestType.get("auth_required")).toBe(1.5);
  });

  it("has SLA with maxAvgLatency 7", () => {
    expect(WAVE_5.sla?.maxAvgLatency).toBe(7);
  });

  it("intensity is 150", () => {
    expect(WAVE_5.intensity).toBe(150);
  });
});

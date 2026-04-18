import { describe, it, expect } from "vitest";
import {
  computeLoad,
  describeTraffic,
  describeReward,
} from "../../../src/dashboard/physics-td/briefing-text.js";

describe("computeLoad", () => {
  it.each([
    [1, 1, "LIGHT"],
    [15, 1, "LIGHT"],
    [16, 2, "STEADY"],
    [50, 2, "STEADY"],
    [51, 3, "HEAVY"],
    [150, 3, "HEAVY"],
    [151, 4, "PEAK"],
    [500, 4, "PEAK"],
    [501, 5, "EXTREME"],
    [10000, 5, "EXTREME"],
  ])("intensity=%i → %i dot(s) %s", (intensity, dots, label) => {
    expect(computeLoad(intensity)).toEqual({ dots, label });
  });
});

describe("describeTraffic", () => {
  it("100% api_read → 'A handful of readers'", () => {
    expect(describeTraffic(new Map([["api_read", 1.0]]))).toBe(
      "A handful of readers",
    );
  });

  it("api_read + api_write → 'Readers and contributors'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.7], ["api_write", 0.3]])),
    ).toBe("Readers and contributors");
  });

  it("contains static_asset → 'Readers and asset traffic'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.5], ["static_asset", 0.5]])),
    ).toBe("Readers and asset traffic");
  });

  it("contains auth_required → 'Sign-ins and reads'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.8], ["auth_required", 0.2]])),
    ).toBe("Sign-ins and reads");
  });

  it("contains stream → 'Viewers tuning in'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.3], ["stream", 0.7]])),
    ).toBe("Viewers tuning in");
  });

  it("contains batch → 'Background jobs and reads'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.6], ["batch", 0.4]])),
    ).toBe("Background jobs and reads");
  });

  it("unknown shape falls back to 'Mixed traffic'", () => {
    expect(describeTraffic(new Map([["api_read", 0.5], ["event", 0.5]]))).toBe(
      "Mixed traffic",
    );
  });
});

describe("describeReward", () => {
  it("single type → '$N per user served'", () => {
    expect(describeReward(new Map([["api_read", 1]]))).toBe(
      "$1 per user served",
    );
  });

  it("mixed → range '$low–$high per user served'", () => {
    expect(
      describeReward(new Map([["api_read", 1], ["api_write", 2]])),
    ).toBe("$1–$2 per user served");
  });
});


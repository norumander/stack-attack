import { describe, it, expect } from "vitest";
import {
  computeSlaPenalty,
  SLA_PENALTY_CAP,
} from "../../../../src/physics-td/wave-penalty";

const baseSla = { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 };

describe("computeSlaPenalty", () => {
  it("zero penalty when SLA is met", () => {
    const result = computeSlaPenalty(
      {
        totalPackets: 100,
        responded: 95,
        terminated: 0,
        drops: 5,
        avgLatencySeconds: 1.5,
        totalRevenue: 95,
      },
      baseSla,
    );
    expect(result.dollars).toBe(0);
    expect(result.actualAvailability).toBeCloseTo(0.95);
  });

  it("$10 per percentage point of availability shortfall", () => {
    // 80% served, target 90% → 10 points short → $100
    const result = computeSlaPenalty(
      {
        totalPackets: 100,
        responded: 80,
        terminated: 0,
        drops: 20,
        avgLatencySeconds: 1,
        totalRevenue: 80,
      },
      baseSla,
    );
    expect(result.dollars).toBe(100);
  });

  it("charges for latency overshoot on top of availability", () => {
    // 85% avail (5 pts short → $50) and 3s latency vs 2s target (50% over → $500, but combined caps)
    const result = computeSlaPenalty(
      {
        totalPackets: 100,
        responded: 85,
        terminated: 0,
        drops: 15,
        avgLatencySeconds: 3,
        totalRevenue: 85,
      },
      baseSla,
    );
    expect(result.dollars).toBe(SLA_PENALTY_CAP);
  });

  it("caps the penalty", () => {
    const result = computeSlaPenalty(
      {
        totalPackets: 100,
        responded: 0,
        terminated: 0,
        drops: 100,
        avgLatencySeconds: 10,
        totalRevenue: 0,
      },
      baseSla,
    );
    expect(result.dollars).toBe(SLA_PENALTY_CAP);
  });
});

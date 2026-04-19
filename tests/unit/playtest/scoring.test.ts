import { describe, it, expect } from "vitest";
import { scoreResult, type ScoringInputs } from "../../../src/playtest/scoring";
import type { SLAThresholds } from "@sim/sla";

const SLA: SLAThresholds = {
  availability: 0.9,
  maxAvgLatencySeconds: 2,
  maxDropRate: 0.1,
};

function base(): ScoringInputs {
  return {
    totalCost: 300,
    startBudget: 500,
    topologyErrors: [],
    availability: 0.98,
    avgLatencySeconds: 0.5,
    dropRate: 0.01,
    revenue: 100,
    expectedBaselineRevenue: 100,
    sla: SLA,
  };
}

describe("scoreResult", () => {
  it("invalid verdict when topology errors present — skips SLA checks, score 0", () => {
    const out = scoreResult({
      ...base(),
      topologyErrors: [{
        requestType: "api_read",
        componentId: "x" as never,
        componentType: "server",
        reason: "no_handler",
      }],
    });
    expect(out.verdict).toBe("invalid");
    expect(out.score).toBe(0);
    expect(out.slaPass).toBe(false);
  });

  it("fail verdict when availability below SLA", () => {
    const out = scoreResult({ ...base(), availability: 0.5 });
    expect(out.verdict).toBe("fail");
    expect(out.score).toBe(0);
  });

  it("fail verdict when avgLatency above max", () => {
    const out = scoreResult({ ...base(), avgLatencySeconds: 3 });
    expect(out.verdict).toBe("fail");
  });

  it("fail verdict when dropRate above max", () => {
    const out = scoreResult({ ...base(), dropRate: 0.5 });
    expect(out.verdict).toBe("fail");
  });

  it("marginal verdict when drop > 60% of max even though SLA passes", () => {
    // maxDropRate = 0.1; 0.08 > 0.06 → marginal. Availability stays high.
    const out = scoreResult({ ...base(), dropRate: 0.08 });
    expect(out.verdict).toBe("marginal");
    expect(out.slaPass).toBe(true);
  });

  it("marginal verdict when latency > 80% of max", () => {
    // maxLat = 2; 1.9 > 1.6 → marginal.
    const out = scoreResult({ ...base(), avgLatencySeconds: 1.9 });
    expect(out.verdict).toBe("marginal");
  });

  it("pass verdict when well inside thresholds", () => {
    const out = scoreResult(base());
    expect(out.verdict).toBe("pass");
    expect(out.slaPass).toBe(true);
    expect(out.score).toBeGreaterThan(0);
  });

  it("score monotonicity: cheaper solution beats expensive one with equal SLA margins", () => {
    const cheap = scoreResult({ ...base(), totalCost: 200 });
    const expensive = scoreResult({ ...base(), totalCost: 450 });
    expect(cheap.score).toBeGreaterThan(expensive.score);
  });

  it("score monotonicity: higher availability beats lower (all else equal)", () => {
    const hi = scoreResult({ ...base(), availability: 0.99 });
    const lo = scoreResult({ ...base(), availability: 0.93 });
    expect(hi.score).toBeGreaterThan(lo.score);
  });

  it("score monotonicity: lower latency beats higher", () => {
    const fast = scoreResult({ ...base(), avgLatencySeconds: 0.2 });
    const slow = scoreResult({ ...base(), avgLatencySeconds: 1.0 });
    expect(fast.score).toBeGreaterThan(slow.score);
  });
});

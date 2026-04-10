import { describe, it, expect } from "vitest";
import type {
  BuildConstraints,
  PlacementResult,
  UpgradeResult,
} from "@core/types/build-constraints";
import type { TickMetrics } from "@core/types/metrics";
import type { OutcomeReport } from "@core/types/outcome";
import type { ComponentId } from "@core/types/ids";

describe("mode boundary types", () => {
  it("PlacementResult narrows ok/fail", () => {
    const ok: PlacementResult = { ok: true, componentId: "c-1" as ComponentId };
    const fail: PlacementResult = { ok: false, reason: "insufficient_budget" };
    if (ok.ok) expect(ok.componentId).toBe("c-1");
    if (!fail.ok) expect(fail.reason).toBe("insufficient_budget");
  });

  it("UpgradeResult narrows ok/fail", () => {
    const ok: UpgradeResult = { ok: true, newPlayerTier: 2 };
    if (ok.ok) expect(ok.newPlayerTier).toBe(2);
  });

  it("BuildConstraints has available types", () => {
    const c: BuildConstraints = { availableComponentTypes: ["server", "database"] };
    expect(c.availableComponentTypes).toHaveLength(2);
  });

  it("TickMetrics is a full record", () => {
    const m: TickMetrics = {
      tick: 0,
      requestsProcessed: 0,
      requestsResolved: 0,
      requestsDropped: 0,
      requestsOverloaded: 0,
      requestsBackpressured: 0,
      requestsTimedOut: 0,
      revenueEarned: 0,
      upkeepPaid: 0,
      avgLatency: 0,
      perComponent: new Map(),
    };
    expect(m.tick).toBe(0);
  });

  it("OutcomeReport has a verdict", () => {
    const o: OutcomeReport = {
      verdict: "win",
      score: { cost: 10, performance: 90, reliability: 95, composite: 85 },
      notes: [],
    };
    expect(o.verdict).toBe("win");
  });
});

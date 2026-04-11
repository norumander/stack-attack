import { describe, it, expect } from "vitest";
import type { TickMetrics } from "@core/types/metrics";
import type { ComponentId } from "@core/types/ids";

describe("TickMetrics Stage 2a shape", () => {
  it("per-component entry carries timedOut, pendingAtEndOfTick, blockedAtEndOfTick", () => {
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
      perComponent: new Map([
        [
          "c1" as ComponentId,
          {
            processed: 0,
            dropped: 0,
            overloaded: 0,
            backpressured: 0,
            condition: 1.0,
            timedOut: 0,
            pendingAtEndOfTick: 0,
            blockedAtEndOfTick: 0,
          },
        ],
      ]),
    };
    const entry = m.perComponent.get("c1" as ComponentId)!;
    expect(entry.timedOut).toBe(0);
    expect(entry.pendingAtEndOfTick).toBe(0);
    expect(entry.blockedAtEndOfTick).toBe(0);
  });
});

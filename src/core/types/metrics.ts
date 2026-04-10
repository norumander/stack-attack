import type { ComponentId } from "./ids.js";

export interface TickMetrics {
  readonly tick: number;
  readonly requestsProcessed: number;
  readonly requestsResolved: number;
  readonly requestsDropped: number;
  readonly requestsOverloaded: number;
  readonly requestsBackpressured: number;
  readonly requestsTimedOut: number;
  readonly revenueEarned: number;
  readonly upkeepPaid: number;
  readonly avgLatency: number;
  readonly perComponent: ReadonlyMap<
    ComponentId,
    {
      processed: number;
      dropped: number;
      overloaded: number;
      backpressured: number;
      condition: number;
    }
  >;
}

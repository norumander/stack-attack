import type { SimulationState } from "../state/simulation-state.js";
import { getOrInitCounters } from "./metrics-counters.js";
import { applyStrictCascade } from "./cascade.js";

/**
 * Step 5 of the simulation tick: CHECK TTL — pending location scan.
 *
 * Walks visitOrder; for each component's pending queue, filters out requests
 * whose TTL has elapsed (createdAt + ttl <= currentTick), removes them,
 * appends a TIMED_OUT event, increments the per-component timeout counter,
 * and fires applyStrictCascade to propagate the failure to any blocking parent.
 *
 * Mutation safety: uses a filter-based rebuild (survivors array) rather than
 * in-place splice so that FIFO order is preserved for non-expired requests.
 *
 * Task 27 will extend this file with blocked-pool and bufferable scans plus
 * the down-cascade path.
 */
export function checkTTL(state: SimulationState): void {
  for (const componentId of state.visitOrder) {
    const queue = state.pending.get(componentId);
    if (!queue || queue.length === 0) continue;

    const survivors: typeof queue = [];
    const expired: typeof queue = [];

    for (const req of queue) {
      if (req.createdAt + req.ttl <= state.currentTick) {
        expired.push(req);
      } else {
        survivors.push(req);
      }
    }

    if (expired.length === 0) continue;

    state.pending.set(componentId, survivors);

    for (const req of expired) {
      state.appendEvent(req.id, {
        tick: state.currentTick,
        componentId,
        capabilityId: null,
        connectionId: null,
        type: "TIMED_OUT",
        latencyAdded: 0,
      });
      getOrInitCounters(state, componentId).timeouts += 1;
      applyStrictCascade(state, req.id);
    }
  }
}

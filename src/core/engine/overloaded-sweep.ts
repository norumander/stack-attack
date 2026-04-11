import type { SimulationState } from "../state/simulation-state.js";
import { getOrInitCounters } from "./metrics-counters.js";

export function sweepOverloaded(state: SimulationState): void {
  for (const componentId of state.visitOrder) {
    const pending = state.pending.get(componentId);
    if (!pending || pending.length === 0) continue;

    const counters = getOrInitCounters(state, componentId);
    counters.overloaded += pending.length;

    for (const req of pending) {
      state.appendEvent(req.id, {
        tick: state.currentTick,
        componentId,
        capabilityId: null,
        connectionId: null,
        type: "OVERLOADED",
        latencyAdded: 0,
      });
    }
    // Leftovers remain in pending for next tick.
  }
}

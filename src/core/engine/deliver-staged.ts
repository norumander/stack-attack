import type { SimulationState } from "../state/simulation-state.js";
import type { StagedOutcome } from "./staged-outcome.js";
import { getOrInitCounters } from "./metrics-counters.js";

export function deliverStaged(
  state: SimulationState,
  staged: StagedOutcome,
): boolean {
  const { sourceComponentId, request, result } = staged;
  for (const e of result.events) state.appendEvent(request.id, e);

  switch (result.outcome.kind) {
    case "DROP":
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: sourceComponentId,
        capabilityId: null,
        connectionId: null,
        type: "DROPPED",
        latencyAdded: 0,
        metadata: { reason: result.outcome.reason },
      });
      getOrInitCounters(state, sourceComponentId).drops += 1;
      return true;
    default:
      return false; // other outcome kinds added in later tasks (12-18)
  }
}

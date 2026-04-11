import type { SimulationState } from "../state/simulation-state.js";
import { IllegalStateError } from "./errors.js";

export function resetPerTickState(state: SimulationState): void {
  // (2) Sanity check: stagedOutcomes should have been drained by the fixed-point loop.
  if (state.stagedOutcomes.length > 0) {
    throw new IllegalStateError(
      `resetPerTickState: stagedOutcomes non-empty (${state.stagedOutcomes.length} entries). ` +
        `deliverStaged should have drained them during step 3. This indicates a bug in the ` +
        `fixed-point loop or an outcome handler that returned without consuming its entry.`,
    );
  }

  // (1) Clear per-tick counter bag.
  state.perComponentThisTick.clear();

  // (3) Let each capability reset its per-tick state via the Component wrapper.
  for (const component of state.components.values()) {
    component.resetPerTickState();
  }

  // (4) Clear per-tick connection bandwidth load; zero Connection.currentLoad to match.
  state.connectionLoadThisTick.clear();
  for (const conn of state.connections.values()) {
    conn.currentLoad = 0;
  }
}

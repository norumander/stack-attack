import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";

// Step 6: update component health/condition based on failures this tick.
// Bad tick (drops + timeouts + overloaded + backpressured > 0) decays by
// profile.decayRate; otherwise recover by profile.recoveryRate. setCondition
// clamps to [0, 1]. Iterates state.visitOrder for determinism.
export function updateCondition(
  state: SimulationState,
  _modeController: ModeController,
): void {
  for (const id of state.visitOrder) {
    const comp = state.components.get(id);
    if (!comp) continue;
    const counters = state.perComponentThisTick.get(id);
    const badTick =
      counters !== undefined &&
      counters.drops + counters.timeouts + counters.overloaded + counters.backpressured > 0;
    const delta = badTick
      ? -comp.conditionProfile.decayRate
      : comp.conditionProfile.recoveryRate;
    state.setCondition(id, comp.condition + delta);
  }
}

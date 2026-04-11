import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";

// Step 6: update component health/condition based on failures this tick.
// TODO(stage-2b): apply degradation/recovery from conditionProfile.
export function updateCondition(
  _state: SimulationState,
  _modeController: ModeController,
): void {
  // no-op in 2a
}

// Step 6b: fire scheduled chaos events from the mode controller.
// TODO(stage-2b): read modeController.getScheduledChaos(currentTick) and apply.
export function injectChaos(
  _state: SimulationState,
  _modeController: ModeController,
): void {
  // no-op in 2a
}

// Step 7: deduct component upkeep from the budget.
// TODO(stage-2b): sum getUpkeepCost() across components and deduct from economy.
export function deductUpkeep(
  _state: SimulationState,
  _modeController: ModeController,
): void {
  // no-op in 2a
}

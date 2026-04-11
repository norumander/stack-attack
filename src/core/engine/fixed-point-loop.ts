import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import { processPending } from "./process-pending.js";
import { deliverStaged } from "./deliver-staged.js";
import { FIXED_POINT_CAP } from "./constants.js";
import { FixedPointRunaway } from "./errors.js";

export function runFixedPointLoop(
  state: SimulationState,
  modeController: ModeController,
): void {
  for (let iter = 0; iter < FIXED_POINT_CAP; iter++) {
    const processed = processPending(state, modeController);

    let delivered = false;
    while (state.stagedOutcomes.length > 0) {
      const staged = state.stagedOutcomes.shift()!;
      if (deliverStaged(state, staged)) delivered = true;
    }

    if (!processed && !delivered) return;
  }
  throw new FixedPointRunaway(state, FIXED_POINT_CAP);
}

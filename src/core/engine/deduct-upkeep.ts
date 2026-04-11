import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import { computeEffectiveTiers } from "../component/effective-tier.js";
import { getUpkeepMultiplier } from "./condition-effects.js";

// Step 7: deduct component upkeep from the budget.
// Sums getUpkeepCost() * condition-based multiplier across all components,
// debits the economy, and forces insolvent components to condition=0.
export function deductUpkeep(
  state: SimulationState,
  mc: ModeController,
): void {
  let total = 0;
  for (const comp of state.components.values()) {
    const activeCaps = mc.getActiveCapabilities(comp);
    const effectiveTiers = computeEffectiveTiers(comp, mc);
    const baseCost = comp.getUpkeepCost(activeCaps, effectiveTiers);
    const mult = getUpkeepMultiplier(comp);
    total += baseCost * mult;
  }

  mc.economy.debitUpkeep(total);
  state.upkeepPaidThisTick = total;

  const insolventIds = mc.economy.resolveInsolvency(state.asReader());
  for (const id of insolventIds) {
    state.setCondition(id, 0);
  }
}

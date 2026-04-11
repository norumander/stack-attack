import type { ComponentId } from "../types/ids.js";
import type { SimulationState } from "../state/simulation-state.js";
import type { PerComponentTickCounters } from "./per-component-counters.js";

export function getOrInitCounters(
  state: SimulationState,
  componentId: ComponentId,
): PerComponentTickCounters {
  let c = state.perComponentThisTick.get(componentId);
  if (!c) {
    c = { processed: 0, drops: 0, timeouts: 0, overloaded: 0, backpressured: 0 };
    state.perComponentThisTick.set(componentId, c);
  }
  return c;
}

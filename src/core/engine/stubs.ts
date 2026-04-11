import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { ChaosEvent } from "../types/chaos.js";
import { computeEffectiveTiers } from "../component/effective-tier.js";
import { getUpkeepMultiplier } from "./condition-effects.js";

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

function chaosKey(event: ChaosEvent): string {
  switch (event.kind) {
    case "component_failure": return `component:${event.componentId}`;
    case "zone_outage":        return `zone:${event.zone}`;
    case "connection_sever":   return `sever:${event.connectionId}`;
    case "latency_injection":  return `latency:${event.connectionId}`;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function computeExpiry(event: ChaosEvent, tick: number): number {
  switch (event.kind) {
    case "component_failure": return tick + 1;
    case "zone_outage":
    case "connection_sever":
    case "latency_injection":  return tick + event.durationTicks;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// Step 6b: fire scheduled chaos events from the mode controller.
export function injectChaos(
  state: SimulationState,
  mc: ModeController,
): void {
  // 1. Sweep expired entries first so same-tick re-arms can succeed.
  for (const [key, entry] of state.activeChaos) {
    if (entry.expiresAtTick <= state.currentTick) {
      state.activeChaos.delete(key);
    }
  }

  // 2. Pull new events and insert.
  const events = mc.getScheduledChaos(state.currentTick);
  for (const event of events) {
    state.activeChaos.set(chaosKey(event), {
      event,
      expiresAtTick: computeExpiry(event, state.currentTick),
    });
  }

  // 3. Re-apply instant-condition chaos across every still-active entry
  //    (not just new ones). This keeps zone_outage / component_failure
  //    pinned at 0 for the duration of the window.
  for (const entry of state.activeChaos.values()) {
    switch (entry.event.kind) {
      case "component_failure":
        state.setCondition(entry.event.componentId, 0);
        break;
      case "zone_outage": {
        const zone = entry.event.zone;
        for (const comp of state.components.values()) {
          if (comp.zone === zone) state.setCondition(comp.id, 0);
        }
        break;
      }
      // connection_sever, latency_injection are adapter-only.
    }
  }
}

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

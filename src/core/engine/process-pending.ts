import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { Component } from "../component/component.js";
import type { ProcessContext } from "../capability/process-context.js";
import type { RequestId } from "../types/ids.js";
import type { ChildResponseSnapshot } from "./blocked-parent.js";
import { componentThroughputPerTick } from "./throughput.js";
import { computeEffectiveTiers } from "../component/effective-tier.js";
import { createRng } from "./rng.js";
import {
  getThroughputMultiplier,
  getDropProbability,
} from "./condition-effects.js";
import { getOrInitCounters } from "./metrics-counters.js";

export function buildProcessContext(
  state: SimulationState,
  component: Component,
  modeController: ModeController,
  childResponses: ReadonlyMap<RequestId, ChildResponseSnapshot>,
): ProcessContext {
  return {
    state: state.asReader(),
    componentId: component.id,
    effectiveTier: 0,
    effectiveTiers: computeEffectiveTiers(component, modeController),
    activeCapabilityIds: modeController.getActiveCapabilities(component),
    currentTick: state.currentTick,
    rng: createRng(`tick-${state.currentTick}|${component.id}`),
    directories: [],
    childResponses,
  };
}

export function processPending(
  state: SimulationState,
  modeController: ModeController,
): boolean {
  let progressed = false;

  for (const componentId of state.visitOrder) {
    const component = state.components.get(componentId);
    if (!component) continue;

    const rawCap = componentThroughputPerTick(component);
    const cap = Math.max(
      0,
      rawCap === Infinity ? Infinity : Math.floor(rawCap * getThroughputMultiplier(component)),
    );

    while (true) {
      const pending = state.pending.get(componentId);
      if (!pending || pending.length === 0) break;

      const counters = state.perComponentThisTick.get(componentId);
      const processedSoFar = counters?.processed ?? 0;
      if (processedSoFar >= cap) break;

      const req = state.dequeuePending(componentId);
      if (!req) break;

      // Drop-probability roll from condition effects. Happens inside
      // the accepted throughput slice: a "lost" request still counts
      // against throughput this tick. Uses a per-request RNG stream
      // (keyed by req.id) so the roll does not consume the shared
      // component RNG used by buildProcessContext — preserving Stage 2a
      // replay determinism for healthy components (dropP = 0 = no roll).
      const dropP = getDropProbability(component);
      if (dropP > 0) {
        const rng = createRng(`tick-${state.currentTick}|${component.id}|drop|${req.id}`);
        if (rng.next() < dropP) {
          state.appendEvent(req.id, {
            tick: state.currentTick,
            componentId: component.id,
            capabilityId: null,
            connectionId: null,
            type: "DROPPED",
            latencyAdded: 0,
            metadata: { reason: "condition_drop" },
          });
          const dropCounters = getOrInitCounters(state, component.id);
          dropCounters.drops += 1;
          progressed = true;
          continue;
        }
      }

      // Look up any stashed child responses from a blocking-SPAWN re-entry.
      const stashedChildResponses =
        state.pendingChildResponses.get(req.id) ??
        (new Map() as Map<RequestId, ChildResponseSnapshot>);
      state.pendingChildResponses.delete(req.id);

      const ctx = buildProcessContext(state, component, modeController, stashedChildResponses);
      const result = component.process(req, ctx);

      state.stagedOutcomes.push({
        sourceComponentId: componentId,
        request: req,
        result,
      });
      state.incrementProcessedCount(componentId);
      progressed = true;
    }
  }

  return progressed;
}

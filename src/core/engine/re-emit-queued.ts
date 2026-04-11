import type { SimulationState } from "../state/simulation-state.js";
import { isEngineBufferable } from "../capability/engine-interfaces.js";

export function reEmitQueued(state: SimulationState): void {
  for (const componentId of state.visitOrder) {
    const component = state.components.get(componentId);
    if (!component) continue;

    // Find every EngineBufferable capability on this component (not just the first —
    // §6.2.1 doesn't restrict, but in practice there's one bufferable per component).
    for (const cap of component.capabilities.values()) {
      if (!isEngineBufferable(cap)) continue;
      const ready = cap.emitReady();

      // awaitingPipeline → tail of the component's pending queue (standard FIFO via enqueuePending)
      for (const req of ready.awaitingPipeline) {
        state.enqueuePending(componentId, req);
      }

      // awaitingDelivery → state.stagedOutcomes (tail push; queue is the conceptual source per §6.2.1)
      for (const entry of ready.awaitingDelivery) {
        state.stagedOutcomes.push({
          sourceComponentId: componentId,
          request: entry.request,
          result: entry.result,
        });
      }
    }
  }
}

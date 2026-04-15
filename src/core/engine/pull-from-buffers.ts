import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { PullContext } from "../capability/process-context.js";
import { isEnginePullable } from "../capability/engine-interfaces.js";

/**
 * Step 2.5: pull from buffers.
 * EnginePullable capabilities (Worker) pull from connected EngineBufferable (Queue).
 * Pulled requests are enqueued in the puller's pending queue for PROCESS-phase handling.
 */
export function pullFromBuffers(
  state: SimulationState,
  _modeController: ModeController,
): void {
  for (const componentId of state.visitOrder) {
    const component = state.components.get(componentId);
    if (!component) continue;

    for (const cap of component.capabilities.values()) {
      if (!isEnginePullable(cap)) continue;
      const context: PullContext = {
        state: state.asReader(),
        componentId,
        currentTick: state.currentTick,
      };
      const pulled = cap.pullPending(context);
      for (const request of pulled) {
        state.enqueuePending(componentId, request);
      }
    }
  }
}

import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";

export function injectTraffic(
  state: SimulationState,
  modeController: ModeController,
): void {
  const source = modeController.getTrafficSource();
  const subSources =
    typeof source.getSubSources === "function" ? source.getSubSources() : [source];

  for (const sub of subSources) {
    const requests = sub.generate(state.currentTick);
    const target = sub.targetEntryPointId;
    if (target === null) continue;
    for (const req of requests) {
      state.enqueuePending(target, req);
      state.appendEvent(req.id, {
        tick: state.currentTick,
        componentId: target,
        capabilityId: null,
        connectionId: null,
        type: "ENTERED",
        latencyAdded: 0,
      });
    }
  }
}

import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";

export function updateActiveStreams(
  state: SimulationState,
  _modeController: ModeController,
): void {
  // Snapshot entries up front so releaseActiveStream can safely delete during iteration.
  const streams = [...state.activeStreams.values()];
  for (const stream of streams) {
    stream.remainingDuration -= 1;
    if (stream.remainingDuration <= 0) {
      state.releaseActiveStream(stream.requestId);
      state.appendEvent(stream.requestId, {
        tick: state.currentTick,
        componentId: stream.originComponentId,
        capabilityId: null,
        connectionId: stream.connectionId,
        type: "STREAM_COMPLETED",
        latencyAdded: 0,
      });
    }
  }
}

import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { RequestId, ComponentId } from "../types/ids.js";

/**
 * Walks a request's event log backward and notifies any capability with
 * reportFailure/reportSuccess (CircuitBreakerCapability today). Failure
 * reports accumulate toward the CB's tripping threshold; success reports
 * complete the HALF_OPEN → CLOSED transition.
 *
 * Deduplicates by componentId — each component is visited once per call
 * even if it appears in multiple events.
 *
 * Duck-types via reportFailure + reportSuccess (both required) to avoid a
 * hard import dependency on CircuitBreakerCapability.
 */
export function notifyCircuitBreakers(
  state: SimulationState,
  _modeController: ModeController,
  requestId: RequestId,
  kind: "failure" | "success",
): void {
  const events = state.requestLog.get(requestId);
  if (!events || events.length === 0) return;

  const visitedComponents = new Set<ComponentId>();

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (visitedComponents.has(event.componentId)) continue;
    visitedComponents.add(event.componentId);

    const comp = state.components.get(event.componentId);
    if (!comp) continue;

    for (const cap of comp.capabilities.values()) {
      const maybeCB = cap as unknown as {
        reportFailure?: (tick: number, ctx?: { tier?: number }) => void;
        reportSuccess?: () => void;
      };
      if (typeof maybeCB.reportFailure !== "function") continue;
      if (typeof maybeCB.reportSuccess !== "function") continue;

      const tier = comp.getPlayerTier(cap.id);
      if (kind === "failure") {
        maybeCB.reportFailure(state.currentTick, { tier });
      } else {
        maybeCB.reportSuccess();
      }
    }
  }
}

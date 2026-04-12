import { isEngineConsultable } from "../capability/engine-interfaces.js";
import { getEffectiveTier } from "../component/effective-tier.js";
import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { ComponentId, ConnectionId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessContext } from "../capability/process-context.js";

export function selectEgressConnection(
  state: SimulationState,
  sourceComponentId: ComponentId,
  request: Request,
  modeController: ModeController,
): ConnectionId | null {
  const source = state.components.get(sourceComponentId);
  if (!source) return null;

  const egresses = [...state.connections.values()]
    .filter((c) => c.source.componentId === sourceComponentId)
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  if (egresses.length === 0) return null;

  const activeCapabilityIds = modeController.getActiveCapabilities(source);
  for (const cap of source.capabilities.values()) {
    if (!activeCapabilityIds.has(cap.id)) continue;
    if (isEngineConsultable(cap)) {
      const effectiveTier = getEffectiveTier(source, cap.id, modeController);

      const ctx: ProcessContext = {
        state: state.asReader(),
        componentId: sourceComponentId,
        effectiveTier,
        effectiveTiers: new Map([[cap.id, effectiveTier]]),
        activeCapabilityIds,
        currentTick: state.currentTick,
        rng: null as unknown as never,
        directories: [],
        childResponses: new Map(),
      };

      return cap.selectConnection(request, egresses, ctx);
    }
  }

  const cursor = state.roundRobinCursor.get(sourceComponentId) ?? 0;
  const chosen = egresses[cursor % egresses.length]!;
  state.roundRobinCursor.set(sourceComponentId, cursor + 1);
  return chosen.id;
}

import { isEngineConsultable } from "../capability/engine-interfaces.js";
import type { SimulationState } from "../state/simulation-state.js";
import type { ComponentId, ConnectionId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessContext } from "../capability/process-context.js";

export function selectEgressConnection(
  state: SimulationState,
  sourceComponentId: ComponentId,
  request: Request,
  ctx: ProcessContext,
): ConnectionId | null {
  const source = state.components.get(sourceComponentId);
  if (!source) return null;

  const egresses = [...state.connections.values()]
    .filter((c) => c.source.componentId === sourceComponentId)
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  if (egresses.length === 0) return null;

  for (const cap of source.capabilities.values()) {
    if (isEngineConsultable(cap)) {
      return cap.selectConnection(request, egresses, ctx);
    }
  }

  const cursor = state.roundRobinCursor.get(sourceComponentId) ?? 0;
  const chosen = egresses[cursor % egresses.length]!;
  state.roundRobinCursor.set(sourceComponentId, cursor + 1);
  return chosen.id;
}

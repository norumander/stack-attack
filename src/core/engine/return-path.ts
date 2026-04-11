import type { SimulationState } from "../state/simulation-state.js";
import type { ComponentId, ConnectionId, RequestId } from "../types/ids.js";

export interface ReturnPath {
  readonly reverseConnectionIds: ConnectionId[];
  readonly returnLatency: number;
  readonly forwardLatency: number;
}

export function reconstructReturnPath(
  state: SimulationState,
  requestId: RequestId,
): ReturnPath {
  const events = state.requestLog.get(requestId) ?? [];
  const forward: { connectionId: ConnectionId; latencyAdded: number }[] = [];
  for (const e of events) {
    if (e.type === "TRAVERSED" && e.connectionId) {
      forward.push({ connectionId: e.connectionId, latencyAdded: e.latencyAdded });
    }
  }
  const forwardLatency = forward.reduce((a, e) => a + e.latencyAdded, 0);
  const reverse = forward.slice().reverse();
  let returnLatency = 0;
  for (const e of reverse) {
    const conn = state.connections.get(e.connectionId);
    returnLatency += conn?.latency ?? 0;
  }
  return {
    reverseConnectionIds: reverse.map((e) => e.connectionId),
    returnLatency,
    forwardLatency,
  };
}

export function pickStreamConnection(
  state: SimulationState,
  requestId: RequestId,
  sourceComponentId: ComponentId,
): ConnectionId | null {
  const events = state.requestLog.get(requestId) ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "TRAVERSED" && e.connectionId) return e.connectionId;
  }
  const egresses = [...state.connections.values()]
    .filter((c) => c.source.componentId === sourceComponentId)
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  if (egresses.length === 0) return null;
  return egresses[0]!.id;
}

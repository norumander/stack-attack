import type { SimulationState } from "../state/simulation-state.js";
import type { ConnectionId } from "../types/ids.js";

export function getEffectiveBandwidth(
  state: SimulationState,
  connectionId: ConnectionId,
): number {
  const conn = state.connections.get(connectionId);
  if (!conn) return 0;
  const load = state.connectionLoadThisTick.get(connectionId) ?? 0;
  let streamLoad = 0;
  for (const s of state.activeStreams.values()) {
    if (s.connectionId === connectionId) streamLoad += s.reservedBandwidth;
  }
  return conn.bandwidth - load - streamLoad;
}

export function getEffectiveLatency(
  state: SimulationState,
  connectionId: ConnectionId,
): number {
  const conn = state.connections.get(connectionId);
  if (!conn) return 0;
  return conn.latency;
}

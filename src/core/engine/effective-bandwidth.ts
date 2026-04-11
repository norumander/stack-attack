import type { SimulationState } from "../state/simulation-state.js";
import type { ConnectionId } from "../types/ids.js";
import { getLatencyMultiplier } from "./condition-effects.js";

export function getEffectiveBandwidth(
  state: SimulationState,
  connectionId: ConnectionId,
): number {
  // Chaos check first — connection_sever forces 0 regardless of raw bandwidth.
  for (const entry of state.activeChaos.values()) {
    if (
      entry.event.kind === "connection_sever" &&
      entry.event.connectionId === connectionId
    ) {
      return 0;
    }
  }
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
  let latency = conn.latency;

  // Chaos adder first — a latency_injection matching this connection.
  // The §5.3 collapse rule keeps at most one entry per key, so we can
  // break after the first hit.
  for (const entry of state.activeChaos.values()) {
    if (
      entry.event.kind === "latency_injection" &&
      entry.event.connectionId === connectionId
    ) {
      latency += entry.event.extraLatency;
      break;
    }
  }

  // Condition multiplier: from-component's outgoing latency scales by
  // its active latency_multiplier effects.
  const fromComp = state.components.get(conn.source.componentId);
  if (fromComp) {
    latency *= getLatencyMultiplier(fromComp);
  }
  return latency;
}

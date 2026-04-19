import type { Zone } from "./types";
import type { SimComponent } from "./component";
import type { SimConnection } from "./connection";
import type { ComponentId } from "@core/types/ids";

/**
 * Zone-pair latency penalty.
 *
 * Design choice:
 * - Zone is currently `type Zone = string` (no enum, no explicit adjacency metadata
 *   in the sim types). We therefore use a single, additive cross-zone penalty.
 * - Same zone  → 0s  (intra-zone transit is "free" relative to the base edge latency).
 * - Different zone → +0.1s flat additive penalty to the connection's base latency.
 * - Unzoned endpoint (zone == null / undefined) is treated as same-zone for penalty
 *   purposes so existing topologies with no zone assignments remain unchanged.
 *
 * Rationale for 0.1s: base edge latency is 0.5s, so a cross-zone hop adds 20%,
 * which is enough to make DNS/GTM and multi-region topologies teachable without
 * breaking wave pacing in existing tests. If/when adjacency metadata is added
 * to the Zone type, tier this as 0.05s adjacent / 0.15s far.
 */
export const CROSS_ZONE_PENALTY_SECONDS = 0.1;

export function getZonePairLatency(
  from: Zone | null | undefined,
  to: Zone | null | undefined,
): number {
  if (from == null || to == null) return 0;
  if (from === to) return 0;
  return CROSS_ZONE_PENALTY_SECONDS;
}

/**
 * Effective transit speed (edge-units/sec) for a connection, incorporating the
 * cross-zone latency penalty between its endpoints' components.
 *
 * edge-physics.ts advances `progress += speed * dt`, so baking the penalty into
 * the effective speed is equivalent to adding it to the base latency:
 *   effectiveSpeed = 1 / (conn.latencySeconds + zonePairPenalty)
 */
export function effectiveEdgeSpeed(
  conn: SimConnection,
  components: ReadonlyMap<ComponentId, SimComponent>,
): number {
  const from = components.get(conn.from.componentId)?.zone ?? null;
  const to = components.get(conn.to.componentId)?.zone ?? null;
  const penalty = getZonePairLatency(from, to);
  if (penalty === 0) return conn.speed;
  return 1 / (conn.latencySeconds + penalty);
}

import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { Sim } from "@sim/sim";

/**
 * Campaign-level chaos schedule. The sim is pure and has no concept of
 * "chaos" — it only exposes `crashComponent` / `severConnection`. This
 * module translates human-readable roles ("any_server", "any_cache",
 * "any_connection_to_database") into concrete ids at trigger time and
 * invokes the sim primitives.
 */

export type ChaosKind = "crash_component" | "sever_connection";

export interface ChaosEvent {
  /** Elapsed seconds into the wave at which the event should fire. */
  readonly atSeconds: number;
  readonly kind: ChaosKind;
  /**
   * Role selector resolved at trigger time against the sim's live topology.
   * Supported roles:
   *   - "any_server"   — any component with a forwarding capability
   *   - "any_cache"    — any component with a caching capability
   *   - "any_database" — any component with a processing capability
   *   - "any_connection_to_database"  — any forward edge whose target has processing cap
   *   - "any_connection_to_cache"     — any forward edge whose target has caching cap
   *   - "any_connection_to_server"    — any forward edge whose target has forwarding cap
   */
  readonly targetRole: string;
}

/** Map campaign-level role keywords to the sim-capability ids they match. */
const ROLE_CAPABILITY: Record<string, string> = {
  any_server: "forwarding",
  any_cache: "caching",
  any_database: "processing",
  any_load_balancer: "load-balancer",
  any_gateway: "gateway",
  any_worker: "worker",
};

/** Map connection-targeting role keywords to the destination capability id. */
const CONNECTION_ROLE_TARGET_CAPABILITY: Record<string, string> = {
  any_connection_to_server: "forwarding",
  any_connection_to_cache: "caching",
  any_connection_to_database: "processing",
  any_connection_to_load_balancer: "load-balancer",
  any_connection_to_gateway: "gateway",
  any_connection_to_worker: "worker",
};

function pickDeterministic<T>(items: readonly T[], rng: () => number): T | null {
  if (items.length === 0) return null;
  const idx = Math.floor(rng() * items.length);
  return items[Math.min(idx, items.length - 1)] ?? null;
}

/**
 * Resolve a role string to a concrete sim id against the live topology.
 * Uses the sim's RNG so replay under the same seed is deterministic.
 * Returns null if no target matches (e.g. the role's cohort is empty
 * because the player never placed one).
 */
export function resolveTarget(
  role: string,
  sim: Sim,
): ComponentId | ConnectionId | null {
  const compCap = ROLE_CAPABILITY[role];
  if (compCap !== undefined) {
    const candidates: ComponentId[] = [];
    for (const c of sim.components.values()) {
      if (sim.crashedComponents.has(c.id)) continue;
      if (c.capabilities.some((cap) => cap.id === compCap)) {
        candidates.push(c.id);
      }
    }
    return pickDeterministic(candidates, sim.rng);
  }
  const edgeTargetCap = CONNECTION_ROLE_TARGET_CAPABILITY[role];
  if (edgeTargetCap !== undefined) {
    const candidates: ConnectionId[] = [];
    for (const conn of sim.connections.values()) {
      if (conn.direction !== "forward") continue;
      const target = sim.components.get(conn.to.componentId);
      if (!target) continue;
      if (target.capabilities.some((cap) => cap.id === edgeTargetCap)) {
        candidates.push(conn.id);
      }
    }
    return pickDeterministic(candidates, sim.rng);
  }
  return null;
}

/**
 * Fire a chaos event against a sim. Returns true if a target was found and
 * the corresponding sim primitive was invoked; false if the role had no
 * viable target (caller may choose to mark fired regardless to avoid retry).
 */
export function applyChaosEvent(event: ChaosEvent, sim: Sim): boolean {
  const target = resolveTarget(event.targetRole, sim);
  if (target === null) return false;
  if (event.kind === "crash_component") {
    sim.crashComponent(target as ComponentId);
    return true;
  }
  if (event.kind === "sever_connection") {
    sim.severConnection(target as ConnectionId);
    return true;
  }
  return false;
}

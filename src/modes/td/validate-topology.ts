import type { SimulationState } from "@core/state/simulation-state.js";
import type { TDWaveDefinition } from "./td-waves.js";
import type { ComponentId } from "@core/types/ids.js";
import type { Component } from "@core/component/component.js";

export interface TopologyError {
  readonly requestType: string;
  readonly componentId: ComponentId;
  readonly componentType: string;
  readonly reason: "no_handler" | "no_egress";
}

/** Capability IDs whose PROCESS phase terminally handles a request (RESPOND). */
const TERMINAL_PROCESS_IDS = new Set([
  "processing",
  "storage",
  "batch-processing",
  "streaming",
  "blob-storage",
]);

/** Capability IDs whose PROCESS phase forwards (FORWARD) — needs egress. */
const FORWARDING_PROCESS_IDS = new Set([
  "forwarding",
  "forwarding-pipe",
]);

/**
 * Build an adjacency list from state.connections: source componentId -> target componentId[].
 */
function buildAdjacency(
  state: SimulationState,
): Map<ComponentId, ComponentId[]> {
  const adj = new Map<ComponentId, ComponentId[]>();
  for (const conn of state.connections.values()) {
    const sourceId = conn.source.componentId;
    const arr = adj.get(sourceId) ?? [];
    arr.push(conn.target.componentId);
    adj.set(sourceId, arr);
  }
  return adj;
}

/**
 * Recursively check if a request of the given type can reach a terminal
 * handler starting from `componentId`.
 *
 * Returns `true` if a valid terminal path exists, `false` otherwise.
 * When returning false, populates `errors` with the dead-end detail.
 */
function canReachTerminal(
  componentId: ComponentId,
  type: string,
  adjacency: Map<ComponentId, ComponentId[]>,
  components: ReadonlyMap<ComponentId, Component>,
  visited: Set<ComponentId>,
  errors: TopologyError[],
): boolean {
  if (visited.has(componentId)) return false; // cycle
  visited.add(componentId);

  const component = components.get(componentId);
  if (!component) return false;

  // --- INTERCEPT phase ---
  let interceptMayTerminate = false;
  for (const cap of component.capabilities.values()) {
    if (cap.phase === "INTERCEPT" && cap.canHandle(type)) {
      interceptMayTerminate = true;
    }
  }

  // --- PROCESS phase (first match only) ---
  let processMatched = false;
  for (const cap of component.capabilities.values()) {
    if (cap.phase !== "PROCESS") continue;
    if (!cap.canHandle(type)) continue;

    processMatched = true;
    const capId = cap.id as string;

    if (TERMINAL_PROCESS_IDS.has(capId)) {
      // Terminal capability — valid endpoint
      return true;
    }

    if (FORWARDING_PROCESS_IDS.has(capId)) {
      // Forwarding — must have egress targets
      const targets = adjacency.get(componentId);
      if (!targets || targets.length === 0) {
        errors.push({
          requestType: type,
          componentId,
          componentType: component.type,
          reason: "no_egress",
        });
        return false;
      }
      // Check if ANY downstream target can reach a terminal
      const reachable = targets.some((t) =>
        canReachTerminal(
          t,
          type,
          adjacency,
          components,
          new Set(visited),
          errors,
        ),
      );
      if (reachable) return true;
      // None of the targets could reach a terminal — errors already
      // populated by recursive calls. No need to add another error here.
      return false;
    }

    // Unknown PROCESS cap — treat as no_handler (shouldn't happen with
    // the standard TD capability set, but be defensive).
    break; // one-per-request rule
  }

  // --- No PROCESS handler matched ---
  if (interceptMayTerminate) {
    // Optimistic: an INTERCEPT capability (cache, auth, circuit-breaker,
    // queue) may terminally handle this request type.
    return true;
  }

  // Dead end — nothing handles this request type
  errors.push({
    requestType: type,
    componentId,
    componentType: component.type,
    reason: "no_handler",
  });
  return false;
}

/**
 * Trace each request type in the wave's composition through the component
 * topology starting from `entryPointId`. Reports dead ends where a request
 * type cannot reach a terminal handler.
 *
 * Pure function — no side effects, no engine dependency.
 */
export function validateTopology(
  state: SimulationState,
  wave: TDWaveDefinition,
  entryPointId: ComponentId,
): TopologyError[] {
  const adjacency = buildAdjacency(state);
  const errors: TopologyError[] = [];

  for (const [type, weight] of wave.composition) {
    if (weight <= 0) continue;

    const typeErrors: TopologyError[] = [];
    const reachable = canReachTerminal(
      entryPointId,
      type,
      adjacency,
      state.components,
      new Set(),
      typeErrors,
    );

    if (!reachable) {
      // Add collected errors for this type. If no errors were collected
      // (e.g. entry point doesn't exist), add a root-level error.
      if (typeErrors.length === 0) {
        errors.push({
          requestType: type,
          componentId: entryPointId,
          componentType: state.components.get(entryPointId)?.type ?? "unknown",
          reason: "no_handler",
        });
      } else {
        errors.push(...typeErrors);
      }
    }
  }

  return errors;
}

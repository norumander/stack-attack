import type { ComponentId } from "@core/types/ids";
import type { Sim } from "@sim/sim";
import { ContentRouterCapability } from "@sim/capabilities/content-router";

/**
 * Map from downstream component type string to routing role.
 * Types not listed here default to "default".
 */
const TYPE_TO_ROLE: Readonly<Record<string, string>> = {
  streaming_server: "streaming",
  cdn: "cdn",
  api_gateway: "gateway",
};

/**
 * Walks `sim.connections` and for each component with a
 * `ContentRouterCapability`, populates `egressRoles` based on the target
 * component's type (looked up via `componentTypes`).
 *
 * Call this after `wireWorkers(sim)` whenever the topology changes.
 */
export function wireContentRouters(
  sim: Sim,
  componentTypes: ReadonlyMap<ComponentId, string>,
): void {
  for (const comp of sim.components.values()) {
    for (const cap of comp.capabilities) {
      if (!(cap instanceof ContentRouterCapability)) continue;
      cap.egressRoles.clear();
      for (const conn of sim.connections.values()) {
        if (conn.direction !== "forward") continue;
        if (conn.from.componentId !== comp.id) continue;
        const targetType = componentTypes.get(conn.to.componentId) ?? "unknown";
        const role = TYPE_TO_ROLE[targetType] ?? "default";
        cap.egressRoles.set(conn.id, role);
      }
    }
  }
}

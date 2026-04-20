import type { Sim } from "@sim/sim";
import { WorkerCapability } from "@sim/capabilities/worker";
import { QueueCapability } from "@sim/capabilities/queue";

/**
 * Walks `sim.connections` and for each Worker component, finds an incoming
 * forward edge originating at a Queue component, and assigns the Worker's
 * `.queue` to that Queue's `QueueCapability`. Workers without a connected
 * Queue stay unwired and are inert.
 */
export function wireWorkers(sim: Sim): void {
  for (const comp of sim.components.values()) {
    for (const cap of comp.capabilities) {
      if (!(cap instanceof WorkerCapability)) continue;
      for (const conn of sim.connections.values()) {
        if (conn.direction !== "forward") continue;
        if (conn.to.componentId !== comp.id) continue;
        const sourceComp = sim.components.get(conn.from.componentId);
        if (!sourceComp) continue;
        const queueCap = sourceComp.capabilities.find((c) => c instanceof QueueCapability);
        if (queueCap instanceof QueueCapability) {
          cap.queue = queueCap;
          // Mark this edge so the Queue skips it when forwarding non-async
          // traffic. Workers pull from the queue directly.
          queueCap.workerEgressIds.add(conn.id);
          break;
        }
      }
    }
  }
}

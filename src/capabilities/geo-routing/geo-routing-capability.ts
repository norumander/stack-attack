import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { EngineConsultable } from "../../core/capability/engine-interfaces.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { Connection } from "../../core/types/connection.js";
import type { CapabilityId, ConnectionId } from "../../core/types/ids.js";
import { getZonePairLatency } from "../../core/types/zone.js";

/**
 * EngineConsultable capability for geographic routing.
 * Routes requests to the nearest zone based on request.originZone.
 *
 * Tier 1: Nearest-zone routing with fallback.
 * Tier 2: Weighted geo-routing considering zone pair latency.
 */
export class GeoRoutingCapability implements Capability, EngineConsultable {
  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier * 3;
  }

  getStats(): CapabilityStats {
    return {};
  }

  // --- EngineConsultable ---

  selectConnection(
    request: Request,
    egressConnections: Connection[],
    context: ProcessContext,
  ): ConnectionId {
    if (egressConnections.length === 0) {
      throw new Error("GeoRoutingCapability: no egress connections available");
    }

    const originZone = request.originZone;
    if (!originZone) {
      // No zone info — fallback to first connection
      return egressConnections[0]!.id;
    }

    // Find connections whose target component is in the same or nearest zone
    let bestConnection = egressConnections[0]!;
    let bestLatency = Infinity;

    for (const conn of egressConnections) {
      const target = context.state.components.get(conn.target.componentId);
      if (!target) continue;
      const targetZone = target.zone;
      if (!targetZone) continue;

      if (targetZone === originZone) {
        // Same zone — zero cross-zone latency, best possible
        return conn.id;
      }

      const latency = getZonePairLatency(
        context.state.zoneTopology,
        originZone,
        targetZone,
      );

      if (latency < bestLatency) {
        bestLatency = latency;
        bestConnection = conn;
      }
    }

    return bestConnection.id;
  }
}

import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult, SideEffect } from "../../core/types/result.js";
import type { CapabilityId, RequestId } from "../../core/types/ids.js";

/**
 * REPLICATE-phase capability for data replication.
 * Spawns non-blocking copies of write requests to replica targets
 * via egress connections. Tier scales max replicas.
 */
export class ReplicationCapability implements Capability {
  readonly phase = "REPLICATE" as const;

  private replicasSent = 0;
  private counter = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "api_write" || requestType === "event";
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    const tier = context.effectiveTiers.get(this.id) ?? 1;
    const component = context.state.components.get(context.componentId);
    if (!component) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    // Count egress connections
    const egressPorts = component.ports.filter((p) => p.direction === "egress");
    const egressConnectionCount = egressPorts.reduce(
      (sum, p) => sum + p.connections.length,
      0,
    );

    const replicaCount = Math.min(tier, egressConnectionCount);
    const sideEffects: SideEffect[] = [];

    for (let i = 0; i < replicaCount; i++) {
      this.counter += 1;
      const childId = `${request.id}-replica-${this.counter}` as RequestId;
      sideEffects.push({
        kind: "SPAWN",
        request: {
          id: childId,
          parentId: request.id,
          type: request.type,
          payload: request.payload,
          origin: context.componentId,
          createdAt: 0,
          ttl: Math.max(1, request.ttl - 1),
          originZone: request.originZone,
          streamDuration: null,
          streamBandwidth: null,
        },
        blocking: false,
      });
    }

    this.replicasSent += replicaCount;

    return { outcome: { kind: "PASS" }, sideEffects, events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier * 4;
  }

  getStats(): CapabilityStats {
    return { replicasSent: this.replicasSent };
  }

  resetPerTickState(): void {
    this.replicasSent = 0;
  }
}

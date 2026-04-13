import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId, RequestId } from "../../core/types/ids.js";

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * REPLICATE-phase capability for data sharding.
 * Hash-distributes write requests across shard targets via
 * egress connections. Returns PASS — the primary outcome is
 * unchanged; sharding adds a non-blocking SPAWN to the target shard.
 */
export class ShardingCapability implements Capability {
  readonly phase = "REPLICATE" as const;

  private shardsRouted = 0;
  private counter = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "api_write";
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    const component = context.state.components.get(context.componentId);
    if (!component) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    const egressPorts = component.ports.filter((p) => p.direction === "egress");
    const egressConnectionCount = egressPorts.reduce(
      (sum, p) => sum + p.connections.length,
      0,
    );

    if (egressConnectionCount === 0) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    // Determine shard index via hash
    const shardIndex = simpleHash(request.id) % egressConnectionCount;
    this.counter += 1;
    this.shardsRouted += 1;

    const childId = `${request.id}-shard-${this.counter}` as RequestId;

    return {
      outcome: { kind: "PASS" },
      sideEffects: [
        {
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
        },
      ],
      events: [],
    };
  }

  getUpkeepCost(tier: number): number {
    return tier * 5;
  }

  getStats(): CapabilityStats {
    return { shardsRouted: this.shardsRouted };
  }

  resetPerTickState(): void {
    this.shardsRouted = 0;
  }
}

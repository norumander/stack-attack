import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type {
  InstanceDirectory,
  ComponentRef,
} from "../../core/capability/engine-interfaces.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId, ComponentId } from "../../core/types/ids.js";

/**
 * PROCESS-phase capability + InstanceDirectory for service discovery.
 * Maintains a registry of known component instances.
 * Used by GeoRoutingCapability and other capabilities that need
 * to discover available services.
 */
export class RegistrationCapability implements Capability, InstanceDirectory {
  readonly phase = "PROCESS" as const;

  private readonly registry = new Map<
    ComponentId,
    ComponentRef
  >();

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "register" || requestType === "deregister";
  }

  process(request: Request, _context: ProcessContext): ProcessResult {
    if (request.type === "register") {
      const ref = request.payload as ComponentRef | null;
      if (ref) {
        this.registry.set(ref.componentId, ref);
      }
    } else if (request.type === "deregister") {
      const ref = request.payload as { componentId: ComponentId } | null;
      if (ref) {
        this.registry.delete(ref.componentId);
      }
    }
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier * 3;
  }

  getStats(): CapabilityStats {
    return { registeredInstances: this.registry.size };
  }

  // --- InstanceDirectory ---

  listCandidates(query: {
    componentType?: string;
    zone?: string;
    healthyOnly?: boolean;
  }): ComponentRef[] {
    const results: ComponentRef[] = [];
    for (const ref of this.registry.values()) {
      if (query.componentType && ref.componentType !== query.componentType) continue;
      if (query.zone && ref.zone !== query.zone) continue;
      if (query.healthyOnly && ref.condition < 0.6) continue;
      results.push(ref);
    }
    return results;
  }
}

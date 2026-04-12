import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * OBSERVE-phase capability that reports component health status.
 * Used by RoutingCapability (tier 3) for condition-aware routing
 * and by the HUD for health display.
 */
export class HealthCheckCapability implements Capability {
  readonly phase = "OBSERVE" as const;

  private lastCondition = 1;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    const component = context.state.components.get(context.componentId);
    if (component) {
      this.lastCondition = component.condition;
    }
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier * 1;
  }

  getStats(): CapabilityStats {
    return {
      condition: this.lastCondition,
      healthy: this.lastCondition > 0.6 ? 1 : 0,
    };
  }
}

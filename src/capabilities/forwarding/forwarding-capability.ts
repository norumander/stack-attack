import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * PROCESS-phase capability that unconditionally forwards requests.
 * No throughput limit — intermediary components (LB, API Gateway,
 * CDN, Circuit Breaker, DNS/GTM, Client) use this to pass traffic
 * through without processing bottlenecks.
 */
export class ForwardingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(_tier: number): number {
    return 0;
  }

  getStats(): CapabilityStats {
    return {};
  }
}

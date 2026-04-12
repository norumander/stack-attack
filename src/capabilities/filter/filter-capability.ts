import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * INTERCEPT-phase capability that filters requests by type.
 * PASSthroughs allowed types, DROPs everything else.
 * Used on LoadBalancer (locked tier 0→2) and CDN (tier 1).
 */
export class FilterCapability implements Capability {
  readonly phase = "INTERCEPT" as const;

  private allowedTypes: Set<string>;
  private droppedCount = 0;

  constructor(
    readonly id: CapabilityId,
    allowedTypes: readonly string[] = [],
  ) {
    this.allowedTypes = new Set(allowedTypes);
  }

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(request: Request, _context: ProcessContext): ProcessResult {
    if (this.allowedTypes.size === 0) {
      // No filter configured — pass everything
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }
    if (this.allowedTypes.has(request.type)) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }
    this.droppedCount += 1;
    return {
      outcome: { kind: "DROP", reason: "filtered" },
      sideEffects: [],
      events: [],
    };
  }

  getUpkeepCost(tier: number): number {
    return tier * 1;
  }

  getStats(): CapabilityStats {
    return { droppedByFilter: this.droppedCount };
  }

  configure(config: unknown): void {
    if (Array.isArray(config)) {
      this.allowedTypes = new Set(config as string[]);
    }
  }

  resetPerTickState(): void {
    this.droppedCount = 0;
  }
}

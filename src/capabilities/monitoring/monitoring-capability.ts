import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * OBSERVE-phase capability that tracks per-tick processing stats.
 * Present on every component. Exposes metrics via getStats() for
 * other capabilities (AutoScale, HealthCheck) and the HUD to read.
 */
export class MonitoringCapability implements Capability {
  readonly phase = "OBSERVE" as const;

  private processedThisTick = 0;
  private droppedThisTick = 0;
  private latencySumThisTick = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    this.processedThisTick += 1;
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier * 2;
  }

  getStats(): CapabilityStats {
    return {
      processedThisTick: this.processedThisTick,
      droppedThisTick: this.droppedThisTick,
      latencyAdded: this.latencySumThisTick,
    };
  }

  resetPerTickState(): void {
    this.processedThisTick = 0;
    this.droppedThisTick = 0;
    this.latencySumThisTick = 0;
  }
}

import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

/**
 * OBSERVE-phase capability. Ceremonial in Stage 3a — exists so every
 * component registry entry can declare an OBSERVE capability without the
 * pipeline crashing on an empty OBSERVE phase. The engine's metricsHistory
 * already captures per-tick rollup metrics; real per-component metric
 * streams via OBSERVE events are a later stage.
 */
export class MonitoringCapability implements Capability {
  readonly phase = "OBSERVE" as const;
  private observedCount = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    this.observedCount += 1;
    return {
      outcome: { kind: "PASS" },
      sideEffects: [],
      events: [],
    };
  }

  getUpkeepCost(tier: number): number {
    const table: Record<number, number> = { 1: 1, 2: 3, 3: 5 };
    return table[tier] ?? 1;
  }

  getStats(): CapabilityStats {
    return { observedCount: this.observedCount };
  }
}

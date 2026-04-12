import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * INTERCEPT-phase capability that models response compression.
 * Reduces effective bandwidth consumption on responses.
 * Returns PASS always — the bandwidth savings are modeled via
 * reduced upkeep cost per tier (hardware-accelerated at tier 2).
 */
export class CompressionCapability implements Capability {
  readonly phase = "INTERCEPT" as const;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier * 2;
  }

  getStats(): CapabilityStats {
    return {};
  }
}

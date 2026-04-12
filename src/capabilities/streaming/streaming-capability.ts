import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

/**
 * PROCESS-phase capability for streaming media.
 * Handles stream requests. Returns RESPOND — the engine reads
 * request.streamDuration and streamBandwidth to set up active
 * stream tracking (sustained bandwidth over multiple ticks).
 */
export class StreamingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  private activeStreams = 0;

  constructor(readonly id: CapabilityId) {}

  canHandle(requestType: string): boolean {
    return requestType === "stream";
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    this.activeStreams += 1;
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
  }

  getThroughputPerTick(tier: number): number {
    return tier * 4;
  }

  getUpkeepCost(tier: number): number {
    return tier * 7;
  }

  getStats(): CapabilityStats {
    return { activeStreams: this.activeStreams };
  }

  resetPerTickState(): void {
    this.activeStreams = 0;
  }
}

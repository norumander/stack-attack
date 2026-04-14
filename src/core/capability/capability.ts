import type { CapabilityId } from "../types/ids.js";
import type { Phase } from "../types/phase.js";
import type { Request } from "../types/request.js";
import type { ProcessResult } from "../types/result.js";
import type { ProcessContext } from "./process-context.js";

export interface HitRateByTypeEntry {
  hits: number;
  misses: number;
  hitRate: number;
}

export interface CapabilityStats {
  hitRate?: number;
  queueDepth?: number;
  latencyAdded?: number;
  hitRateByType?: Record<string, HitRateByTypeEntry>;
  [key: string]: number | Record<string, HitRateByTypeEntry> | undefined;
}

export interface Capability {
  readonly id: CapabilityId;
  readonly phase?: Phase;
  canHandle(requestType: string): boolean;
  process(request: Request, context: ProcessContext): ProcessResult;
  getUpkeepCost(tier: number): number;
  getThroughputPerTick?(tier: number): number;
  getStats(): CapabilityStats;
  configure?(config: unknown): void;
  resetPerTickState?(): void;
}

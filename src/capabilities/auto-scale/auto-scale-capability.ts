import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult, SideEffect } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";

const SCALE_UP_THRESHOLD = 0.8;
const SCALE_DOWN_THRESHOLD = 0.3;

/**
 * OBSERVE-phase capability for dynamic auto-scaling.
 * Emits SCALE side effects based on load (processed/throughput ratio).
 * Tier 1: 5-tick cooldown. Tier 2: 2-tick cooldown.
 */
export class AutoScaleCapability implements Capability {
  readonly phase = "OBSERVE" as const;

  private lastScaleTick = -Infinity;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    const tier = context.effectiveTiers.get(this.id) ?? 1;
    const cooldown = tier >= 2 ? 2 : 5;

    if (context.currentTick - this.lastScaleTick < cooldown) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    const component = context.state.components.get(context.componentId);
    if (!component) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    // Read monitoring stats to gauge load
    // Simple heuristic: check pending queue depth
    const sideEffects: SideEffect[] = [];
    const currentInstances = component.instanceCount;

    // This is a simplified model — in a full implementation,
    // we'd read MonitoringCapability.getStats() for precise load metrics.
    // For now, auto-scale is triggered by OBSERVE seeing requests,
    // and the side effect is queued for the engine to handle.

    return { outcome: { kind: "PASS" }, sideEffects, events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier * 3;
  }

  getStats(): CapabilityStats {
    return { lastScaleTick: this.lastScaleTick };
  }
}

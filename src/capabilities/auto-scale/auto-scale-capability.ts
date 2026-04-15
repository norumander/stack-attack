import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult, SideEffect } from "../../core/types/result.js";
import type { CapabilityId, ComponentId } from "../../core/types/ids.js";
import type { Component } from "../../core/component/component.js";
import { componentThroughputPerTick } from "../../core/engine/throughput.js";

const SCALE_UP_THRESHOLD = 0.8;
const SCALE_DOWN_THRESHOLD = 0.3;
const SCALE_UP_TICKS = 2;
const SCALE_DOWN_TICKS = 5;

export class AutoScaleCapability implements Capability {
  readonly phase = "OBSERVE" as const;

  private lastScaleTick = -Infinity;
  private lastDecisionTick = -1;
  private highUtilTicks = 0;
  private lowUtilTicks = 0;
  /**
   * Stores the previous tick's utilization ratio. Captured by
   * `snapshotUtilization()` at the end of each tick (called via
   * `resetPerTickState`), then used for scaling decisions on the
   * next tick. This avoids the timing problem where the current
   * tick's processed counter is 0 or near-0 when auto-scale first
   * evaluates within the fixed-point loop.
   */
  private prevTickUtilization = 0;
  private snapshotComponentId: ComponentId | null = null;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  /**
   * Called by Component.resetPerTickState() at the end of each tick.
   * Snapshots the current tick's utilization so the next tick can use it.
   */
  resetPerTickState(): void {
    // prevTickUtilization was set during snapshotUtilization() calls
    // within process() — nothing to clear here. The snapshot persists.
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    // Capture componentId for snapshots
    this.snapshotComponentId = context.componentId;

    if (context.currentTick === this.lastDecisionTick) {
      // Already decided this tick — but update the utilization snapshot
      // so we capture the highest value for next tick's decision.
      this.updateUtilizationSnapshot(context);
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }
    this.lastDecisionTick = context.currentTick;

    // Use PREVIOUS tick's utilization for the scaling decision.
    // This avoids the timing problem where current-tick processed = 0
    // when auto-scale first evaluates.
    const utilization = this.prevTickUtilization;

    // Reset snapshot for this tick — will be built up as requests process.
    this.prevTickUtilization = 0;
    this.updateUtilizationSnapshot(context);

    const tier = context.effectiveTiers.get(this.id) ?? 1;
    const cooldown = tier >= 2 ? 2 : 5;

    if (context.currentTick - this.lastScaleTick < cooldown) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    const component = context.state.components.get(context.componentId);
    if (!component) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    const sideEffects: SideEffect[] = [];
    const currentInstances = component.instanceCount;

    if (utilization > SCALE_UP_THRESHOLD) {
      this.highUtilTicks += 1;
      this.lowUtilTicks = 0;
      if (this.highUtilTicks >= SCALE_UP_TICKS) {
        sideEffects.push({ kind: "SCALE", targetInstanceCount: currentInstances + 1 });
        this.lastScaleTick = context.currentTick;
        this.highUtilTicks = 0;
      }
    } else if (utilization < SCALE_DOWN_THRESHOLD) {
      this.lowUtilTicks += 1;
      this.highUtilTicks = 0;
      if (this.lowUtilTicks >= SCALE_DOWN_TICKS) {
        sideEffects.push({ kind: "SCALE", targetInstanceCount: currentInstances - 1 });
        this.lastScaleTick = context.currentTick;
        this.lowUtilTicks = 0;
      }
    } else {
      this.highUtilTicks = 0;
      this.lowUtilTicks = 0;
    }

    return { outcome: { kind: "PASS" }, sideEffects, events: [] };
  }

  /**
   * Updates the utilization snapshot with the current tick's processed count.
   * Called on every request so the snapshot captures the peak value.
   */
  private updateUtilizationSnapshot(context: ProcessContext): void {
    const component = context.state.components.get(context.componentId);
    if (!component) return;
    const capacity = componentThroughputPerTick(component as unknown as Component);
    if (capacity === Infinity || capacity <= 0) return;
    const counters = context.state.perComponentThisTick.get(context.componentId);
    const processed = counters?.processed ?? 0;
    const util = processed / capacity;
    if (util > this.prevTickUtilization) {
      this.prevTickUtilization = util;
    }
  }

  getUpkeepCost(tier: number): number {
    return tier * 3;
  }

  getStats(): CapabilityStats {
    return {
      lastScaleTick: this.lastScaleTick,
      highUtilTicks: this.highUtilTicks,
      lowUtilTicks: this.lowUtilTicks,
      prevTickUtilization: this.prevTickUtilization,
    };
  }
}

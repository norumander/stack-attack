import type { Capability, CapabilityStats } from "../../core/capability/capability.js";
import type { Request } from "../../core/types/request.js";
import type { ProcessContext } from "../../core/capability/process-context.js";
import type { ProcessResult, SideEffect } from "../../core/types/result.js";
import type { CapabilityId } from "../../core/types/ids.js";
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

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, context: ProcessContext): ProcessResult {
    if (context.currentTick === this.lastDecisionTick) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }
    this.lastDecisionTick = context.currentTick;

    const tier = context.effectiveTiers.get(this.id) ?? 1;
    const cooldown = tier >= 2 ? 2 : 5;

    if (context.currentTick - this.lastScaleTick < cooldown) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    const component = context.state.components.get(context.componentId);
    if (!component) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    const counters = context.state.perComponentThisTick.get(context.componentId);
    const processed = counters?.processed ?? 0;
    const capacity = componentThroughputPerTick(component as unknown as Component);

    if (capacity === Infinity || capacity <= 0) {
      return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
    }

    const utilization = processed / capacity;
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

  getUpkeepCost(tier: number): number {
    return tier * 3;
  }

  getStats(): CapabilityStats {
    return {
      lastScaleTick: this.lastScaleTick,
      highUtilTicks: this.highUtilTicks,
      lowUtilTicks: this.lowUtilTicks,
    };
  }
}

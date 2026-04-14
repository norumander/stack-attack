import type { CapabilityId, ComponentId } from "../types/ids.js";
import type { Port } from "../types/port.js";
import type { Position } from "../types/position.js";
import type { Phase } from "../types/phase.js";
import type { ConditionProfile } from "../types/condition.js";
import type { Request, RequestEvent } from "../types/request.js";
import type { ProcessResult, PrimaryOutcome, SideEffect } from "../types/result.js";
import type { Capability } from "../capability/capability.js";
import type { ProcessContext } from "../capability/process-context.js";
import type { ComponentReader } from "./component-reader.js";

export interface ComponentConstructorArgs {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: ReadonlyMap<CapabilityId, Capability>;
  readonly initialTiers: ReadonlyMap<CapabilityId, number>;
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly position: Position;
  readonly zone: string | null;
  readonly placementTick: number;
  readonly conditionProfile: ConditionProfile;
  readonly initialInstanceCount?: number;
  readonly initialCondition?: number;
  readonly minInstances?: number;
  readonly maxInstances?: number;
}

export class Component implements ComponentReader {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: ReadonlyMap<CapabilityId, Capability>;
  private capabilityTiers: Map<CapabilityId, number>;
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly placementTick: number;
  position: Position;
  zone: string | null;
  instanceCount: number;
  condition: number;
  readonly conditionProfile: ConditionProfile;
  readonly minInstances: number;
  readonly maxInstances: number;

  constructor(args: ComponentConstructorArgs) {
    this.id = args.id;
    this.type = args.type;
    this.name = args.name;
    this.description = args.description;
    this.capabilities = args.capabilities;
    this.capabilityTiers = new Map(args.initialTiers);
    this.ports = args.ports;
    this.placementCost = args.placementCost;
    this.placementTick = args.placementTick;
    this.position = args.position;
    this.zone = args.zone;
    this.conditionProfile = args.conditionProfile;
    this.instanceCount = args.initialInstanceCount ?? 1;
    this.condition = args.initialCondition ?? 1.0;
    this.minInstances = args.minInstances ?? 1;
    this.maxInstances = args.maxInstances ?? 1;
  }

  getPlayerTier(capabilityId: CapabilityId): number {
    return this.capabilityTiers.get(capabilityId) ?? 0;
  }

  getCapabilityIds(): readonly CapabilityId[] {
    return [...this.capabilities.keys()];
  }

  getCapabilitiesByPhase(phase: Phase): Capability[] {
    const result: Capability[] = [];
    for (const cap of this.capabilities.values()) {
      if (cap.phase === phase) result.push(cap);
    }
    return result;
  }

  getCapabilityByInterface<T>(
    predicate: (c: Capability) => c is Capability & T,
  ): (Capability & T) | null {
    for (const cap of this.capabilities.values()) {
      if (predicate(cap)) return cap;
    }
    return null;
  }

  upgrade(capabilityId: CapabilityId, registryMaxTier: number): void {
    const current = this.capabilityTiers.get(capabilityId) ?? 0;
    const next = Math.min(current + 1, registryMaxTier);
    this.capabilityTiers.set(capabilityId, next);
  }

  resetPerTickState(): void {
    for (const cap of this.capabilities.values()) {
      cap.resetPerTickState?.();
    }
  }

  getThroughputPerTick(
    activeCapabilityIds: ReadonlySet<CapabilityId>,
    effectiveTiers: ReadonlyMap<CapabilityId, number>,
  ): number {
    let sum = 0;
    for (const [id, cap] of this.capabilities) {
      if (!activeCapabilityIds.has(id)) continue;
      if (cap.phase !== "PROCESS") continue;
      const tier = effectiveTiers.get(id) ?? 0;
      sum += cap.getThroughputPerTick?.(tier) ?? 0;
    }
    return sum * this.instanceCount;
  }

  getUpkeepCost(
    activeCapabilityIds: ReadonlySet<CapabilityId>,
    effectiveTiers: ReadonlyMap<CapabilityId, number>,
  ): number {
    let sum = 0;
    for (const [id, cap] of this.capabilities) {
      if (!activeCapabilityIds.has(id)) continue;
      const tier = effectiveTiers.get(id) ?? 0;
      sum += cap.getUpkeepCost(tier);
    }
    return sum * this.instanceCount;
  }

  process(request: Request, context: ProcessContext): ProcessResult {
    const events: RequestEvent[] = [];
    const sideEffects: SideEffect[] = [];
    let outcome: PrimaryOutcome = { kind: "PASS" };

    // INTERCEPT — first non-PASS short-circuits the whole pipeline.
    {
      const caps = this.getCapabilitiesByPhase("INTERCEPT");
      for (const cap of caps) {
        if (!context.activeCapabilityIds.has(cap.id)) continue;
        if (!cap.canHandle(request.type)) continue;
        const result = cap.process(request, context);
        for (const ev of result.events) events.push(ev);
        for (const se of result.sideEffects) sideEffects.push(se);
        if (result.outcome.kind !== "PASS") {
          outcome = result.outcome;
          return { outcome, sideEffects, events };
        }
      }
    }

    // PROCESS — only the first matching capability runs (regardless of outcome).
    {
      const caps = this.getCapabilitiesByPhase("PROCESS");
      for (const cap of caps) {
        if (!context.activeCapabilityIds.has(cap.id)) continue;
        if (!cap.canHandle(request.type)) continue;
        const result = cap.process(request, context);
        for (const ev of result.events) events.push(ev);
        for (const se of result.sideEffects) sideEffects.push(se);
        if (result.outcome.kind !== "PASS") {
          outcome = result.outcome;
        }
        break; // one-per-request rule
      }
    }

    // If PROCESS produced no concrete outcome, the component did not handle
    // this request at all (either no PROCESS capability matched canHandle,
    // or the matching cap explicitly returned PASS). Convert to an explicit
    // DROP so `deliverStaged` emits a visible DROPPED event, increments the
    // per-component drops counter, and the renderer/diagnose-wave can see
    // the failure. Before this fix, such requests vanished silently — a
    // Client wired directly to a write-only Database (Wave 1 reads) would
    // drop every request with no feedback anywhere.
    if (outcome.kind === "PASS") {
      outcome = { kind: "DROP", reason: "no_handler" };
    }

    // REPLICATE — additive; all matching capabilities run; outcome not overridden.
    {
      const caps = this.getCapabilitiesByPhase("REPLICATE");
      for (const cap of caps) {
        if (!context.activeCapabilityIds.has(cap.id)) continue;
        if (!cap.canHandle(request.type)) continue;
        const result = cap.process(request, context);
        for (const ev of result.events) events.push(ev);
        for (const se of result.sideEffects) sideEffects.push(se);
      }
    }

    // OBSERVE — always runs, read-only by convention; side effects/outcomes ignored in Stage 1.
    {
      const caps = this.getCapabilitiesByPhase("OBSERVE");
      for (const cap of caps) {
        if (!context.activeCapabilityIds.has(cap.id)) continue;
        const result = cap.process(request, context);
        for (const ev of result.events) events.push(ev);
      }
    }

    return { outcome, sideEffects, events };
  }
}

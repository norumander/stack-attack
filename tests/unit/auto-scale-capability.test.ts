import { describe, it, expect } from "vitest";
import { AutoScaleCapability } from "@capabilities/auto-scale/auto-scale-capability";
import { Component } from "@core/component/component";
import { RespondingCapability } from "@harness/test-capabilities";
import { componentThroughputPerTick } from "@core/engine/throughput";
import type { ProcessContext } from "@core/capability/process-context";
import type { SimulationStateReader } from "@core/state/state-reader";
import type { PerComponentTickCounters } from "@core/engine/per-component-counters";
import type { Request } from "@core/types/request";
import type {
  CapabilityId,
  ComponentId,
  RequestId,
} from "@core/types/ids";
import type { Capability } from "@core/capability/capability";
import type { ConditionProfile } from "@core/types/condition";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const defaultProfile: ConditionProfile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [],
  criticalEffects: [],
};

/**
 * Creates a Component with:
 *   - A RespondingCapability ("proc") with throughput 10/tick at tier 1
 *   - An AutoScaleCapability ("as")
 * Accepts instanceCount and maxInstances overrides.
 */
function makeScalableComponent(opts: {
  id?: string;
  instanceCount?: number;
  maxInstances?: number;
}): Component {
  const procId = "proc" as CapabilityId;
  const asId = "as" as CapabilityId;
  const proc = new RespondingCapability(procId, { throughputPerTier: 10 });
  const as_ = new AutoScaleCapability(asId);
  const capabilities = new Map<CapabilityId, Capability>([
    [procId, proc],
    [asId, as_],
  ]);
  return new Component({
    id: (opts.id ?? "comp") as ComponentId,
    type: "server",
    name: opts.id ?? "comp",
    description: "",
    capabilities,
    initialTiers: new Map<CapabilityId, number>([
      [procId, 1],
      [asId, 1],
    ]),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: defaultProfile,
    initialInstanceCount: opts.instanceCount ?? 1,
    maxInstances: opts.maxInstances ?? 10,
  });
}

function makeRequest(): Request {
  return {
    id: "req-1" as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "client" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function makeContext(
  component: Component,
  tick: number,
  processed: number,
): ProcessContext {
  const compId = component.id;
  const asId = "as" as CapabilityId;
  const counters: PerComponentTickCounters = {
    processed,
    drops: 0,
    timeouts: 0,
    overloaded: 0,
    backpressured: 0,
  };
  const perComponentThisTick = new Map<ComponentId, PerComponentTickCounters>();
  perComponentThisTick.set(compId, counters);

  const stateReader: SimulationStateReader = {
    components: new Map([[compId, component]]),
    connections: new Map(),
    zoneTopology: { zones: [], latencies: new Map() },
    currentTick: tick,
    phase: "simulate",
    perComponentThisTick,
    getEventsFor: () => [],
    getActiveStreamsOnConnection: () => [],
    getActiveChaos: () => [],
  };

  return {
    state: stateReader,
    componentId: compId,
    effectiveTier: 1,
    effectiveTiers: new Map<CapabilityId, number>([[asId, 1]]),
    activeCapabilityIds: new Set<CapabilityId>([
      "proc" as CapabilityId,
      asId,
    ]),
    currentTick: tick,
    rng: { next: () => 0.5 },
    directories: [],
    childResponses: new Map(),
  };
}

/* ------------------------------------------------------------------ */
/*  Sanity: throughput assumption                                      */
/* ------------------------------------------------------------------ */
describe("AutoScaleCapability — throughput assumption", () => {
  it("component throughput is 10 for instanceCount=1, tier=1", () => {
    const comp = makeScalableComponent({ instanceCount: 1 });
    expect(componentThroughputPerTick(comp)).toBe(10);
  });
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe("AutoScaleCapability", () => {
  it("has OBSERVE phase", () => {
    expect(new AutoScaleCapability("as" as CapabilityId).phase).toBe("OBSERVE");
  });

  it("getUpkeepCost = tier * 3", () => {
    expect(new AutoScaleCapability("as" as CapabilityId).getUpkeepCost(2)).toBe(6);
  });

  it("canHandle returns true for all types", () => {
    expect(new AutoScaleCapability("as" as CapabilityId).canHandle("api_read")).toBe(true);
  });

  it("emits SCALE(current+1) after 2 consecutive high-utilization ticks", () => {
    const comp = makeScalableComponent({ instanceCount: 1, maxInstances: 10 });
    const cap = new AutoScaleCapability("as" as CapabilityId);
    const req = makeRequest();

    // Tick 0: 90% utilization (9 of 10) — 1st high tick, no scale
    const r0 = cap.process(req, makeContext(comp, 0, 9));
    expect(r0.sideEffects).toHaveLength(0);

    // Tick 1: 90% utilization again — 2nd consecutive, should emit SCALE
    const r1 = cap.process(req, makeContext(comp, 1, 9));
    expect(r1.sideEffects).toHaveLength(1);
    expect(r1.sideEffects[0]).toEqual({
      kind: "SCALE",
      targetInstanceCount: 2,
    });
  });

  it("emits SCALE(current-1) after 5 consecutive low-utilization ticks", () => {
    // instanceCount=3, throughput=10*3=30. processed=5 → 16.7% < 30%
    const comp = makeScalableComponent({ instanceCount: 3, maxInstances: 10 });
    const cap = new AutoScaleCapability("as" as CapabilityId);
    const req = makeRequest();

    for (let tick = 0; tick < 4; tick++) {
      const r = cap.process(req, makeContext(comp, tick, 5));
      expect(r.sideEffects).toHaveLength(0);
    }

    // Tick 4: 5th consecutive low tick → SCALE down
    const r4 = cap.process(req, makeContext(comp, 4, 5));
    expect(r4.sideEffects).toHaveLength(1);
    expect(r4.sideEffects[0]).toEqual({
      kind: "SCALE",
      targetInstanceCount: 2,
    });
  });

  it("does not emit SCALE within cooldown period", () => {
    const comp = makeScalableComponent({ instanceCount: 1, maxInstances: 10 });
    const cap = new AutoScaleCapability("as" as CapabilityId);
    const req = makeRequest();

    // Trigger scale-up at tick 1
    cap.process(req, makeContext(comp, 0, 9)); // 1st high
    const r1 = cap.process(req, makeContext(comp, 1, 9)); // 2nd high → SCALE
    expect(r1.sideEffects).toHaveLength(1);

    // Tick 2: still high util, but within tier-1 cooldown (5 ticks)
    const r2 = cap.process(req, makeContext(comp, 2, 9));
    expect(r2.sideEffects).toHaveLength(0);

    // Tick 5: still within cooldown (lastScaleTick=1, 5-1=4 < 5)
    const r5 = cap.process(req, makeContext(comp, 5, 9));
    expect(r5.sideEffects).toHaveLength(0);

    // Tick 6: cooldown expired (6-1=5 >= 5), but counters were reset
    // so this is only the 1st high tick
    const r6 = cap.process(req, makeContext(comp, 6, 9));
    expect(r6.sideEffects).toHaveLength(0);
  });

  it("does not emit SCALE for moderate utilization even after 10 ticks", () => {
    const comp = makeScalableComponent({ instanceCount: 1, maxInstances: 10 });
    const cap = new AutoScaleCapability("as" as CapabilityId);
    const req = makeRequest();

    // 50% utilization (5 of 10) — moderate, should never scale
    for (let tick = 0; tick < 10; tick++) {
      const r = cap.process(req, makeContext(comp, tick, 5));
      expect(r.sideEffects).toHaveLength(0);
    }
  });

  it("resets consecutive counter when utilization changes", () => {
    // instanceCount=3, throughput=30
    const comp = makeScalableComponent({ instanceCount: 3, maxInstances: 10 });
    const cap = new AutoScaleCapability("as" as CapabilityId);
    const req = makeRequest();

    // Ticks 0-2: low utilization (processed=5, 16.7%)
    for (let tick = 0; tick <= 2; tick++) {
      cap.process(req, makeContext(comp, tick, 5));
    }

    // Tick 3: spike to moderate (processed=15, 50%) — resets counter
    cap.process(req, makeContext(comp, 3, 15));

    // Ticks 4-7: low again (4 consecutive, not 5 yet)
    for (let tick = 4; tick <= 7; tick++) {
      const r = cap.process(req, makeContext(comp, tick, 5));
      expect(r.sideEffects).toHaveLength(0);
    }

    // Tick 8: 5th consecutive low tick after the reset → SCALE down
    const r8 = cap.process(req, makeContext(comp, 8, 5));
    expect(r8.sideEffects).toHaveLength(1);
    expect(r8.sideEffects[0]).toEqual({
      kind: "SCALE",
      targetInstanceCount: 2,
    });
  });
});

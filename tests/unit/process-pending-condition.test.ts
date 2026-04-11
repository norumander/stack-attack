import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId, RequestId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import type { Request } from "@core/types/request";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { RespondingCapability } from "@harness/test-capabilities";

function makeProfile(overrides: Partial<ConditionProfile> = {}): ConditionProfile {
  return {
    degradedThreshold: 0.7,
    criticalThreshold: 0.3,
    decayRate: 0,
    recoveryRate: 0,
    degradedEffects: [],
    criticalEffects: [],
    ...overrides,
  };
}

function makeComp(
  id: string,
  condition: number,
  profile: ConditionProfile,
  cap: RespondingCapability,
): Component {
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map<CapabilityId, RespondingCapability>([[cap.id, cap]]),
    initialTiers: new Map<CapabilityId, number>([[cap.id, 1]]),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
    initialCondition: condition,
  });
}

function makeReq(id: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "c1" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

const mc = new NoOpModeController({
  targetEntryPointId: "c1" as ComponentId,
  intensity: 0,
  requestType: "api_read",
});

describe("process-pending condition hooks", () => {
  it("throughput_multiplier 0.5 halves the per-tick throughput gate", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cap = new RespondingCapability("proc" as CapabilityId, { throughputPerTier: 4 });
    const comp = makeComp(
      "c1",
      0.5, // degraded
      makeProfile({
        degradedEffects: [{ kind: "throughput_multiplier", factor: 0.5 }],
      }),
      cap,
    );
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    for (let i = 0; i < 10; i++) state.enqueuePending(comp.id, makeReq(`r${i}`));

    new Engine(state).tick(mc);

    // Raw throughput = 4 per tier * 1 instance = 4. Multiplier 0.5 → 2.
    const processed = state.metricsHistory[0]?.perComponent.get(comp.id)?.processed;
    expect(processed).toBe(2);
  });

  it("throughput_multiplier 0 processes nothing", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cap = new RespondingCapability("proc" as CapabilityId, { throughputPerTier: 4 });
    const comp = makeComp(
      "c1",
      0.1, // critical
      makeProfile({
        criticalEffects: [{ kind: "throughput_multiplier", factor: 0 }],
      }),
      cap,
    );
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    for (let i = 0; i < 3; i++) state.enqueuePending(comp.id, makeReq(`r${i}`));

    new Engine(state).tick(mc);

    const processed = state.metricsHistory[0]?.perComponent.get(comp.id)?.processed;
    expect(processed).toBe(0);
  });

  it("drop_probability 1.0 drops every request before the pipeline runs", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cap = new RespondingCapability("proc" as CapabilityId, { throughputPerTier: 100 });
    const comp = makeComp(
      "c1",
      0.1, // critical
      makeProfile({
        criticalEffects: [{ kind: "drop_probability", p: 1.0 }],
      }),
      cap,
    );
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    for (let i = 0; i < 5; i++) state.enqueuePending(comp.id, makeReq(`r${i}`));

    new Engine(state).tick(mc);

    const snap = state.metricsHistory[0]?.perComponent.get(comp.id);
    expect(snap?.dropped).toBe(5);
    expect(snap?.processed).toBe(0);
  });

  it("drop_probability 0 passes every request through", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cap = new RespondingCapability("proc" as CapabilityId, { throughputPerTier: 100 });
    const comp = makeComp("c1", 1.0, makeProfile(), cap); // healthy
    state.placeComponent(comp);
    state.visitOrder.push(comp.id);
    for (let i = 0; i < 5; i++) state.enqueuePending(comp.id, makeReq(`r${i}`));

    new Engine(state).tick(mc);

    const snap = state.metricsHistory[0]?.perComponent.get(comp.id);
    expect(snap?.dropped).toBe(0);
    expect(snap?.processed).toBe(5);
  });
});

import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { getEffectiveLatency } from "@core/engine/effective-bandwidth";
import { Component } from "@core/component/component";
import type { ConnectionId, ComponentId, PortId, CapabilityId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";
import { zonePairKey } from "@core/types/zone";

const healthy: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [{ kind: "latency_multiplier", factor: 2 }],
  criticalEffects: [{ kind: "latency_multiplier", factor: 3 }],
};

function makeComp(id: string, zone: string | null, condition = 1.0): Component {
  return new Component({
    id: id as ComponentId,
    type: "test",
    name: id,
    description: "",
    capabilities: new Map(),
    initialTiers: new Map<CapabilityId, number>(),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone,
    placementTick: 0,
    conditionProfile: healthy,
    initialCondition: condition,
  });
}

function setupCrossZone(
  sourceZone: string | null,
  targetZone: string | null,
  pairLatency: Map<string, number> = new Map(),
  baseLatency = 1,
): { state: SimulationState; connId: ConnectionId } {
  const state = new SimulationState({
    zones: ["na-east", "eu-west", "ap-south"],
    pairLatency,
  });
  const src = makeComp("src", sourceZone);
  const tgt = makeComp("tgt", targetZone);
  state.placeComponent(src);
  state.placeComponent(tgt);
  const connId = "c1" as ConnectionId;
  state.addConnection({
    id: connId,
    source: { componentId: "src" as ComponentId, portId: "p" as PortId },
    target: { componentId: "tgt" as ComponentId, portId: "p" as PortId },
    bandwidth: 100,
    latency: baseLatency,
    currentLoad: 0,
  });
  return { state, connId };
}

describe("getEffectiveLatency — zone-pair penalty", () => {
  it("adds zone-pair latency for cross-zone connection", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const { state, connId } = setupCrossZone("na-east", "eu-west", pairLatency);
    expect(getEffectiveLatency(state, connId)).toBe(4);
  });

  it("adds 0 for same-zone connection", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const { state, connId } = setupCrossZone("na-east", "na-east", pairLatency);
    expect(getEffectiveLatency(state, connId)).toBe(1);
  });

  it("adds 0 when source zone is null (backward compat)", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const { state, connId } = setupCrossZone(null, "eu-west", pairLatency);
    expect(getEffectiveLatency(state, connId)).toBe(1);
  });

  it("adds 0 when target zone is null (backward compat)", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const { state, connId } = setupCrossZone("na-east", null, pairLatency);
    expect(getEffectiveLatency(state, connId)).toBe(1);
  });

  it("zone penalty is NOT multiplied by condition degradation", () => {
    const pairLatency = new Map([[zonePairKey("na-east", "eu-west"), 3]]);
    const state = new SimulationState({
      zones: ["na-east", "eu-west"],
      pairLatency,
    });
    const src = makeComp("src", "na-east", 0.5);
    const tgt = makeComp("tgt", "eu-west");
    state.placeComponent(src);
    state.placeComponent(tgt);
    const connId = "c1" as ConnectionId;
    state.addConnection({
      id: connId,
      source: { componentId: "src" as ComponentId, portId: "p" as PortId },
      target: { componentId: "tgt" as ComponentId, portId: "p" as PortId },
      bandwidth: 100,
      latency: 1,
      currentLoad: 0,
    });
    // base(1) * condition(2) + zone(3) = 5, NOT (1 + 3) * 2 = 8
    expect(getEffectiveLatency(state, connId)).toBe(5);
  });
});

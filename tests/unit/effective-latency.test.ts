import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { getEffectiveLatency } from "@core/engine/effective-bandwidth";
import { Component } from "@core/component/component";
import type { ConnectionId, ComponentId, PortId, CapabilityId } from "@core/types/ids";
import type { ConditionProfile } from "@core/types/condition";

const healthy: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [{ kind: "latency_multiplier", factor: 2 }],
  criticalEffects: [{ kind: "latency_multiplier", factor: 3 }],
};

function makeSourceComp(id: string, condition: number): Component {
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
    zone: null,
    placementTick: 0,
    conditionProfile: healthy,
    initialCondition: condition,
  });
}

function addConnFrom(
  state: SimulationState,
  id: string,
  sourceId: string,
  latency = 10,
): ConnectionId {
  const cid = id as ConnectionId;
  state.addConnection({
    id: cid,
    source: { componentId: sourceId as ComponentId, portId: "p" as PortId },
    target: { componentId: "t" as ComponentId, portId: "p" as PortId },
    bandwidth: 100,
    latency,
    currentLoad: 0,
  });
  return cid;
}

describe("getEffectiveLatency", () => {
  it("returns raw latency when no chaos and source is healthy", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 1.0);
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    expect(getEffectiveLatency(state, cid)).toBe(10);
  });

  it("adds latency_injection extraLatency", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 1.0);
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    state.activeChaos.set("latency:c1", {
      event: { kind: "latency_injection", connectionId: cid, extraLatency: 50, durationTicks: 3 },
      expiresAtTick: 3,
    });
    expect(getEffectiveLatency(state, cid)).toBe(60);
  });

  it("applies source-component latency_multiplier at degraded tier", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 0.5); // degraded
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    expect(getEffectiveLatency(state, cid)).toBe(20); // 10 * 2
  });

  it("applies source-component latency_multiplier at critical tier", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 0.1); // critical
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    expect(getEffectiveLatency(state, cid)).toBe(30); // 10 * 3
  });

  it("chaos adder applies before condition multiplier", () => {
    // (base + extra) * multiplier
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const src = makeSourceComp("src", 0.5); // degraded → 2x
    state.placeComponent(src);
    const cid = addConnFrom(state, "c1", "src", 10);
    state.activeChaos.set("latency:c1", {
      event: { kind: "latency_injection", connectionId: cid, extraLatency: 5, durationTicks: 3 },
      expiresAtTick: 3,
    });
    expect(getEffectiveLatency(state, cid)).toBe(30); // (10 + 5) * 2
  });

  it("returns 0 for unknown connection id", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    expect(getEffectiveLatency(state, "ghost" as ConnectionId)).toBe(0);
  });

  it("ignores source component when it's missing", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cid = addConnFrom(state, "c1", "missing", 10);
    // No placed component — multiplier should default to 1.
    expect(getEffectiveLatency(state, cid)).toBe(10);
  });

  it("all engine-internal latency reads go through getEffectiveLatency (grep invariant)", async () => {
    // This test documents the rule by grepping source. It is a cheap guard
    // against future drift. The implementation rule: no file under
    // src/core/engine/ should read `.latency` on a Connection except
    // effective-bandwidth.ts itself.
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = "src/core/engine";
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      if (name === "effective-bandwidth.ts") continue;
      const content = readFileSync(join(dir, name), "utf8");
      // match `.latency` that is not part of `.latencyAdded`
      const re = /\.latency(?!Added)\b/g;
      if (re.test(content)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

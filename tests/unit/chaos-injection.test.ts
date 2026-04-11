import { describe, it, expect, beforeEach } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { injectChaos } from "@core/engine/stubs";
import { Component } from "@core/component/component";
import type { ComponentId, CapabilityId, ConnectionId } from "@core/types/ids";
import type { ChaosEvent } from "@core/types/chaos";
import type { ConditionProfile } from "@core/types/condition";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { ModeController } from "@core/mode/mode-controller";

const profile: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [],
  criticalEffects: [],
};

function makeComp(id: string, zone: string | null = null): Component {
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
    conditionProfile: profile,
    initialCondition: 1.0,
  });
}

class FakeChaosMc extends NoOpModeController {
  constructor(private readonly schedule: ReadonlyMap<number, readonly ChaosEvent[]>) {
    super({ targetEntryPointId: "x" as ComponentId, intensity: 0, requestType: "api_read" });
  }
  override getScheduledChaos(tick: number): readonly ChaosEvent[] {
    return this.schedule.get(tick) ?? [];
  }
}

function fresh(): SimulationState {
  return new SimulationState({ zones: [], pairLatency: new Map() });
}

describe("injectChaos", () => {
  let state: SimulationState;

  beforeEach(() => {
    state = fresh();
  });

  it("component_failure: zeros condition and registers an entry", () => {
    const c = makeComp("c1");
    state.placeComponent(c);
    const mc: ModeController = new FakeChaosMc(
      new Map([[0, [{ kind: "component_failure", componentId: c.id }]]]),
    );
    injectChaos(state, mc);
    expect(c.condition).toBe(0);
    expect(state.activeChaos.has("component:c1")).toBe(true);
  });

  it("zone_outage: zeros every component in the zone", () => {
    const a = makeComp("a", "us-east");
    const b = makeComp("b", "us-east");
    const c = makeComp("c", "eu-west");
    state.placeComponent(a);
    state.placeComponent(b);
    state.placeComponent(c);
    const mc = new FakeChaosMc(
      new Map([[0, [{ kind: "zone_outage", zone: "us-east", durationTicks: 5 }]]]),
    );
    injectChaos(state, mc);
    expect(a.condition).toBe(0);
    expect(b.condition).toBe(0);
    expect(c.condition).toBe(1);
    expect(state.activeChaos.has("zone:us-east")).toBe(true);
  });

  it("component_failure entry expires after one tick", () => {
    const c = makeComp("c1");
    state.placeComponent(c);
    const mc = new FakeChaosMc(
      new Map([[0, [{ kind: "component_failure", componentId: c.id }]]]),
    );
    injectChaos(state, mc);
    expect(state.activeChaos.size).toBe(1);
    state.currentTick = 1;
    injectChaos(state, mc); // no new events scheduled at tick 1
    expect(state.activeChaos.size).toBe(0);
  });

  it("connection_sever: stores with sever: prefix, does NOT touch condition", () => {
    const c = makeComp("c1");
    state.placeComponent(c);
    const mc = new FakeChaosMc(
      new Map([[0, [{
        kind: "connection_sever",
        connectionId: "conn-1" as ConnectionId,
        durationTicks: 3,
      }]]]),
    );
    injectChaos(state, mc);
    expect(state.activeChaos.has("sever:conn-1")).toBe(true);
    expect(c.condition).toBe(1);
  });

  it("latency_injection: stores with latency: prefix", () => {
    const mc = new FakeChaosMc(
      new Map([[0, [{
        kind: "latency_injection",
        connectionId: "conn-1" as ConnectionId,
        extraLatency: 50,
        durationTicks: 2,
      }]]]),
    );
    injectChaos(state, mc);
    expect(state.activeChaos.has("latency:conn-1")).toBe(true);
  });

  it("sever and latency on same connection coexist under distinct keys", () => {
    const mc = new FakeChaosMc(
      new Map([[0, [
        { kind: "connection_sever", connectionId: "c" as ConnectionId, durationTicks: 3 },
        { kind: "latency_injection", connectionId: "c" as ConnectionId, extraLatency: 10, durationTicks: 3 },
      ]]]),
    );
    injectChaos(state, mc);
    expect(state.activeChaos.size).toBe(2);
    expect(state.activeChaos.has("sever:c")).toBe(true);
    expect(state.activeChaos.has("latency:c")).toBe(true);
  });

  it("later latency_injection on the same key replaces the earlier one", () => {
    const first: ChaosEvent = {
      kind: "latency_injection",
      connectionId: "c" as ConnectionId,
      extraLatency: 10,
      durationTicks: 5,
    };
    const second: ChaosEvent = {
      kind: "latency_injection",
      connectionId: "c" as ConnectionId,
      extraLatency: 99,
      durationTicks: 5,
    };
    const mc = new FakeChaosMc(new Map([[0, [first, second]]]));
    injectChaos(state, mc);
    const entry = state.activeChaos.get("latency:c");
    expect(entry).toBeDefined();
    expect((entry!.event as { extraLatency: number }).extraLatency).toBe(99);
  });

  it("zone_outage re-applies condition=0 on every tick of its duration", () => {
    const a = makeComp("a", "us-east");
    state.placeComponent(a);
    const mc = new FakeChaosMc(
      new Map([[0, [{ kind: "zone_outage", zone: "us-east", durationTicks: 3 }]]]),
    );
    // Tick 0: inject
    injectChaos(state, mc);
    expect(a.condition).toBe(0);
    // Recovery would nudge it up, simulate by setting condition directly.
    a.condition = 0.5;
    state.currentTick = 1;
    injectChaos(state, mc);
    expect(a.condition).toBe(0); // re-applied
    a.condition = 0.5;
    state.currentTick = 2;
    injectChaos(state, mc);
    expect(a.condition).toBe(0);
    a.condition = 0.5;
    state.currentTick = 3; // expires at tick 3 (expiresAtTick = 0 + 3 = 3)
    injectChaos(state, mc);
    expect(a.condition).toBe(0.5); // no re-apply after expiry
  });

  it("sweeps expired entries before inserting new ones (same-tick re-arm)", () => {
    const c = makeComp("c1");
    state.placeComponent(c);
    const mc = new FakeChaosMc(new Map([
      [0, [{ kind: "component_failure", componentId: c.id }]],
      [1, [{ kind: "component_failure", componentId: c.id }]],
    ]));
    injectChaos(state, mc);
    expect(state.activeChaos.size).toBe(1);
    state.currentTick = 1;
    injectChaos(state, mc); // old entry expires, new one inserted same tick
    expect(state.activeChaos.size).toBe(1);
    expect(c.condition).toBe(0);
  });
});

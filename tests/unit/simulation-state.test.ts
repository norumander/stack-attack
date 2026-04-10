import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import type { ComponentId, ConnectionId, PortId, RequestId } from "@core/types/ids";
import type { Connection } from "@core/types/connection";
import type { Request } from "@core/types/request";
import type { ActiveStream } from "@core/types/stream";

const profile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [],
  criticalEffects: [],
};

function makeComp(id: string): Component {
  return new Component({
    id: id as ComponentId,
    type: "server",
    name: "S",
    description: "",
    capabilities: new Map(),
    initialTiers: new Map(),
    ports: [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
  });
}

function makeConn(id: string, from: string, to: string): Connection {
  return {
    id: id as ConnectionId,
    source: { componentId: from as ComponentId, portId: "p" as PortId },
    target: { componentId: to as ComponentId, portId: "p" as PortId },
    bandwidth: 10,
    latency: 1,
    currentLoad: 0,
  };
}

function makeReq(id: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "c-a" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("SimulationState", () => {
  it("placeComponent adds to components map", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const c = makeComp("c-a");
    state.placeComponent(c);
    expect(state.components.get("c-a" as ComponentId)).toBe(c);
  });

  it("enqueuePending and dequeuePending operate FIFO", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("c-a"));
    state.enqueuePending("c-a" as ComponentId, makeReq("r-1"));
    state.enqueuePending("c-a" as ComponentId, makeReq("r-2"));
    const first = state.dequeuePending("c-a" as ComponentId);
    const second = state.dequeuePending("c-a" as ComponentId);
    expect(first?.id).toBe("r-1");
    expect(second?.id).toBe("r-2");
    expect(state.dequeuePending("c-a" as ComponentId)).toBeUndefined();
  });

  it("appendEvent stores events keyed by request id", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.appendEvent("r-1" as RequestId, {
      tick: 0,
      componentId: "c-a" as ComponentId,
      capabilityId: null,
      connectionId: null,
      type: "ENTERED",
      latencyAdded: 0,
    });
    expect(state.requestLog.get("r-1" as RequestId)).toHaveLength(1);
  });

  it("advanceTick increments currentTick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    expect(state.currentTick).toBe(0);
    state.advanceTick();
    expect(state.currentTick).toBe(1);
  });

  it("addConnection/removeConnection manage connections map", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("c-a"));
    state.placeComponent(makeComp("c-b"));
    state.addConnection(makeConn("cx-1", "c-a", "c-b"));
    expect(state.connections.has("cx-1" as ConnectionId)).toBe(true);
    state.removeConnection("cx-1" as ConnectionId);
    expect(state.connections.has("cx-1" as ConnectionId)).toBe(false);
  });

  it("registerActiveStream and releaseActiveStream manage streams", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const s: ActiveStream = {
      requestId: "r-1" as RequestId,
      connectionId: "cx-1" as ConnectionId,
      originComponentId: "c-a" as ComponentId,
      baseRevenue: 1,
      remainingDuration: 5,
      reservedBandwidth: 2,
    };
    state.registerActiveStream(s);
    expect(state.activeStreams.get("r-1" as RequestId)).toBe(s);
    state.releaseActiveStream("r-1" as RequestId);
    expect(state.activeStreams.has("r-1" as RequestId)).toBe(false);
  });

  it("setCondition clamps 0..1 and setInstanceCount updates the component", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("c-a"));
    state.setCondition("c-a" as ComponentId, 0.5);
    expect(state.components.get("c-a" as ComponentId)!.condition).toBe(0.5);
    state.setCondition("c-a" as ComponentId, 5);
    expect(state.components.get("c-a" as ComponentId)!.condition).toBe(1);
    state.setCondition("c-a" as ComponentId, -1);
    expect(state.components.get("c-a" as ComponentId)!.condition).toBe(0);
    state.setInstanceCount("c-a" as ComponentId, 3);
    expect(state.components.get("c-a" as ComponentId)!.instanceCount).toBe(3);
  });

  it("asReader narrows components to ComponentReader", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("c-a"));
    const reader = state.asReader();
    const c = reader.components.get("c-a" as ComponentId);
    expect(c?.id).toBe("c-a");
    // Compile-time check: upgrade() is not on ComponentReader
    // @ts-expect-error upgrade is not on ComponentReader
    c?.upgrade;
    expect(reader.currentTick).toBe(0);
    state.advanceTick();
    expect(reader.currentTick).toBe(1);
  });
});

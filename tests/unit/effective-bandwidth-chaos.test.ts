import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { getEffectiveBandwidth } from "@core/engine/effective-bandwidth";
import type { ConnectionId, ComponentId, PortId } from "@core/types/ids";

function addConn(state: SimulationState, id: string, bandwidth = 100, latency = 10): ConnectionId {
  const cid = id as ConnectionId;
  state.addConnection({
    id: cid,
    source: { componentId: "s" as ComponentId, portId: "p" as PortId },
    target: { componentId: "t" as ComponentId, portId: "p" as PortId },
    bandwidth,
    latency,
    currentLoad: 0,
  });
  return cid;
}

describe("getEffectiveBandwidth with chaos", () => {
  it("returns raw bandwidth when no chaos", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cid = addConn(state, "c1");
    expect(getEffectiveBandwidth(state, cid)).toBe(100);
  });

  it("returns 0 when a connection_sever entry matches", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const cid = addConn(state, "c1");
    state.activeChaos.set("sever:c1", {
      event: { kind: "connection_sever", connectionId: cid, durationTicks: 5 },
      expiresAtTick: 5,
    });
    expect(getEffectiveBandwidth(state, cid)).toBe(0);
  });

  it("ignores chaos targeting a different connection", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const a = addConn(state, "a");
    const b = addConn(state, "b");
    state.activeChaos.set("sever:a", {
      event: { kind: "connection_sever", connectionId: a, durationTicks: 5 },
      expiresAtTick: 5,
    });
    expect(getEffectiveBandwidth(state, b)).toBe(100);
  });
});

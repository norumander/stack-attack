import { describe, it, expect } from "vitest";
import { getEffectiveBandwidth, getEffectiveLatency } from "@core/engine/effective-bandwidth";
import { SimulationState } from "@core/state/simulation-state";
import { makeConnection } from "@harness/fixtures";
import type { ConnectionId, RequestId, ComponentId } from "@core/types/ids";

describe("getEffectiveBandwidth / getEffectiveLatency", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("returns raw bandwidth minus connection load minus stream reservations", () => {
    const state = new SimulationState(topo);
    const conn = makeConnection(
      "cx",
      { componentId: "a", portId: "p" },
      { componentId: "b", portId: "p" },
      { bandwidth: 100, latency: 5 },
    );
    state.addConnection(conn);
    expect(getEffectiveBandwidth(state, "cx" as ConnectionId)).toBe(100);

    state.connectionLoadThisTick.set("cx" as ConnectionId, 30);
    expect(getEffectiveBandwidth(state, "cx" as ConnectionId)).toBe(70);

    state.registerActiveStream({
      requestId: "s1" as RequestId,
      connectionId: "cx" as ConnectionId,
      originComponentId: "a" as ComponentId,
      baseRevenue: 0,
      remainingDuration: 10,
      reservedBandwidth: 20,
    });
    expect(getEffectiveBandwidth(state, "cx" as ConnectionId)).toBe(50);
  });

  it("returns 0 when connection is unknown", () => {
    const state = new SimulationState(topo);
    expect(getEffectiveBandwidth(state, "nope" as ConnectionId)).toBe(0);
    expect(getEffectiveLatency(state, "nope" as ConnectionId)).toBe(0);
  });

  it("returns raw latency in 2a", () => {
    const state = new SimulationState(topo);
    const conn = makeConnection(
      "cx",
      { componentId: "a", portId: "p" },
      { componentId: "b", portId: "p" },
      { latency: 7 },
    );
    state.addConnection(conn);
    expect(getEffectiveLatency(state, "cx" as ConnectionId)).toBe(7);
  });
});

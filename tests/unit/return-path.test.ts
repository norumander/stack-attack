import { describe, it, expect } from "vitest";
import { reconstructReturnPath, pickStreamConnection } from "@core/engine/return-path.js";
import { SimulationState } from "@core/state/simulation-state.js";
import { makeConnection } from "@harness/fixtures.js";
import type { ConnectionId, RequestId, ComponentId } from "@core/types/ids.js";
import type { RequestEvent } from "@core/types/request.js";

describe("reconstructReturnPath", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("returns the TRAVERSED connection ids in reverse order", () => {
    const state = new SimulationState(topo);
    state.addConnection(makeConnection("cx-1", { componentId: "a", portId: "p" }, { componentId: "b", portId: "p" }, { latency: 3 }));
    state.addConnection(makeConnection("cx-2", { componentId: "b", portId: "p" }, { componentId: "c", portId: "p" }, { latency: 5 }));
    const req: RequestEvent[] = [
      { tick: 0, componentId: "a" as ComponentId, capabilityId: null, connectionId: "cx-1" as ConnectionId, type: "TRAVERSED", latencyAdded: 3 },
      { tick: 0, componentId: "b" as ComponentId, capabilityId: null, connectionId: "cx-2" as ConnectionId, type: "TRAVERSED", latencyAdded: 5 },
    ];
    state.requestLog.set("r1" as RequestId, req);
    const path = reconstructReturnPath(state, "r1" as RequestId);
    expect(path.reverseConnectionIds).toEqual(["cx-2", "cx-1"]);
    expect(path.returnLatency).toBe(8);
    expect(path.forwardLatency).toBe(8);
  });

  it("returns an empty path for locally resolved requests", () => {
    const state = new SimulationState(topo);
    state.requestLog.set("r1" as RequestId, []);
    const path = reconstructReturnPath(state, "r1" as RequestId);
    expect(path.reverseConnectionIds).toEqual([]);
    expect(path.returnLatency).toBe(0);
    expect(path.forwardLatency).toBe(0);
  });
});

describe("pickStreamConnection", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("returns the last TRAVERSED connection id", () => {
    const state = new SimulationState(topo);
    state.addConnection(makeConnection("cx-1", { componentId: "a", portId: "p" }, { componentId: "b", portId: "p" }));
    const evs: RequestEvent[] = [
      { tick: 0, componentId: "a" as ComponentId, capabilityId: null, connectionId: "cx-1" as ConnectionId, type: "TRAVERSED", latencyAdded: 0 },
    ];
    state.requestLog.set("r1" as RequestId, evs);
    expect(pickStreamConnection(state, "r1" as RequestId, "a" as ComponentId)).toBe("cx-1");
  });

  it("falls back to first egress by sorted id when no TRAVERSED events", () => {
    const state = new SimulationState(topo);
    state.addConnection(makeConnection("cx-b", { componentId: "src", portId: "p" }, { componentId: "x", portId: "p" }));
    state.addConnection(makeConnection("cx-a", { componentId: "src", portId: "p" }, { componentId: "y", portId: "p" }));
    state.requestLog.set("r1" as RequestId, []);
    expect(pickStreamConnection(state, "r1" as RequestId, "src" as ComponentId)).toBe("cx-a");
  });

  it("returns null when no forward path and no egress connections", () => {
    const state = new SimulationState(topo);
    state.requestLog.set("r1" as RequestId, []);
    expect(pickStreamConnection(state, "r1" as RequestId, "lonely" as ComponentId)).toBe(null);
  });
});

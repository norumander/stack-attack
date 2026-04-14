import { describe, expect, it } from "vitest";
import { applyTickToRenderer } from "../../src/dashboard/render/state-to-renderer.js";
import { SimulationState } from "../../src/core/state/simulation-state.js";
import type { Connection } from "../../src/core/types/connection.js";
import type { TickMetrics } from "../../src/core/types/metrics.js";
import type { SpawnRequestDotArgs, TopologyRenderer } from "../../src/dashboard/render/topology-renderer.js";
import type { ComponentId, ConnectionId, PortId, RequestId } from "../../src/core/types/ids.js";

function makeState(): SimulationState {
  const state = new SimulationState({ zones: [], pairLatency: new Map() });
  // Minimal tick metrics so applyTickToRenderer doesn't bail early.
  const metrics: TickMetrics = {
    tick: 0,
    requestsProcessed: 0,
    requestsResolved: 0,
    requestsDropped: 0,
    requestsOverloaded: 0,
    requestsBackpressured: 0,
    requestsTimedOut: 0,
    revenueEarned: 0,
    upkeepPaid: 0,
    avgLatency: 0,
    perComponent: new Map(),
  };
  state.metricsHistory.push(metrics);
  // One connection is enough for the stagger test.
  const conn: Connection = {
    id: "c-client-server" as ConnectionId,
    source: { componentId: "client" as ComponentId, portId: "p-out" as PortId },
    target: { componentId: "server" as ComponentId, portId: "p-in" as PortId },
    bandwidth: 1000,
    latency: 1,
    currentLoad: 0,
  };
  state.connections.set(conn.id, conn);
  return state;
}

function recordingRenderer(): { renderer: TopologyRenderer; spawns: SpawnRequestDotArgs[] } {
  const spawns: SpawnRequestDotArgs[] = [];
  const renderer: TopologyRenderer = {
    mount: async () => {},
    destroy: () => {},
    resize: () => {},
    addComponent: () => {},
    removeComponent: () => {},
    updateComponent: () => {},
    addConnection: () => {},
    removeConnection: () => {},
    updateConnection: () => {},
    spawnRequestDot: (args) => { spawns.push(args); },
    flashOverload: () => {},
    flashDrop: () => {},
    flashResponded: () => {},
    queueFlashOnRequestArrival: () => {},
    setSelected: () => {},
    setPlacementGhost: () => {},
    hitTest: () => null,
    screenToGrid: (x, y) => ({ x, y }),
    worldToScreen: (p) => ({ x: p.x, y: p.y }),
    onPointerDown: () => () => {},
    onPointerMove: () => () => {},
  };
  return { renderer, spawns };
}

describe("applyTickToRenderer: dot spawn staggering", () => {
  it("assigns incrementing spawnOffsetMs to dots on the same connection in one tick", () => {
    const state = makeState();
    const connId = "c-client-server" as ConnectionId;
    const serverId = "server" as ComponentId;
    // Simulate 5 FORWARDED events on the same connection in one tick
    // (what you'd get from 3 reads + 2 writes all arriving at Server).
    for (let i = 0; i < 5; i++) {
      state.lastTickEvents.push({
        type: "FORWARDED",
        tick: 0,
        componentId: serverId,
        capabilityId: null,
        requestId: `r${i}` as RequestId,
        connectionId: connId,
        latencyAdded: 0,
        metadata: { requestType: i < 3 ? "api_read" : "api_write" },
      });
    }

    const { renderer, spawns } = recordingRenderer();
    applyTickToRenderer(state, renderer, 200);

    expect(spawns).toHaveLength(5);
    expect(spawns.map((s) => s.spawnOffsetMs)).toEqual([0, 10, 20, 30, 40]);
    // Request types should be preserved and in order.
    expect(spawns.map((s) => s.requestType)).toEqual([
      "api_read",
      "api_read",
      "api_read",
      "api_write",
      "api_write",
    ]);
  });

  it("resets the counter per connection (same tick, different connections)", () => {
    const state = makeState();
    // Add a second connection so we have two distinct edges.
    const conn2: Connection = {
      id: "c-server-db" as ConnectionId,
      source: { componentId: "server" as ComponentId, portId: "p-out" as PortId },
      target: { componentId: "db" as ComponentId, portId: "p-in" as PortId },
      bandwidth: 1000,
      latency: 1,
      currentLoad: 0,
    };
    state.connections.set(conn2.id, conn2);

    // 2 events on conn1 then 2 on conn2 — each connection should start from 0.
    state.lastTickEvents.push({
      type: "FORWARDED", tick: 0, componentId: "server" as ComponentId,
      capabilityId: null, requestId: "r0" as RequestId,
      connectionId: "c-client-server" as ConnectionId, latencyAdded: 0,
      metadata: { requestType: "api_read" },
    });
    state.lastTickEvents.push({
      type: "FORWARDED", tick: 0, componentId: "server" as ComponentId,
      capabilityId: null, requestId: "r1" as RequestId,
      connectionId: "c-client-server" as ConnectionId, latencyAdded: 0,
      metadata: { requestType: "api_read" },
    });
    state.lastTickEvents.push({
      type: "FORWARDED", tick: 0, componentId: "db" as ComponentId,
      capabilityId: null, requestId: "r2" as RequestId,
      connectionId: "c-server-db" as ConnectionId, latencyAdded: 0,
      metadata: { requestType: "api_write" },
    });
    state.lastTickEvents.push({
      type: "FORWARDED", tick: 0, componentId: "db" as ComponentId,
      capabilityId: null, requestId: "r3" as RequestId,
      connectionId: "c-server-db" as ConnectionId, latencyAdded: 0,
      metadata: { requestType: "api_write" },
    });

    const { renderer, spawns } = recordingRenderer();
    applyTickToRenderer(state, renderer, 200);

    expect(spawns).toHaveLength(4);
    expect(spawns.map((s) => s.connectionId)).toEqual([
      "c-client-server", "c-client-server", "c-server-db", "c-server-db",
    ]);
    expect(spawns.map((s) => s.spawnOffsetMs)).toEqual([0, 10, 0, 10]);
  });
});

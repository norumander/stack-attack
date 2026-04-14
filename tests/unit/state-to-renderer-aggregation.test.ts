import { describe, expect, it } from "vitest";
import { applyTickToRenderer } from "../../src/dashboard/render/state-to-renderer.js";
import { SimulationState } from "../../src/core/state/simulation-state.js";
import type { Connection } from "../../src/core/types/connection.js";
import type { TickMetrics } from "../../src/core/types/metrics.js";
import type { SpawnRequestDotArgs, TopologyRenderer } from "../../src/dashboard/render/topology-renderer.js";
import type { ComponentId, ConnectionId, PortId, RequestId } from "../../src/core/types/ids.js";

function makeState(): SimulationState {
  const state = new SimulationState({ zones: [], pairLatency: new Map() });
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

type FlashCall = { requestId: RequestId; componentId: ComponentId; kind: string };

function recordingRenderer(): {
  renderer: TopologyRenderer;
  spawns: SpawnRequestDotArgs[];
  flashes: FlashCall[];
} {
  const spawns: SpawnRequestDotArgs[] = [];
  const flashes: FlashCall[] = [];
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
    queueFlashOnRequestArrival: (requestId, componentId, kind) => {
      flashes.push({ requestId, componentId, kind });
    },
    setSelected: () => {},
    setPlacementGhost: () => {},
    hitTest: () => null,
    screenToGrid: (x, y) => ({ x, y }),
    worldToScreen: (p) => ({ x: p.x, y: p.y }),
    onPointerDown: () => () => {},
    onPointerMove: () => () => {},
  };
  return { renderer, spawns, flashes };
}

describe("applyTickToRenderer: dot aggregation per (connection, requestType)", () => {
  it("collapses N reads on one connection into a single dot", () => {
    const state = makeState();
    const connId = "c-client-server" as ConnectionId;
    for (let i = 0; i < 10; i++) {
      state.lastTickEvents.push({
        type: "FORWARDED", tick: 0,
        componentId: "server" as ComponentId,
        capabilityId: null, requestId: `r${i}` as RequestId,
        connectionId: connId, latencyAdded: 0,
        metadata: { requestType: "api_read" },
      });
    }

    const { renderer, spawns } = recordingRenderer();
    applyTickToRenderer(state, renderer, 200);

    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.connectionId).toBe(connId);
    expect(spawns[0]!.requestType).toBe("api_read");
    expect(spawns[0]!.requestId).toBe("r0");
  });

  it("spawns separate dots per requestType on the same connection", () => {
    const state = makeState();
    const connId = "c-client-server" as ConnectionId;
    state.lastTickEvents.push(
      { type: "FORWARDED", tick: 0, componentId: "server" as ComponentId, capabilityId: null, requestId: "r0" as RequestId, connectionId: connId, latencyAdded: 0, metadata: { requestType: "api_read" } },
      { type: "FORWARDED", tick: 0, componentId: "server" as ComponentId, capabilityId: null, requestId: "r1" as RequestId, connectionId: connId, latencyAdded: 0, metadata: { requestType: "api_read" } },
      { type: "FORWARDED", tick: 0, componentId: "server" as ComponentId, capabilityId: null, requestId: "r2" as RequestId, connectionId: connId, latencyAdded: 0, metadata: { requestType: "api_read" } },
      { type: "FORWARDED", tick: 0, componentId: "server" as ComponentId, capabilityId: null, requestId: "w0" as RequestId, connectionId: connId, latencyAdded: 0, metadata: { requestType: "api_write" } },
      { type: "FORWARDED", tick: 0, componentId: "server" as ComponentId, capabilityId: null, requestId: "w1" as RequestId, connectionId: connId, latencyAdded: 0, metadata: { requestType: "api_write" } },
    );

    const { renderer, spawns } = recordingRenderer();
    applyTickToRenderer(state, renderer, 200);

    expect(spawns).toHaveLength(2);
    expect(spawns.map((s) => s.requestType).sort()).toEqual(["api_read", "api_write"]);
    const readDot = spawns.find((s) => s.requestType === "api_read")!;
    const writeDot = spawns.find((s) => s.requestType === "api_write")!;
    expect(readDot.requestId).toBe("r0");
    expect(writeDot.requestId).toBe("w0");
  });

  it("re-keys SERVED flashes of non-representative requests onto their rep", () => {
    const state = makeState();
    const connId = "c-client-server" as ConnectionId;
    const serverId = "server" as ComponentId;
    for (let i = 0; i < 3; i++) {
      state.lastTickEvents.push({
        type: "FORWARDED", tick: 0, componentId: serverId,
        capabilityId: null, requestId: `r${i}` as RequestId,
        connectionId: connId, latencyAdded: 0,
        metadata: { requestType: "api_read" },
      });
    }
    for (let i = 0; i < 3; i++) {
      state.lastTickEvents.push({
        type: "SERVED", tick: 0, componentId: serverId,
        capabilityId: null, requestId: `r${i}` as RequestId,
        connectionId: null, latencyAdded: 0,
      });
    }

    const { renderer, flashes } = recordingRenderer();
    applyTickToRenderer(state, renderer, 200);

    expect(flashes).toHaveLength(3);
    expect(flashes.every((f) => f.requestId === "r0")).toBe(true);
    expect(flashes.every((f) => f.componentId === serverId)).toBe(true);
    expect(flashes.every((f) => f.kind === "served")).toBe(true);
  });

  it("falls back to own requestId for flashes whose request didn't forward this tick", () => {
    const state = makeState();
    const serverId = "server" as ComponentId;
    state.lastTickEvents.push({
      type: "DROPPED", tick: 0, componentId: serverId,
      capabilityId: null, requestId: "ghost" as RequestId,
      connectionId: null, latencyAdded: 0,
    });

    const { renderer, flashes } = recordingRenderer();
    applyTickToRenderer(state, renderer, 200);

    expect(flashes).toHaveLength(1);
    expect(flashes[0]!.requestId).toBe("ghost");
    expect(flashes[0]!.kind).toBe("drop");
  });
});

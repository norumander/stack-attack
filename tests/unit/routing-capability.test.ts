import { describe, it, expect } from "vitest";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";
import type { Connection } from "@core/types/connection";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import type {
  CapabilityId,
  ComponentId,
  ConnectionId,
  PortId,
  RequestId,
} from "@core/types/ids";

const ROUTING_CAP_ID = "routing" as CapabilityId;

function makeConns(...ids: string[]): Connection[] {
  return ids.map((id) => ({
    id: id as ConnectionId,
    source: { componentId: "src" as ComponentId, portId: "out" as PortId },
    target: {
      componentId: `target-${id}` as ComponentId,
      portId: "in" as PortId,
    },
    bandwidth: 10,
    latency: 1,
    currentLoad: 0,
  }));
}

function makeState(): SimulationState {
  return new SimulationState({ zones: [], pairLatency: new Map() });
}

function makeCtx(
  state: SimulationState,
  effectiveTier: number,
  capId: CapabilityId = ROUTING_CAP_ID,
): ProcessContext {
  return {
    state: state.asReader(),
    componentId: "src" as ComponentId,
    effectiveTier,
    effectiveTiers: new Map([[capId, effectiveTier]]),
    activeCapabilityIds: new Set([capId]),
    currentTick: 0,
    rng: null as unknown as never,
    directories: [],
    childResponses: new Map(),
  };
}

function makeReq(): Request {
  return {
    id: "r1" as RequestId,
    parentId: null,
    type: "noop",
    payload: null,
    origin: "src" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("RoutingCapability — capability interface", () => {
  it("canHandle returns false for any request type", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    expect(cap.canHandle("any")).toBe(false);
    expect(cap.canHandle("noop")).toBe(false);
    expect(cap.canHandle("")).toBe(false);
  });

  it("process returns a PASS outcome with no side effects or events", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    const result = cap.process(makeReq(), makeCtx(state, 1));
    expect(result.outcome).toEqual({ kind: "PASS" });
    expect(result.sideEffects).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("has phase INTERCEPT", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    expect(cap.phase).toBe("INTERCEPT");
  });

  it("getUpkeepCost: T1=0, T2=2, T3=5", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    expect(cap.getUpkeepCost(1)).toBe(0);
    expect(cap.getUpkeepCost(2)).toBe(2);
    expect(cap.getUpkeepCost(3)).toBe(5);
  });
});

describe("RoutingCapability — T1 round-robin", () => {
  it("cycles through connections in order: a, b, c, a, ...", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    const ctx = makeCtx(state, 1);
    const conns = makeConns("a", "b", "c");

    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("a");
    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("b");
    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("c");
    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("a");
    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("b");
  });

  it("throws when called with no connections", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    expect(() =>
      cap.selectConnection(makeReq(), [], makeCtx(state, 1)),
    ).toThrow();
  });
});

describe("RoutingCapability — T2 least-load", () => {
  it("picks the connection with lowest currentLoad / bandwidth ratio", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    const conns = makeConns("a", "b", "c");
    conns[0]!.currentLoad = 5; // a: 0.5
    conns[1]!.currentLoad = 1; // b: 0.1 — winner
    conns[2]!.currentLoad = 8; // c: 0.8

    expect(cap.selectConnection(makeReq(), conns, makeCtx(state, 2))).toBe("b");
  });

  it("honors the ratio (not raw load) when bandwidths differ", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    const conns: Connection[] = [
      {
        id: "a" as ConnectionId,
        source: { componentId: "src" as ComponentId, portId: "out" as PortId },
        target: {
          componentId: "target-a" as ComponentId,
          portId: "in" as PortId,
        },
        bandwidth: 10,
        latency: 1,
        currentLoad: 4, // 0.4
      },
      {
        id: "b" as ConnectionId,
        source: { componentId: "src" as ComponentId, portId: "out" as PortId },
        target: {
          componentId: "target-b" as ComponentId,
          portId: "in" as PortId,
        },
        bandwidth: 100,
        latency: 1,
        currentLoad: 20, // 0.2 — winner despite higher raw load
      },
    ];

    expect(cap.selectConnection(makeReq(), conns, makeCtx(state, 2))).toBe("b");
  });

  it("breaks ties by iteration order (first wins)", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    const conns = makeConns("a", "b", "c");
    // All equal 0.3
    conns[0]!.currentLoad = 3;
    conns[1]!.currentLoad = 3;
    conns[2]!.currentLoad = 3;

    expect(cap.selectConnection(makeReq(), conns, makeCtx(state, 2))).toBe("a");
  });
});

describe("RoutingCapability — T3 condition-weighted", () => {
  function placeTargets(
    state: SimulationState,
    conditions: Record<string, number>,
  ): void {
    for (const [id, cond] of Object.entries(conditions)) {
      const comp = makeComponent({ id });
      comp.condition = cond;
      state.placeComponent(comp);
    }
  }

  it("prefers healthy + lightly-loaded targets", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    placeTargets(state, {
      "target-a": 0.3, // unhealthy
      "target-b": 1.0, // healthy — winner
    });
    const conns = makeConns("a", "b");
    // Both equally loaded; condition decides.
    conns[0]!.currentLoad = 2;
    conns[1]!.currentLoad = 2;

    expect(cap.selectConnection(makeReq(), conns, makeCtx(state, 3))).toBe("b");
  });

  it("scores condition * (1 - load/bandwidth); heavily loaded healthy loses to lightly loaded healthy", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    placeTargets(state, {
      "target-a": 1.0,
      "target-b": 1.0,
    });
    const conns = makeConns("a", "b");
    conns[0]!.currentLoad = 9; // score: 1.0 * 0.1 = 0.1
    conns[1]!.currentLoad = 1; // score: 1.0 * 0.9 = 0.9 — winner

    expect(cap.selectConnection(makeReq(), conns, makeCtx(state, 3))).toBe("b");
  });

  it("condition offsets light load: heavily loaded but super healthy can beat lightly loaded but unhealthy", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    placeTargets(state, {
      "target-a": 1.0, // score: 1.0 * 0.5 = 0.5 — winner
      "target-b": 0.1, // score: 0.1 * 0.9 = 0.09
    });
    const conns = makeConns("a", "b");
    conns[0]!.currentLoad = 5;
    conns[1]!.currentLoad = 1;

    expect(cap.selectConnection(makeReq(), conns, makeCtx(state, 3))).toBe("a");
  });

  it("falls back to round-robin when all connections are saturated", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    placeTargets(state, {
      "target-a": 1.0,
      "target-b": 1.0,
      "target-c": 1.0,
    });
    const conns = makeConns("a", "b", "c");
    for (const c of conns) c.currentLoad = c.bandwidth; // fully saturated

    const ctx = makeCtx(state, 3);
    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("a");
    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("b");
    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("c");
    expect(cap.selectConnection(makeReq(), conns, ctx)).toBe("a");
  });

  it("treats unknown target components as healthy (condition 1.0)", () => {
    const cap = new RoutingCapability(ROUTING_CAP_ID);
    const state = makeState();
    // No targets placed — state.components is empty.
    const conns = makeConns("a", "b");
    conns[0]!.currentLoad = 5; // score: 1.0 * 0.5 = 0.5
    conns[1]!.currentLoad = 1; // score: 1.0 * 0.9 = 0.9 — winner

    expect(cap.selectConnection(makeReq(), conns, makeCtx(state, 3))).toBe("b");
  });
});

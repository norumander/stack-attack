import { describe, it, expect } from "vitest";
import { runFixedPointLoop } from "@core/engine/fixed-point-loop";
import { SimulationState } from "@core/state/simulation-state";
import { FixedPointRunaway } from "@core/engine/errors";
import { computeVisitOrder } from "@core/engine/visit-order";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

function makeMC() {
  return new NoOpModeController({
    targetEntryPointId: "irrelevant" as ComponentId,
    intensity: 0,
    requestType: "api_read",
  });
}

function makeProcessCap(
  outcome: { kind: "PASS" } | { kind: "FORWARD" } | { kind: "RESPOND" } | { kind: "DROP"; reason: string },
  throughput = 100,
): Capability {
  return {
    id: "proc" as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
    getThroughputPerTick: () => throughput,
  };
}

function makeReq(id: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "c-client" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("runFixedPointLoop", () => {
  it("drains a multi-hop request to RESPOND in a single call (fixed-point convergence)", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // c-client forwards, c-lb forwards, c-server responds.
    const clientCaps = new Map<CapabilityId, Capability>([
      ["proc" as CapabilityId, makeProcessCap({ kind: "FORWARD" })],
    ]);
    const lbCaps = new Map<CapabilityId, Capability>([
      ["proc" as CapabilityId, makeProcessCap({ kind: "FORWARD" })],
    ]);
    const serverCaps = new Map<CapabilityId, Capability>([
      ["proc" as CapabilityId, makeProcessCap({ kind: "RESPOND" })],
    ]);

    const client = makeComponent({
      id: "c-client",
      ports: [makePort("p-out", "egress")],
      capabilities: clientCaps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    const lb = makeComponent({
      id: "c-lb",
      ports: [makePort("p-in", "ingress"), makePort("p-out", "egress")],
      capabilities: lbCaps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    const server = makeComponent({
      id: "c-server",
      ports: [makePort("p-in", "ingress")],
      capabilities: serverCaps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    state.placeComponent(client);
    state.placeComponent(lb);
    state.placeComponent(server);

    state.addConnection(
      makeConnection(
        "cx1",
        { componentId: "c-client", portId: "p-out" },
        { componentId: "c-lb", portId: "p-in" },
        { bandwidth: 100, latency: 1 },
      ),
    );
    state.addConnection(
      makeConnection(
        "cx2",
        { componentId: "c-lb", portId: "p-out" },
        { componentId: "c-server", portId: "p-in" },
        { bandwidth: 100, latency: 1 },
      ),
    );

    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = { ...makeReq("r-1"), origin: "c-client" as ComponentId };
    state.requestLog.set(req.id, []);
    state.enqueuePending(client.id, req);

    runFixedPointLoop(state, makeMC());

    // All pending queues drained.
    expect(state.pending.get(client.id) ?? []).toHaveLength(0);
    expect(state.pending.get(lb.id) ?? []).toHaveLength(0);
    expect(state.pending.get(server.id) ?? []).toHaveLength(0);

    // Event log shows the full journey to RESPONDED.
    const evs = state.requestLog.get(req.id)!;
    const types = evs.map((e) => e.type);
    expect(types).toContain("TRAVERSED");
    expect(types).toContain("FORWARDED");
    expect(types).toContain("RESPONDED");
  });

  it("returns immediately when nothing is pending and nothing is staged", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const caps = new Map<CapabilityId, Capability>([
      ["proc" as CapabilityId, makeProcessCap({ kind: "PASS" })],
    ]);
    const c = makeComponent({
      id: "c-1",
      capabilities: caps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    expect(() => runFixedPointLoop(state, makeMC())).not.toThrow();
    expect(state.stagedOutcomes).toHaveLength(0);
  });

  it("throws FixedPointRunaway when the loop never quiesces", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // Capability with throughput Infinity + always FORWARD.
    const cap: Capability = {
      id: "proc" as CapabilityId,
      phase: "PROCESS",
      canHandle: () => true,
      process: () => ({ outcome: { kind: "FORWARD" }, sideEffects: [], events: [] }),
      getUpkeepCost: () => 0,
      getStats: () => ({}),
      getThroughputPerTick: () => Number.POSITIVE_INFINITY,
    };
    const caps = new Map<CapabilityId, Capability>([["proc" as CapabilityId, cap]]);

    const c = makeComponent({
      id: "c-loop",
      ports: [makePort("p-out", "egress"), makePort("p-in", "ingress")],
      capabilities: caps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    state.placeComponent(c);

    // Self-loop connection with huge bandwidth — won't backpressure.
    state.addConnection(
      makeConnection(
        "cx-self",
        { componentId: "c-loop", portId: "p-out" },
        { componentId: "c-loop", portId: "p-in" },
        { bandwidth: 1_000_000, latency: 0 },
      ),
    );
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = { ...makeReq("r-1"), origin: "c-loop" as ComponentId };
    state.requestLog.set(req.id, []);
    state.enqueuePending(c.id, req);

    expect(() => runFixedPointLoop(state, makeMC())).toThrow(FixedPointRunaway);
  });
});

import { describe, it, expect } from "vitest";
import { recordMetrics } from "@core/engine/metrics-builder";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

describe("recordMetrics (step 8)", () => {
  const topo = { zones: [], pairLatency: new Map() };

  it("builds a TickMetrics snapshot with internal-to-public counter rename", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);

    state.perComponentThisTick.set(c.id, {
      processed: 5,
      drops: 1,
      timeouts: 2,
      overloaded: 3,
      backpressured: 4,
    });

    recordMetrics(state);

    expect(state.metricsHistory).toHaveLength(1);
    const snap = state.metricsHistory[0]!;
    expect(snap.tick).toBe(0);
    expect(snap.requestsProcessed).toBe(5);
    expect(snap.requestsDropped).toBe(1);
    expect(snap.requestsTimedOut).toBe(2);
    expect(snap.requestsOverloaded).toBe(3);
    expect(snap.requestsBackpressured).toBe(4);
    expect(snap.revenueEarned).toBe(0);
    expect(snap.upkeepPaid).toBe(0);

    const pc = snap.perComponent.get(c.id)!;
    expect(pc.processed).toBe(5);
    expect(pc.dropped).toBe(1);        // renamed from drops
    expect(pc.timedOut).toBe(2);       // renamed from timeouts
    expect(pc.overloaded).toBe(3);
    expect(pc.backpressured).toBe(4);
    expect(pc.condition).toBe(1.0);
    expect(pc.pendingAtEndOfTick).toBe(0);
    expect(pc.blockedAtEndOfTick).toBe(0);
  });

  it("computes avgLatency from RESPONDED events emitted this tick", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);
    state.currentTick = 5;

    // Two resolved requests with forwardLatency 10 and 20 -> avg 15.
    const r1Id = "r-1" as RequestId;
    const r2Id = "r-2" as RequestId;
    state.requestLog.set(r1Id, [
      {
        tick: 5,
        componentId: c.id,
        capabilityId: null,
        connectionId: null,
        type: "RESPONDED",
        latencyAdded: 0,
        metadata: { forwardLatency: 10, returnLatency: 0, returnPath: [] },
      },
    ]);
    state.requestLog.set(r2Id, [
      {
        tick: 5,
        componentId: c.id,
        capabilityId: null,
        connectionId: null,
        type: "RESPONDED",
        latencyAdded: 0,
        metadata: { forwardLatency: 20, returnLatency: 0, returnPath: [] },
      },
    ]);

    recordMetrics(state);

    const snap = state.metricsHistory[0]!;
    expect(snap.requestsResolved).toBe(2);
    expect(snap.avgLatency).toBe(15);
  });

  it("avgLatency is 0 and resolved is 0 when no RESPONDED events fired this tick", () => {
    const state = new SimulationState(topo);
    recordMetrics(state);
    const snap = state.metricsHistory[0]!;
    expect(snap.requestsResolved).toBe(0);
    expect(snap.avgLatency).toBe(0);
  });

  it("counts pendingAtEndOfTick from state.pending and blockedAtEndOfTick from blockedParents", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-1" });
    state.placeComponent(c);

    const r1 = {
      id: "r-1" as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: "c-1" as ComponentId,
      createdAt: 0,
      ttl: 100,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    } satisfies Request;
    state.enqueuePending(c.id, r1);
    state.enqueuePending(c.id, { ...r1, id: "r-2" as RequestId });

    const blockedParent = { ...r1, id: "r-bp" as RequestId };
    state.blockedParents.set(blockedParent.id, {
      request: blockedParent,
      originComponentId: c.id,
      blockedOn: new Set(),
      childResponses: new Map(),
    });

    recordMetrics(state);
    const pc = state.metricsHistory[0]!.perComponent.get(c.id)!;
    expect(pc.pendingAtEndOfTick).toBe(2);
    expect(pc.blockedAtEndOfTick).toBe(1);
  });

  it("history grows by exactly one snapshot per call", () => {
    const state = new SimulationState(topo);
    recordMetrics(state);
    recordMetrics(state);
    recordMetrics(state);
    expect(state.metricsHistory).toHaveLength(3);
  });

  it("initializes missing counter struct to zeros for components that had no activity", () => {
    const state = new SimulationState(topo);
    const c = makeComponent({ id: "c-quiet" });
    state.placeComponent(c);
    recordMetrics(state);
    const pc = state.metricsHistory[0]!.perComponent.get(c.id)!;
    expect(pc.processed).toBe(0);
    expect(pc.dropped).toBe(0);
    expect(pc.timedOut).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { sweepOverloaded } from "@core/engine/overloaded-sweep";
import { runFixedPointLoop } from "@core/engine/fixed-point-loop";
import { SimulationState } from "@core/state/simulation-state";
import { computeVisitOrder } from "@core/engine/visit-order";
import { makeComponent } from "@harness/fixtures";
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

function makeProcessCap(throughput: number): Capability {
  return {
    id: "proc" as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "RESPOND" }, sideEffects: [], events: [] }),
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
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("sweepOverloaded", () => {
  it("appends OVERLOADED events on leftovers after the fixed-point loop quiesces", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const caps = new Map<CapabilityId, Capability>([
      ["proc" as CapabilityId, makeProcessCap(3)],
    ]);
    const c = makeComponent({
      id: "c-1",
      capabilities: caps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const reqs: Request[] = [];
    for (let i = 0; i < 10; i++) {
      const r = makeReq(`r-${i}`);
      state.requestLog.set(r.id, []);
      state.enqueuePending(c.id, r);
      reqs.push(r);
    }

    runFixedPointLoop(state, makeMC());
    sweepOverloaded(state);

    // 3 processed (RESPOND); 7 still pending.
    expect(state.pending.get(c.id)).toHaveLength(7);
    expect(state.perComponentThisTick.get(c.id)?.processed).toBe(3);
    expect(state.perComponentThisTick.get(c.id)?.overloaded).toBe(7);

    // The 7 leftovers each have exactly one OVERLOADED event.
    const leftovers = state.pending.get(c.id)!;
    for (const req of leftovers) {
      const evs = state.requestLog.get(req.id)!;
      const overloadedEvents = evs.filter((e) => e.type === "OVERLOADED");
      expect(overloadedEvents).toHaveLength(1);
      expect(overloadedEvents[0]!.componentId).toBe(c.id);
    }

    // The 3 processed requests have NO OVERLOADED events (they were drained).
    const leftoverIds = new Set(leftovers.map((r) => r.id));
    const processedIds = new Set(reqs.map((r) => r.id).filter((id) => !leftoverIds.has(id)));
    expect(processedIds.size).toBe(3);
    for (const id of processedIds) {
      const evs = state.requestLog.get(id)!;
      expect(evs.some((e) => e.type === "OVERLOADED")).toBe(false);
    }
  });

  it("emits one OVERLOADED event per tick that a request remains stuck in pending", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    // throughput=0 means the gate blocks everything (componentThroughputPerTick = 0 * instanceCount = 0).
    const caps = new Map<CapabilityId, Capability>([
      ["proc" as CapabilityId, makeProcessCap(0)],
    ]);
    const c = makeComponent({
      id: "c-1",
      capabilities: caps,
      tiers: new Map([["proc" as CapabilityId, 1]]),
    });
    state.placeComponent(c);
    state.visitOrder.push(...computeVisitOrder(state.components));

    const r = makeReq("r-stuck");
    state.requestLog.set(r.id, []);
    state.enqueuePending(c.id, r);

    // Tick 1: loop runs, no progress, sweep fires OVERLOADED.
    runFixedPointLoop(state, makeMC());
    sweepOverloaded(state);

    // Advance to tick 2, reset per-tick counters (step 9 would do this in the full engine).
    state.perComponentThisTick.clear();
    state.connectionLoadThisTick.clear();
    state.advanceTick();

    // Tick 2: same request still stuck, loop runs, sweep fires another OVERLOADED.
    runFixedPointLoop(state, makeMC());
    sweepOverloaded(state);

    const evs = state.requestLog.get(r.id)!;
    const overloadedEvents = evs.filter((e) => e.type === "OVERLOADED");
    expect(overloadedEvents).toHaveLength(2);
    expect(state.pending.get(c.id)).toHaveLength(1); // still there
  });
});

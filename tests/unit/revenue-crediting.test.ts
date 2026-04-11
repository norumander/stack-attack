import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import { makeComponent } from "@harness/fixtures";
import { RespondingCapability } from "@harness/test-capabilities";
import { TestEconomyStrategy } from "@harness/test-economy";
import { TestChaosController } from "@harness/test-chaos-controller";

function makeRespondingComp(id: string) {
  const cap = new RespondingCapability("resp" as CapabilityId);
  return makeComponent({
    id,
    capabilities: new Map([["resp" as CapabilityId, cap]]),
    tiers: new Map([["resp" as CapabilityId, 1]]),
  });
}

function makeReq(id: string, originId: ComponentId): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: originId,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("revenue crediting at RESPONDED", () => {
  it("credits a non-stream root request exactly once", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.enqueuePending(comp.id, makeReq("r1", comp.id));
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 7,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(1);
    expect(economy.creditLog[0]?.amount).toBe(7);
    const totalCredited = economy.creditLog.reduce((s, e) => s + e.amount, 0);
    expect(totalCredited).toBe(7);
  });

  it("accumulates across multiple responses in one tick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.enqueuePending(comp.id, makeReq("r1", comp.id));
    state.enqueuePending(comp.id, makeReq("r2", comp.id));
    state.enqueuePending(comp.id, makeReq("r3", comp.id));
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 5,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(3);
    const totalCredited = economy.creditLog.reduce((s, e) => s + e.amount, 0);
    expect(totalCredited).toBe(15);
  });

  it("does NOT credit a child request", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    const req = makeReq("child", comp.id);
    state.enqueuePending(comp.id, req);
    // Mark as child of a fake parent so the crediting gate rejects it.
    state.childToParent.set(req.id, "parent" as RequestId);
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 99,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    expect(economy.creditLog.length).toBe(0);
  });

  it("resets revenueEarnedThisTick after metrics snapshot", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const comp = makeRespondingComp("c1");
    state.placeComponent(comp);
    state.enqueuePending(comp.id, makeReq("r1", comp.id));
    const economy = new TestEconomyStrategy({
      budget: 0,
      revenuePerRequest: 3,
    });
    const mc = new TestChaosController({ economy });

    new Engine(state).tick(mc);

    // Proves crediting fired (touched revenueEarnedThisTick) AND was cleared.
    expect(economy.creditLog.length).toBe(1);
    expect(economy.creditLog[0]?.amount).toBe(3);
    expect(state.revenueEarnedThisTick).toBe(0);
  });
});

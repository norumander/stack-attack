import { describe, it, expect } from "vitest";
import { SandboxEconomy } from "@modes/sandbox/sandbox-economy";
import type { Request } from "@core/types/request";
import type { ComponentId, RequestId } from "@core/types/ids";
import { SimulationState } from "@core/state/simulation-state";
import { makeComponent } from "@harness/fixtures";

function makeRequest(type: string): Request {
  return {
    id: `req-${type}` as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-origin" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("SandboxEconomy", () => {
  it("budget is always Infinity", () => {
    const econ = new SandboxEconomy();
    expect(econ.getBudget()).toBe(Infinity);
  });

  it("canAfford is always true", () => {
    const econ = new SandboxEconomy();
    expect(econ.canAfford(0)).toBe(true);
    expect(econ.canAfford(1_000_000)).toBe(true);
    expect(econ.canAfford(Infinity)).toBe(true);
  });

  it("creditRevenue tracks revenue by request type", () => {
    const econ = new SandboxEconomy();
    const amount = econ.creditRevenue(makeRequest("api_read"));
    expect(amount).toBe(1);
    expect(econ.totalRevenue).toBe(1);

    econ.creditRevenue(makeRequest("batch"));
    expect(econ.totalRevenue).toBe(6); // 1 + 5
  });

  it("creditRevenue uses default for unknown request types", () => {
    const econ = new SandboxEconomy();
    const amount = econ.creditRevenue(makeRequest("unknown_type"));
    expect(amount).toBe(1);
  });

  it("debitUpkeep tracks cumulative upkeep", () => {
    const econ = new SandboxEconomy();
    econ.debitUpkeep(10);
    econ.debitUpkeep(25);
    expect(econ.totalUpkeep).toBe(35);
  });

  it("debitPlacement tracks placement costs", () => {
    const econ = new SandboxEconomy();
    const comp = makeComponent({ id: "c-1" });
    econ.debitPlacement(comp);
    expect(econ.totalPlacement).toBe(0); // default placementCost is 0

    const comp2 = makeComponent({ id: "c-2" });
    // placementCost is readonly 0 from fixture, so totalPlacement stays 0
    econ.debitPlacement(comp2);
    expect(econ.totalPlacement).toBe(0);
  });

  it("debitUpgrade increments upgrade counter", () => {
    const econ = new SandboxEconomy();
    const comp = makeComponent({ id: "c-1" });
    econ.debitUpgrade(comp, "cap-1" as any);
    econ.debitUpgrade(comp, "cap-2" as any);
    expect(econ.totalUpgrade).toBe(2);
  });

  it("resolveInsolvency always returns empty array", () => {
    const econ = new SandboxEconomy();
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    expect(econ.resolveInsolvency(state.asReader())).toEqual([]);
  });

  it("starts with all totals at zero", () => {
    const econ = new SandboxEconomy();
    expect(econ.totalRevenue).toBe(0);
    expect(econ.totalUpkeep).toBe(0);
    expect(econ.totalPlacement).toBe(0);
    expect(econ.totalUpgrade).toBe(0);
  });
});

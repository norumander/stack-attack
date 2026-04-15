import { describe, it, expect } from "vitest";
import { TDEconomy } from "@modes/td/td-economy";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ComponentReader } from "@core/component/component-reader";

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-1" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function makeComponentReader(placementCost: number): ComponentReader {
  return {
    id: "c-1" as ComponentId,
    type: "server",
    placementCost,
    getCapabilityIds: () => [],
    getPlayerTier: () => 1,
    get instanceCount() { return 1; },
    get condition() { return 1.0; },
  } as unknown as ComponentReader;
}

describe("TDEconomy", () => {
  it("starts with the configured budget", () => {
    const econ = new TDEconomy({
      startingBudget: 500,
      revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
    });
    expect(econ.getBudget()).toBe(500);
  });

  it("credits revenue from the table", () => {
    const econ = new TDEconomy({
      startingBudget: 100,
      revenuePerRequestType: new Map([["api_read", 1], ["api_write", 2]]),
    });
    expect(econ.creditRevenue(req("api_read"))).toBe(1);
    expect(econ.creditRevenue(req("api_write"))).toBe(2);
    expect(econ.getBudget()).toBe(103);
  });

  it("returns 0 for unknown request types", () => {
    const econ = new TDEconomy({
      startingBudget: 100,
      revenuePerRequestType: new Map([["api_read", 1]]),
    });
    expect(econ.creditRevenue(req("unknown"))).toBe(0);
    expect(econ.getBudget()).toBe(100);
  });

  it("debits placement cost", () => {
    const econ = new TDEconomy({
      startingBudget: 500,
      revenuePerRequestType: new Map(),
    });
    econ.debitPlacement(makeComponentReader(150));
    expect(econ.getBudget()).toBe(350);
  });

  it("no-ops debitUpgrade in Stage 3a", () => {
    const econ = new TDEconomy({
      startingBudget: 500,
      revenuePerRequestType: new Map(),
    });
    econ.debitUpgrade(makeComponentReader(100), "processing" as any);
    expect(econ.getBudget()).toBe(500);
  });

  it("canAfford uses budget >= cost", () => {
    const econ = new TDEconomy({
      startingBudget: 100,
      revenuePerRequestType: new Map(),
    });
    expect(econ.canAfford(50)).toBe(true);
    expect(econ.canAfford(100)).toBe(true);
    expect(econ.canAfford(101)).toBe(false);
  });

  it("resolveInsolvency returns empty in Stage 3a", () => {
    const econ = new TDEconomy({
      startingBudget: -1000,
      revenuePerRequestType: new Map(),
    });
    expect(econ.resolveInsolvency({} as any)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { TDEconomy } from "@modes/td/td-economy";

describe("TDEconomy.debitUpkeep", () => {
  it("is a no-op — budget is not decremented", () => {
    const economy = new TDEconomy({
      startingBudget: 1000,
      revenuePerRequestType: new Map([["api_read", 1]]),
    });

    economy.debitUpkeep(50);
    economy.debitUpkeep(200);
    economy.debitUpkeep(9999);

    expect(economy.getBudget()).toBe(1000);
  });

  it("does not affect subsequent debit/credit operations", () => {
    const economy = new TDEconomy({
      startingBudget: 500,
      revenuePerRequestType: new Map([["api_read", 2]]),
    });

    economy.debitUpkeep(100);
    economy.creditRevenue({
      id: "r1",
      type: "api_read",
      originZone: null,
      createdAtTick: 0,
      ttl: 10,
    } as any);

    expect(economy.getBudget()).toBe(502);
  });
});

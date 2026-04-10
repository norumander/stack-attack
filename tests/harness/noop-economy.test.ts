import { describe, it, expect } from "vitest";
import { NoOpEconomy } from "@harness/noop-economy";
import type { Request } from "@core/types/request";
import type { RequestId, ComponentId } from "@core/types/ids";

function req(): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: "c-a" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("NoOpEconomy", () => {
  it("getBudget returns Infinity", () => {
    const e = new NoOpEconomy();
    expect(e.getBudget()).toBe(Infinity);
  });

  it("canAfford is always true", () => {
    const e = new NoOpEconomy();
    expect(e.canAfford(10_000_000)).toBe(true);
  });

  it("creditRevenue returns 0 (observation-only)", () => {
    const e = new NoOpEconomy();
    expect(e.creditRevenue(req())).toBe(0);
  });

  it("resolveInsolvency returns empty array", () => {
    const e = new NoOpEconomy();
    expect(e.resolveInsolvency({} as any)).toEqual([]);
  });
});

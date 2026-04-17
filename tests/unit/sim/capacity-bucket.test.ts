import { describe, it, expect } from "vitest";
import { CapacityBucket } from "@sim/capacity-bucket";

describe("CapacityBucket", () => {
  it("starts full", () => {
    const b = new CapacityBucket({ capacityPerSecond: 10 });
    expect(b.available()).toBe(10);
  });

  it("consume succeeds when credits sufficient", () => {
    const b = new CapacityBucket({ capacityPerSecond: 10 });
    expect(b.tryConsume(3)).toBe(true);
    expect(b.available()).toBe(7);
  });

  it("consume fails when credits insufficient", () => {
    const b = new CapacityBucket({ capacityPerSecond: 5 });
    expect(b.tryConsume(7)).toBe(false);
    expect(b.available()).toBe(5);
  });

  it("refills by capacityPerSecond × dt per step, capped at capacity", () => {
    const b = new CapacityBucket({ capacityPerSecond: 60 });
    b.tryConsume(60);
    expect(b.available()).toBe(0);
    b.refill(1 / 60);
    expect(b.available()).toBeCloseTo(1, 6);
    b.refill(10);
    expect(b.available()).toBe(60);
  });
});

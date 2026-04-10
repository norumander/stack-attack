import { describe, it, expect } from "vitest";
import { EMPTY_COUNTERS } from "@core/engine/per-component-counters";
import type { PerComponentTickCounters } from "@core/engine/per-component-counters";

describe("PerComponentTickCounters", () => {
  it("EMPTY_COUNTERS is fully zero", () => {
    expect(EMPTY_COUNTERS.processed).toBe(0);
    expect(EMPTY_COUNTERS.drops).toBe(0);
    expect(EMPTY_COUNTERS.timeouts).toBe(0);
    expect(EMPTY_COUNTERS.overloaded).toBe(0);
    expect(EMPTY_COUNTERS.backpressured).toBe(0);
  });

  it("EMPTY_COUNTERS is frozen", () => {
    expect(Object.isFrozen(EMPTY_COUNTERS)).toBe(true);
  });

  it("a mutable counters record increments", () => {
    const c: PerComponentTickCounters = {
      processed: 0,
      drops: 0,
      timeouts: 0,
      overloaded: 0,
      backpressured: 0,
    };
    c.processed += 1;
    expect(c.processed).toBe(1);
  });
});

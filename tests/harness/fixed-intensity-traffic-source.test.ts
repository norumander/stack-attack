import { describe, it, expect } from "vitest";
import { FixedIntensityTrafficSource } from "@harness/fixed-intensity-traffic-source";
import type { ComponentId } from "@core/types/ids";

describe("FixedIntensityTrafficSource", () => {
  it("generates `intensity` requests per tick with the given type", () => {
    const src = new FixedIntensityTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 3,
      requestType: "api_read",
    });
    const out = src.generate(0);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.type === "api_read")).toBe(true);
    expect(out.every((r) => r.origin === ("c-client" as ComponentId))).toBe(true);
    expect(out.every((r) => r.ttl === 10)).toBe(true);
  });

  it("produces sequential unique IDs across ticks", () => {
    const src = new FixedIntensityTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });
    const ids = [
      ...src.generate(0).map((r) => r.id),
      ...src.generate(1).map((r) => r.id),
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it("uses createdAt = tick argument", () => {
    const src = new FixedIntensityTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(src.generate(5)[0]?.createdAt).toBe(5);
  });
});

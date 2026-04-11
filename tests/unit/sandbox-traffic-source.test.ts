import { describe, it, expect } from "vitest";
import { SandboxTrafficSource, type SandboxTrafficConfig } from "@modes/sandbox/sandbox-traffic-source";
import type { ComponentId } from "@core/types/ids";

const TARGET = "c-entry" as ComponentId;

function makeConfig(overrides: Partial<SandboxTrafficConfig> = {}): SandboxTrafficConfig {
  return {
    targetEntryPointId: TARGET,
    requestType: "api_read",
    intensity: 10,
    pattern: "steady",
    ...overrides,
  };
}

describe("SandboxTrafficSource", () => {
  describe("steady pattern", () => {
    it("produces exact intensity requests per tick", () => {
      const source = new SandboxTrafficSource(makeConfig({ intensity: 5 }));
      const requests = source.generate(0);
      expect(requests).toHaveLength(5);

      const requests2 = source.generate(1);
      expect(requests2).toHaveLength(5);
    });

    it("generates requests with correct structure", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ requestType: "api_write", intensity: 1, ttl: 20, originZone: "us-east" }),
      );
      const [req] = source.generate(5);
      expect(req).toBeDefined();
      expect(req!.type).toBe("api_write");
      expect(req!.origin).toBe(TARGET);
      expect(req!.createdAt).toBe(5);
      expect(req!.ttl).toBe(20);
      expect(req!.originZone).toBe("us-east");
      expect(req!.parentId).toBeNull();
      expect(req!.streamDuration).toBeNull();
      expect(req!.streamBandwidth).toBeNull();
    });

    it("uses default TTL of 10 when not specified", () => {
      const source = new SandboxTrafficSource(makeConfig({ intensity: 1 }));
      const [req] = source.generate(0);
      expect(req!.ttl).toBe(10);
    });
  });

  describe("spike pattern", () => {
    it("doubles intensity for first 3 ticks of each 10-tick cycle", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 10, pattern: "spike" }),
      );

      // Ticks 0, 1, 2 are spike (doubled)
      expect(source.generate(0)).toHaveLength(20);
      expect(source.generate(1)).toHaveLength(20);
      expect(source.generate(2)).toHaveLength(20);

      // Ticks 3-9 are baseline
      expect(source.generate(3)).toHaveLength(10);
      expect(source.generate(5)).toHaveLength(10);
      expect(source.generate(9)).toHaveLength(10);

      // Tick 10 starts a new cycle — spike again
      expect(source.generate(10)).toHaveLength(20);
    });
  });

  describe("sine pattern", () => {
    it("oscillates between 0.5x and 1.5x intensity", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 100, pattern: "sine" }),
      );

      // Collect intensity across a full 20-tick period
      const counts: number[] = [];
      for (let t = 0; t < 20; t++) {
        counts.push(source.generate(t).length);
      }

      const min = Math.min(...counts);
      const max = Math.max(...counts);

      // Should vary — not all the same
      expect(max).toBeGreaterThan(min);
      // Min should be around 50, max around 150 (with rounding)
      expect(min).toBeGreaterThanOrEqual(50);
      expect(max).toBeLessThanOrEqual(150);
    });

    it("at tick 0 produces baseline intensity (sin(0) = 0, multiplier = 1)", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 10, pattern: "sine" }),
      );
      expect(source.generate(0)).toHaveLength(10);
    });
  });

  describe("reconfigure", () => {
    it("changes behavior on next generate call", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 5, pattern: "steady" }),
      );
      expect(source.generate(0)).toHaveLength(5);

      source.reconfigure(makeConfig({ intensity: 20, pattern: "steady" }));
      expect(source.generate(1)).toHaveLength(20);
    });
  });

  it("each request has a unique ID", () => {
    const source = new SandboxTrafficSource(makeConfig({ intensity: 3 }));
    const batch1 = source.generate(0);
    const batch2 = source.generate(1);
    const allIds = [...batch1, ...batch2].map((r) => r.id);
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  it("targetEntryPointId matches config", () => {
    const source = new SandboxTrafficSource(makeConfig());
    expect(source.targetEntryPointId).toBe(TARGET);
  });

  describe("ramp pattern", () => {
    it("produces 0 at tick 0", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 100, pattern: "ramp", rampDuration: 50 }),
      );
      expect(source.generate(0)).toHaveLength(0);
    });

    it("produces ~half intensity at half rampDuration", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 100, pattern: "ramp", rampDuration: 50 }),
      );
      expect(source.generate(25)).toHaveLength(50); // floor(100 * 25/50)
    });

    it("produces full intensity at rampDuration", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 100, pattern: "ramp", rampDuration: 50 }),
      );
      expect(source.generate(50)).toHaveLength(100);
    });

    it("holds at full intensity after rampDuration", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 100, pattern: "ramp", rampDuration: 50 }),
      );
      expect(source.generate(100)).toHaveLength(100);
      expect(source.generate(200)).toHaveLength(100);
    });

    it("uses default rampDuration of 50", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 100, pattern: "ramp" }),
      );
      // At tick 25 (half of default 50): floor(100 * 25/50) = 50
      expect(source.generate(25)).toHaveLength(50);
    });
  });

  describe("burst pattern", () => {
    it("produces burst intensity for burstDuration ticks", () => {
      const source = new SandboxTrafficSource(
        makeConfig({
          intensity: 10,
          pattern: "burst",
          burstDuration: 3,
          burstPeriod: 20,
          burstMultiplier: 5,
        }),
      );
      // Ticks 0, 1, 2 are burst: 10 * 5 = 50
      expect(source.generate(0)).toHaveLength(50);
      expect(source.generate(1)).toHaveLength(50);
      expect(source.generate(2)).toHaveLength(50);
    });

    it("produces 0 for remainder of period", () => {
      const source = new SandboxTrafficSource(
        makeConfig({
          intensity: 10,
          pattern: "burst",
          burstDuration: 3,
          burstPeriod: 20,
          burstMultiplier: 5,
        }),
      );
      expect(source.generate(3)).toHaveLength(0);
      expect(source.generate(10)).toHaveLength(0);
      expect(source.generate(19)).toHaveLength(0);
    });

    it("cycles correctly", () => {
      const source = new SandboxTrafficSource(
        makeConfig({
          intensity: 10,
          pattern: "burst",
          burstDuration: 3,
          burstPeriod: 20,
          burstMultiplier: 5,
        }),
      );
      // Tick 20 starts a new cycle
      expect(source.generate(20)).toHaveLength(50);
      expect(source.generate(23)).toHaveLength(0);
    });

    it("uses defaults (duration=3, period=30, multiplier=5)", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 10, pattern: "burst" }),
      );
      expect(source.generate(0)).toHaveLength(50); // 10 * 5
      expect(source.generate(3)).toHaveLength(0);
      expect(source.generate(30)).toHaveLength(50); // new cycle
    });
  });

  describe("requestTypeDistribution", () => {
    it("distributes types deterministically based on weights", () => {
      const source = new SandboxTrafficSource(
        makeConfig({
          intensity: 10,
          pattern: "steady",
          requestTypeDistribution: [
            { type: "api_read", weight: 6 },
            { type: "api_write", weight: 4 },
          ],
        }),
      );
      const requests = source.generate(0);
      expect(requests).toHaveLength(10);

      const counts = new Map<string, number>();
      for (const r of requests) {
        counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
      }
      expect(counts.get("api_read")).toBe(6);
      expect(counts.get("api_write")).toBe(4);
    });

    it("falls back to requestType when distribution is undefined", () => {
      const source = new SandboxTrafficSource(
        makeConfig({ intensity: 5, requestType: "api_read" }),
      );
      const requests = source.generate(0);
      for (const r of requests) {
        expect(r.type).toBe("api_read");
      }
    });

    it("falls back to requestType when distribution is empty", () => {
      const source = new SandboxTrafficSource(
        makeConfig({
          intensity: 3,
          requestType: "batch",
          requestTypeDistribution: [],
        }),
      );
      const requests = source.generate(0);
      for (const r of requests) {
        expect(r.type).toBe("batch");
      }
    });

    it("handles three-way distribution", () => {
      const source = new SandboxTrafficSource(
        makeConfig({
          intensity: 20,
          pattern: "steady",
          requestTypeDistribution: [
            { type: "api_read", weight: 10 },
            { type: "api_write", weight: 6 },
            { type: "static_asset", weight: 4 },
          ],
        }),
      );
      const requests = source.generate(0);
      const counts = new Map<string, number>();
      for (const r of requests) {
        counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
      }
      expect(counts.get("api_read")).toBe(10);
      expect(counts.get("api_write")).toBe(6);
      expect(counts.get("static_asset")).toBe(4);
    });

    it("reconfigure updates distribution", () => {
      const source = new SandboxTrafficSource(
        makeConfig({
          intensity: 10,
          requestTypeDistribution: [
            { type: "api_read", weight: 5 },
            { type: "api_write", weight: 5 },
          ],
        }),
      );

      source.reconfigure(
        makeConfig({
          intensity: 10,
          requestTypeDistribution: [
            { type: "batch", weight: 10 },
          ],
        }),
      );

      const requests = source.generate(0);
      for (const r of requests) {
        expect(r.type).toBe("batch");
      }
    });
  });
});

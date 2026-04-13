import { describe, it, expect } from "vitest";
import { TDTrafficSource } from "@modes/td/td-traffic-source";
import { WAVE_1 } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe("TDTrafficSource", () => {
  it("generates the wave's intensity count per tick", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    expect(reqs.length).toBe(WAVE_1.intensity);
  });

  it("sets request.type from composition", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    for (const r of reqs) {
      expect(r.type).toBe("api_read"); // WAVE_1 is 100% api_read
    }
  });

  it("sets request.ttl from the wave", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    for (const r of reqs) {
      expect(r.ttl).toBe(WAVE_1.ttl);
    }
  });

  it("sets origin to the target entry point", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    for (const r of reqs) {
      expect(r.origin).toBe("c-server");
    }
  });

  it("sets api_read payloads to distinguishable keys from the pool", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const reqs = src.generate(0);
    const payloads = new Set(reqs.map((r) => r.payload));
    // With a pool of 20 and intensity of 10, we should see multiple
    // distinct values (not all collapsed to one). Weak but meaningful.
    expect(payloads.size).toBeGreaterThan(1);
    for (const p of payloads) {
      expect(typeof p).toBe("string");
      expect(String(p)).toMatch(/^read-\d+$/);
    }
  });

  it("generates unique request IDs across ticks", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    const t0 = src.generate(0);
    const t1 = src.generate(1);
    const ids = new Set([...t0, ...t1].map((r) => r.id));
    expect(ids.size).toBe(t0.length + t1.length);
  });

  it("stops generating after wave.duration ticks", () => {
    const src = new TDTrafficSource({
      wave: WAVE_1,
      targetEntryPointId: "c-server" as ComponentId,
      rng: makeRng(1),
    });
    // Call generate() WAVE_1.duration times to exhaust the internal counter
    for (let i = 0; i < WAVE_1.duration; i++) {
      src.generate(i);
    }
    // The next call should return empty
    const afterEnd = src.generate(WAVE_1.duration);
    expect(afterEnd.length).toBe(0);
  });
});

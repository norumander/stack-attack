import { describe, it, beforeEach, expect } from "vitest";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { resetIdCountersForTest } from "@sim/packet";
import type { ComponentId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 25,
  packetRate: 5,
  duration: 30,
  composition: { writeRatio: 0.3, authRatio: 0.2, streamRatio: 0, largeRatio: 0 },
  keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
  entryClients: ["c1" as ComponentId],
};

describe("TrafficSource — determinism", () => {
  beforeEach(() => resetIdCountersForTest());

  it("two sources with same seed produce identical packet streams", () => {
    const tsA = new TrafficSource(wave, makeSimRng(42));
    const tsB = new TrafficSource(wave, makeSimRng(42));
    for (let i = 0; i < 50; i += 1) {
      const a = tsA.generatePacketForTest("c1" as ComponentId, 0);
      const b = tsB.generatePacketForTest("c1" as ComponentId, 0);
      expect(b.requests.length).toBe(a.requests.length);
      for (let j = 0; j < a.requests.length; j += 1) {
        expect(b.requests[j]!.isWrite).toBe(a.requests[j]!.isWrite);
        expect(b.requests[j]!.requiresAuth).toBe(a.requests[j]!.requiresAuth);
        expect(b.requests[j]!.key).toBe(a.requests[j]!.key);
      }
    }
  });
});

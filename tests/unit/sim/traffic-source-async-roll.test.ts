import { describe, it, beforeEach, expect } from "vitest";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { resetIdCountersForTest } from "@sim/packet";
import type { ComponentId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const wave: WaveDef = {
  intensity: 10,
  packetRate: 5,
  duration: 60,
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0.25 },
  keyDistribution: { kind: "uniform", spaceSize: 10 },
  entryClients: ["c1" as ComponentId],
};

describe("TrafficSource — async roll", () => {
  beforeEach(() => resetIdCountersForTest());

  it("produces ~asyncRatio async packets", () => {
    const ts = new TrafficSource(wave, makeSimRng(5));
    let asyncCount = 0;
    const total = 5000;
    for (let i = 0; i < total; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      if (pkt.requests[0]!.isAsync) asyncCount += 1;
    }
    const ratio = asyncCount / total;
    expect(ratio).toBeGreaterThan(0.20);
    expect(ratio).toBeLessThan(0.30);
  });
});

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
  composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 100 },
  entryClients: ["c1" as ComponentId],
};

describe("TrafficSource — attribute rolls", () => {
  beforeEach(() => resetIdCountersForTest());

  it("produces ~writeRatio writes over many packets", () => {
    const ts = new TrafficSource(wave, makeSimRng(1));
    let writes = 0;
    let total = 0;
    for (let i = 0; i < 5_000; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      total += 1;
      if (pkt.requests[0]!.isWrite) writes += 1;
    }
    const ratio = writes / total;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it("packets are uniform — all writes or all reads, never mixed", () => {
    const ts = new TrafficSource(wave, makeSimRng(2));
    for (let i = 0; i < 200; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      const writeCount = pkt.requests.filter((r) => r.isWrite).length;
      expect(writeCount === 0 || writeCount === pkt.requests.length).toBe(true);
    }
  });

  it("packet count = round(intensity / packetRate) = 2", () => {
    const ts = new TrafficSource(wave, makeSimRng(3));
    for (let i = 0; i < 10; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      expect(pkt.requests.length).toBe(2);
    }
  });
});

import { describe, it, beforeEach, expect } from "vitest";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { resetIdCountersForTest } from "@sim/packet";
import type { ComponentId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

describe("TrafficSource — key rolls", () => {
  beforeEach(() => resetIdCountersForTest());

  it("zipf distribution clusters on key0 (hot key)", () => {
    const wave: WaveDef = {
      intensity: 10,
      packetRate: 5,
      duration: 60,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.5, spaceSize: 10 },
      revenue: { perRead: 1, perWrite: 1, perAuth: 1, perStream: 1 },
      entryClients: ["c1" as ComponentId],
    };
    const ts = new TrafficSource(wave, makeSimRng(1));
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      for (const r of pkt.requests) {
        counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
      }
    }
    expect(counts.get("k0")! ).toBeGreaterThan(counts.get("k9") ?? 0);
  });
});

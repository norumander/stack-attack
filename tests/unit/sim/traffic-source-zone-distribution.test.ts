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
  composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 100 },
  revenue: { perRead: 1, perWrite: 1, perAuth: 1, perStream: 1, perAsync: 1 },
  zoneDistribution: new Map<string, number>([["NA", 0.5], ["EU", 0.3], ["AP", 0.2]]),
  entryClients: ["c1" as ComponentId],
};

describe("TrafficSource — zone distribution", () => {
  beforeEach(() => resetIdCountersForTest());

  it("rolls originZone from the wave's zoneDistribution per packet", () => {
    const ts = new TrafficSource(wave, makeSimRng(11));
    const counts = new Map<string, number>();
    for (let i = 0; i < 5_000; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      const zone = pkt.requests[0]!.originZone ?? "null";
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }
    expect(counts.get("NA")! / 5000).toBeGreaterThan(0.42);
    expect(counts.get("NA")! / 5000).toBeLessThan(0.58);
    expect(counts.get("EU")! / 5000).toBeGreaterThan(0.22);
    expect(counts.get("EU")! / 5000).toBeLessThan(0.38);
    expect(counts.get("AP")! / 5000).toBeGreaterThan(0.13);
    expect(counts.get("AP")! / 5000).toBeLessThan(0.27);
    expect(counts.get("null") ?? 0).toBe(0);
  });

  it("all requests in a packet share the same originZone", () => {
    const ts = new TrafficSource({ ...wave, intensity: 50, packetRate: 5 }, makeSimRng(13));
    for (let i = 0; i < 200; i += 1) {
      const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
      const zones = new Set(pkt.requests.map((r) => r.originZone));
      expect(zones.size).toBe(1);
    }
  });

  it("falls back to null originZone when zoneDistribution is absent", () => {
    const { zoneDistribution: _omit, ...rest } = wave;
    const noZoneWave: WaveDef = rest;
    const ts = new TrafficSource(noZoneWave, makeSimRng(17));
    const pkt = ts.generatePacketForTest("c1" as ComponentId, 0);
    expect(pkt.requests[0]!.originZone).toBeNull();
  });
});

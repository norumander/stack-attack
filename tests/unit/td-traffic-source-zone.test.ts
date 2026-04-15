import { describe, it, expect } from "vitest";
import { TDTrafficSource } from "@modes/td/td-traffic-source";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const ZONE_WAVE: TDWaveDefinition = {
  id: 99,
  name: "Zone Test",
  startingBudget: 1000,
  intensity: 100,
  composition: new Map([["api_read", 1.0]]),
  duration: 5,
  ttl: 10,
  availableComponents: ["server"],
  dropThreshold: 0.05,
  viabilityPerFailure: 0.1,
  viabilityRampPenalty: 0.5,
  revenuePerRequestType: new Map([["api_read", 1]]),
  keyPoolSize: 10,
  connectionBandwidth: 100,
  zoneDistribution: new Map([
    ["na-east", 0.40],
    ["eu-west", 0.35],
    ["ap-south", 0.25],
  ]),
  sla: { availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 5 },
};

const NO_ZONE_WAVE: TDWaveDefinition = {
  id: 98,
  name: "No Zone Test",
  startingBudget: 1000,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 5,
  ttl: 10,
  availableComponents: ["server"],
  dropThreshold: 0.05,
  viabilityPerFailure: 0.1,
  viabilityRampPenalty: 0.5,
  revenuePerRequestType: new Map([["api_read", 1]]),
  keyPoolSize: 10,
  connectionBandwidth: 100,
  sla: { availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 5 },
};

describe("TDTrafficSource zone assignment", () => {
  it("assigns originZone from zoneDistribution when present", () => {
    const source = new TDTrafficSource({
      wave: ZONE_WAVE,
      targetEntryPointId: "client" as ComponentId,
      rng: makeRng(1),
    });
    const requests = source.generate(0);
    expect(requests.length).toBe(100);
    const zoneCounts = new Map<string, number>();
    for (const req of requests) {
      expect(req.originZone).not.toBeNull();
      const zone = req.originZone!;
      expect(["na-east", "eu-west", "ap-south"]).toContain(zone);
      zoneCounts.set(zone, (zoneCounts.get(zone) ?? 0) + 1);
    }
    expect(zoneCounts.get("na-east")).toBeGreaterThan(0);
    expect(zoneCounts.get("eu-west")).toBeGreaterThan(0);
    expect(zoneCounts.get("ap-south")).toBeGreaterThan(0);
  });

  it("leaves originZone null when no zoneDistribution", () => {
    const source = new TDTrafficSource({
      wave: NO_ZONE_WAVE,
      targetEntryPointId: "client" as ComponentId,
      rng: makeRng(1),
    });
    const requests = source.generate(0);
    for (const req of requests) {
      expect(req.originZone).toBeNull();
    }
  });
});

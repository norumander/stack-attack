import { describe, it, expect } from "vitest";
import { WAVE_9 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";

describe("WAVE_9 — Going Global", () => {
  it("has correct id, name, and starting budget", () => {
    expect(WAVE_9.id).toBe(9);
    expect(WAVE_9.name).toBe("Going Global");
    expect(WAVE_9.startingBudget).toBe(2500);
  });

  it("composition includes stream at 0.30 and api_read at 0.25", () => {
    expect(WAVE_9.composition.get("stream")).toBeCloseTo(0.30);
    expect(WAVE_9.composition.get("api_read")).toBeCloseTo(0.25);
  });

  it("includes dns_gtm in availableComponents", () => {
    expect(WAVE_9.availableComponents).toContain("dns_gtm");
    expect(WAVE_9.availableComponents).toContain("streaming_media_server");
  });

  it("has zoneTopology with 3 zones", () => {
    expect(WAVE_9.zoneTopology).toBeDefined();
    expect(WAVE_9.zoneTopology!.zones).toEqual(["na-east", "eu-west", "ap-south"]);
  });

  it("has correct zone pair latencies", () => {
    const pl = WAVE_9.zoneTopology!.pairLatency;
    expect(pl.get(zonePairKey("na-east", "eu-west"))).toBe(3);
    expect(pl.get(zonePairKey("na-east", "ap-south"))).toBe(5);
    expect(pl.get(zonePairKey("eu-west", "ap-south"))).toBe(4);
  });

  it("has zoneDistribution with 3 zones summing to ~1.0", () => {
    expect(WAVE_9.zoneDistribution).toBeDefined();
    const dist = WAVE_9.zoneDistribution!;
    expect(dist.get("na-east")).toBeCloseTo(0.40);
    expect(dist.get("eu-west")).toBeCloseTo(0.35);
    expect(dist.get("ap-south")).toBeCloseTo(0.25);
  });

  it("intensity is 800 and SLA maxAvgLatency is 4", () => {
    expect(WAVE_9.intensity).toBe(800);
    expect(WAVE_9.sla).toBeDefined();
    expect(WAVE_9.sla!.maxAvgLatency).toBe(4);
  });
});

import { describe, it, expect } from "vitest";
import { WAVE_10 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";

describe("WAVE_10 — The Viral Moment", () => {
  it("has correct id, name, and starting budget", () => {
    expect(WAVE_10.id).toBe(10);
    expect(WAVE_10.name).toBe("The Viral Moment");
    expect(WAVE_10.startingBudget).toBe(5000);
  });

  it("intensity is 3000", () => {
    expect(WAVE_10.intensity).toBe(3000);
  });

  it("composition includes stream at 0.35 and batch at 0.15", () => {
    expect(WAVE_10.composition.get("stream")).toBeCloseTo(0.35);
    expect(WAVE_10.composition.get("batch")).toBeCloseTo(0.15);
    expect(WAVE_10.composition.get("api_read")).toBeCloseTo(0.25);
  });

  it("has zoneTopology with 3 zones", () => {
    expect(WAVE_10.zoneTopology).toBeDefined();
    expect(WAVE_10.zoneTopology!.zones).toEqual(["na-east", "eu-west", "ap-south"]);
  });

  it("has chaosSchedule with 3 events", () => {
    expect(WAVE_10.chaosSchedule).toBeDefined();
    expect(WAVE_10.chaosSchedule!.length).toBe(3);
    expect(WAVE_10.chaosSchedule![0]!.chaosKind).toBe("component_failure");
    expect(WAVE_10.chaosSchedule![2]!.chaosKind).toBe("zone_outage");
  });

  it("SLA targets 85% availability with negative min budget", () => {
    expect(WAVE_10.sla).toBeDefined();
    expect(WAVE_10.sla!.availabilityTarget).toBeCloseTo(0.85);
    expect(WAVE_10.sla!.minBudget).toBe(-500);
  });

  it("connectionBandwidth is 3000", () => {
    expect(WAVE_10.connectionBandwidth).toBe(3000);
  });
});

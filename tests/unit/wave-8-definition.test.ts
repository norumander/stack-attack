import { describe, it, expect } from "vitest";
import { WAVE_8 } from "@modes/td/td-waves";

describe("WAVE_8 — Video Launch", () => {
  it("has correct id, name, and starting budget", () => {
    expect(WAVE_8.id).toBe(8);
    expect(WAVE_8.name).toBe("Video Launch");
    expect(WAVE_8.startingBudget).toBe(1500);
  });

  it("composition includes stream at 0.30", () => {
    expect(WAVE_8.composition.get("stream")).toBeCloseTo(0.30);
    expect(WAVE_8.composition.get("api_read")).toBeCloseTo(0.20);
    expect(WAVE_8.composition.get("batch")).toBeCloseTo(0.15);
  });

  it("includes streaming_media_server and blob_storage in availableComponents", () => {
    expect(WAVE_8.availableComponents).toContain("streaming_media_server");
    expect(WAVE_8.availableComponents).toContain("blob_storage");
  });

  it("has streamConfig with duration 20 and bandwidth 3", () => {
    expect(WAVE_8.streamConfig).toBeDefined();
    expect(WAVE_8.streamConfig!.duration).toBe(20);
    expect(WAVE_8.streamConfig!.bandwidth).toBe(3);
  });

  it("revenue table includes stream at 8", () => {
    expect(WAVE_8.revenuePerRequestType.get("stream")).toBe(8);
  });

  it("intensity is 500 and duration is 40", () => {
    expect(WAVE_8.intensity).toBe(500);
    expect(WAVE_8.duration).toBe(40);
  });

  it("SLA targets 92% availability", () => {
    expect(WAVE_8.sla).toBeDefined();
    expect(WAVE_8.sla!.availabilityTarget).toBeCloseTo(0.92);
  });
});

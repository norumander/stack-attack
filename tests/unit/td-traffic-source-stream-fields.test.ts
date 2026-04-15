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

const STREAM_WAVE: TDWaveDefinition = {
  id: 99,
  name: "Stream Test",
  startingBudget: 1000,
  intensity: 10,
  composition: new Map([["stream", 1.0]]),
  duration: 5,
  ttl: 10,
  availableComponents: ["server"],
  dropThreshold: 0.05,
  viabilityPerFailure: 0.1,
  viabilityRampPenalty: 0.5,
  revenuePerRequestType: new Map([["stream", 8]]),
  keyPoolSize: 10,
  connectionBandwidth: 100,
  streamConfig: { duration: 20, bandwidth: 3 },
  sla: { availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 5 },
};

const NO_STREAM_WAVE: TDWaveDefinition = {
  id: 98,
  name: "No Stream Test",
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

describe("TDTrafficSource stream field population", () => {
  it("populates streamDuration and streamBandwidth for stream-type requests when streamConfig exists", () => {
    const source = new TDTrafficSource({
      wave: STREAM_WAVE,
      targetEntryPointId: "client" as ComponentId,
      rng: makeRng(1),
    });
    const requests = source.generate(0);
    expect(requests.length).toBe(10);
    for (const req of requests) {
      expect(req.type).toBe("stream");
      expect(req.streamDuration).toBe(20);
      expect(req.streamBandwidth).toBe(3);
    }
  });

  it("leaves streamDuration and streamBandwidth null for non-stream requests", () => {
    const source = new TDTrafficSource({
      wave: NO_STREAM_WAVE,
      targetEntryPointId: "client" as ComponentId,
      rng: makeRng(1),
    });
    const requests = source.generate(0);
    expect(requests.length).toBe(10);
    for (const req of requests) {
      expect(req.type).toBe("api_read");
      expect(req.streamDuration).toBeNull();
      expect(req.streamBandwidth).toBeNull();
    }
  });
});

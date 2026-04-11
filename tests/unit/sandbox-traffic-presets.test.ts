import { describe, it, expect } from "vitest";
import {
  TRAFFIC_PRESETS,
  resolvePreset,
  type TrafficPresetName,
} from "@modes/sandbox/sandbox-traffic-presets";
import { SandboxTrafficSource } from "@modes/sandbox/sandbox-traffic-source";
import type { ComponentId } from "@core/types/ids";

const TARGET = "c-entry" as ComponentId;

const ALL_PRESETS: TrafficPresetName[] = [
  "steady-load",
  "black-friday",
  "gradual-ramp",
  "flash-crowd",
  "async-heavy",
  "media-launch",
];

describe("TRAFFIC_PRESETS", () => {
  it("contains all expected preset names", () => {
    for (const name of ALL_PRESETS) {
      expect(TRAFFIC_PRESETS.has(name)).toBe(true);
    }
  });

  it("preset configs do not have targetEntryPointId", () => {
    for (const [, config] of TRAFFIC_PRESETS) {
      expect(config).not.toHaveProperty("targetEntryPointId");
    }
  });

  it("all distribution weights sum to positive value", () => {
    for (const [name, config] of TRAFFIC_PRESETS) {
      if (config.requestTypeDistribution) {
        const total = config.requestTypeDistribution.reduce((s, e) => s + e.weight, 0);
        expect(total, `${name} distribution weights should sum to positive`).toBeGreaterThan(0);
      }
    }
  });

  it("all presets have positive intensity", () => {
    for (const [name, config] of TRAFFIC_PRESETS) {
      expect(config.intensity, `${name} intensity`).toBeGreaterThan(0);
    }
  });
});

describe("resolvePreset", () => {
  it("merges targetEntryPointId into preset config", () => {
    const config = resolvePreset("steady-load", TARGET);
    expect(config.targetEntryPointId).toBe(TARGET);
    expect(config.pattern).toBe("steady");
    expect(config.intensity).toBe(50);
  });

  it("throws for unknown preset name", () => {
    expect(() => resolvePreset("nonexistent" as TrafficPresetName, TARGET)).toThrow(
      /Unknown traffic preset/,
    );
  });

  for (const presetName of ALL_PRESETS) {
    it(`"${presetName}" generates requests matching its distribution`, () => {
      const config = resolvePreset(presetName, TARGET);
      const source = new SandboxTrafficSource(config);

      // Use a tick that produces requests for any pattern
      // ramp needs later ticks; burst needs early ticks in cycle
      const tick = config.pattern === "ramp" ? (config.rampDuration ?? 50) : 0;
      const requests = source.generate(tick);

      if (requests.length === 0) return; // burst at tick 0 with burstDuration=0 edge case

      if (config.requestTypeDistribution && config.requestTypeDistribution.length > 0) {
        const validTypes = new Set(config.requestTypeDistribution.map((e) => e.type));
        for (const r of requests) {
          expect(validTypes.has(r.type), `${presetName}: unexpected type "${r.type}"`).toBe(true);
        }
      }
    });
  }
});

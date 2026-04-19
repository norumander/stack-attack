import { describe, it, expect } from "vitest";
import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { ComponentId } from "@core/types/ids";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";

/**
 * Playtest harness smoke tests — skipped by default. These are analysis
 * tools, not CI contracts. Run manually with `.only` + `pnpm test tests/playtest/`.
 */

const WAVE_1: WaveDef = {
  intensity: 15,
  packetRate: 2,
  duration: 10,
  composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
  keyDistribution: { kind: "uniform", spaceSize: 60 },
  revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 1 },
  entryClients: ["client" as ComponentId],
};

const WAVE_1_SLA: SLAThresholds = { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 };
const WAVE_1_BUDGET = 300;

describe("playtest harness — smoke", () => {
  it.skip("Wave-1 Client→Server→Database passes SLA", () => {
    const topo = topology("intended")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    const result = simulatePlaytest(WAVE_1, WAVE_1_SLA, WAVE_1_BUDGET, topo);
    // eslint-disable-next-line no-console
    console.log("Wave 1 smoke:", JSON.stringify(result, null, 2));
    expect(result.topologyErrors).toEqual([]);
    expect(["pass", "marginal"]).toContain(result.verdict);
  });

  it.skip("invalid topology (Client→Database only, no server for api_read) short-circuits to verdict=invalid", () => {
    // For Wave 1 (reads + writes), Database alone can terminate, so that
    // isn't actually invalid. Use a pathological case: empty forwarder chain.
    // A lone `load_balancer` with no downstream can't terminate anything.
    const topo = topology("broken")
      .add("load_balancer", "lb1")
      .entry("lb1")
      .build();

    const result = simulatePlaytest(WAVE_1, WAVE_1_SLA, WAVE_1_BUDGET, topo);
    // eslint-disable-next-line no-console
    console.log("Invalid topology:", JSON.stringify(result, null, 2));
    expect(result.verdict).toBe("invalid");
    expect(result.topologyErrors.length).toBeGreaterThan(0);
    expect(result.score).toBe(0);
  });
});

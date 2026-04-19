import { describe, it } from "vitest";
import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { ComponentId } from "@core/types/ids";
import { simulatePlaytest, type PlaytestResult } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";

/**
 * Candidate-architectures sweep — Wave 1.
 *
 * Template for per-wave candidate files. Skipped by default. Run with `.only`
 * via `pnpm test tests/playtest/ --run` to produce a ranked comparison table.
 * Each candidate is an alternative topology (minimal intended, under-built,
 * over-built) — the harness ranks them by score so we can see where the
 * "intended" solution lands among plausible alternatives.
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

function printTable(title: string, results: PlaytestResult[]): void {
  const ranked = [...results].sort((a, b) => b.score - a.score);
  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
  // eslint-disable-next-line no-console
  console.table(
    ranked.map((r) => ({
      architecture: r.architecture,
      cost: r.totalCost,
      avail: r.metrics.availability.toFixed(3),
      drop: r.metrics.dropRate.toFixed(3),
      lat: `${r.metrics.avgLatencySeconds.toFixed(2)}s`,
      rev: `$${r.metrics.revenue.toFixed(0)}`,
      score: r.score.toFixed(3),
      verdict: r.verdict,
    })),
  );
}

describe("wave 1 — candidate architectures", () => {
  it.skip("rank intended vs under-built vs over-built", () => {
    const intended = topology("intended: server + db")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    const underBuilt = topology("under-built: server only")
      .add("server", "s1")
      .entry("s1")
      .build();

    const overBuilt = topology("over-built: lb + 2 servers + db + cache")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .build();

    const results = [
      simulatePlaytest(WAVE_1, WAVE_1_SLA, WAVE_1_BUDGET, intended),
      simulatePlaytest(WAVE_1, WAVE_1_SLA, WAVE_1_BUDGET, underBuilt),
      simulatePlaytest(WAVE_1, WAVE_1_SLA, WAVE_1_BUDGET, overBuilt),
    ];

    printTable("WAVE 1 — Launch Day", results);
  });
});

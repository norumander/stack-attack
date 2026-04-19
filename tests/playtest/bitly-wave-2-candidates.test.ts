import { describe, it, expect } from "vitest";
import { BITLY_WAVES } from "../../src/physics-td/bitly-waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * bit.ly Wave 2 — "Reddit Front Page". Hot-zipf alpha 1.5 means one link
 * dominates. Edge Cache is the star: it terminates api_read on hit, so the
 * viral storm never reaches Servers.
 */

const W2 = BITLY_WAVES[1]!;
const CUMULATIVE_BUDGET_W2 = 900;

describe("bitly wave 2 — candidate architectures", () => {
  it("intended (Edge Cache in front) beats no-edge-cache alternatives", () => {
    // intended: Client → EdgeCache → Server → DataCache → DB
    const intended = topology("intended")
      .add("edge_cache", "ec1")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("ec1")
      .connect("ec1", "s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .build();

    // no-edge-cache: Netflix-style scale-out (LB + 2 servers + backend cache).
    const noEdgeCache = topology("no-edge-cache")
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

    // carry-over-only: W1 stack unchanged — drowns under 120/sec.
    const carryOver = topology("carry-over-only")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    // over-engineered: EdgeCache + LB + 2 Servers + DataCache + DB.
    const overEngineered = topology("over-engineered")
      .add("edge_cache", "ec1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("ec1")
      .connect("ec1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .build();

    const topologies = [intended, noEdgeCache, carryOver, overEngineered];
    const results = topologies.map((t) =>
      simulatePlaytest(W2.wave, W2.sla, CUMULATIVE_BUDGET_W2, t, { seed: 42 }),
    );

    printRankedTable({
      title: `BITLY W2 — "${W2.title.replace(/^Wave 2 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W2,
      trafficSummary: "95%+ reads, hot zipf α=1.5, ~120/sec",
      durationSeconds: W2.wave.duration,
      slaLine: slaLine(W2.sla),
      results,
      intendedLabel: "intended",
    });

    const byLabel = new Map(results.map((r) => [r.architecture, r]));
    const intendedR = byLabel.get("intended")!;
    const carryR = byLabel.get("carry-over-only")!;
    // Edge Cache makes intended outperform the W1 carry-over.
    expect(intendedR.slaPass).toBe(true);
    expect(intendedR.score).toBeGreaterThan(carryR.score);
  });
});

import { describe, it } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 2 candidate-architecture sweep. Analysis-only — no assertions.
 */

const W2 = CAMPAIGN_WAVES[1]!;
const CUMULATIVE_BUDGET_W2 = 725;

describe("wave 2 — candidate architectures", () => {
  it.skip("ranked sweep", () => {
    const intended = topology("intended")
      .add("data_cache", "c1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("database", "db1")
      .entry("c1")
      .connect("c1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "db1")
      .connect("s2", "db1")
      .build();

    const noCache = topology("no-cache")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("database", "db1")
      .entry("lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "db1")
      .connect("s2", "db1")
      .build();

    const noScale = topology("no-scale")
      .add("data_cache", "c1")
      .add("server", "s1")
      .add("database", "db1")
      .entry("c1")
      .connect("c1", "s1")
      .connect("s1", "db1")
      .build();

    const carryOver = topology("carry-over-only")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    const overEngineered = topology("over-engineered")
      .add("data_cache", "c1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("server", "s3")
      .add("database", "db1")
      .entry("c1")
      .connect("c1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("s1", "db1")
      .connect("s2", "db1")
      .connect("s3", "db1")
      .build();

    const topologies = [intended, noCache, noScale, carryOver, overEngineered];
    const results = topologies.map((t) =>
      simulatePlaytest(W2.wave, W2.sla, CUMULATIVE_BUDGET_W2, t, { seed: 42 }),
    );

    printRankedTable({
      title: `WAVE 2 — "${W2.title.replace(/^Wave 2 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W2,
      trafficSummary: "reads+writes, ~60/sec (4x W1)",
      durationSeconds: W2.wave.duration,
      slaLine: slaLine(W2.sla),
      results,
      intendedLabel: "intended",
    });
  });
});

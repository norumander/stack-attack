import { describe, it } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 1 candidate-architecture sweep. Analysis-only — no assertions.
 */

const W1 = CAMPAIGN_WAVES[0]!;
const CUMULATIVE_BUDGET_W1 = 300;

describe("wave 1 — candidate architectures", () => {
  it.skip("ranked sweep", () => {
    const intended = topology("intended")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    const underBuiltServer = topology("under-built-server")
      .add("server", "s1")
      .entry("s1")
      .build();

    const wrongToolDb = topology("wrong-tool-db")
      .add("database", "db1")
      .entry("db1")
      .build();

    const altCacheDb = topology("alt-cache-db")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("c1")
      .connect("c1", "db1")
      .build();

    const overEngineered = topology("over-engineered")
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

    const topologies = [intended, underBuiltServer, wrongToolDb, altCacheDb, overEngineered];
    const results = topologies.map((t) =>
      simulatePlaytest(W1.wave, W1.sla, CUMULATIVE_BUDGET_W1, t, { seed: 42 }),
    );

    printRankedTable({
      title: `WAVE 1 — "${W1.title.replace(/^Wave 1 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W1,
      trafficSummary: "api_read + api_write, ~15/sec",
      durationSeconds: W1.wave.duration,
      slaLine: slaLine(W1.sla),
      results,
      intendedLabel: "intended",
    });
  });
});

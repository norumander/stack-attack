import { describe, it, expect } from "vitest";
import { BITLY_WAVES } from "../../src/physics-td/bitly-waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * bit.ly Wave 1 candidate sweep — "Hello World".
 * Launch day: 20 req/sec, 10% writes, uniform keys.
 * Intended: Client → Server → Database (cost $300, budget $400).
 */

const W1 = BITLY_WAVES[0]!;
const CUMULATIVE_BUDGET_W1 = 400;

describe("bitly wave 1 — candidate architectures", () => {
  it("intended (Server → DB) ranks first among valid", () => {
    const intended = topology("intended")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    // Invalid: Server has no terminal behind it.
    const underBuilt = topology("under-built")
      .add("server", "s1")
      .entry("s1")
      .build();

    // Invalid: Database is backend-only, cannot be entry.
    const dbAsEntry = topology("db-as-entry")
      .add("database", "db1")
      .entry("db1")
      .build();

    // Over-engineered: LB + 2 Servers + Cache + DB at 20 req/sec (wasteful).
    const overEngineered = topology("over-engineered")
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

    const topologies = [intended, underBuilt, dbAsEntry, overEngineered];
    const results = topologies.map((t) =>
      simulatePlaytest(W1.wave, W1.sla, CUMULATIVE_BUDGET_W1, t, { seed: 42 }),
    );

    printRankedTable({
      title: `BITLY W1 — "${W1.title.replace(/^Wave 1 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W1,
      trafficSummary: "api_read + api_write, ~20/sec",
      durationSeconds: W1.wave.duration,
      slaLine: slaLine(W1.sla),
      results,
      intendedLabel: "intended",
    });

    const byLabel = new Map(results.map((r) => [r.architecture, r]));
    const intendedR = byLabel.get("intended")!;
    // Intended must pass SLA.
    expect(intendedR.slaPass).toBe(true);
    // Cost-feasible winner: ranks highest among topologies within budget.
    const feasible = results.filter((r) => r.totalCost <= CUMULATIVE_BUDGET_W1);
    const bestFeasible = [...feasible].sort((a, b) => b.score - a.score)[0]!;
    expect(bestFeasible.architecture).toBe("intended");
  });
});

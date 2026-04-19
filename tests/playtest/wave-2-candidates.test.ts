import { describe, it } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 2 candidate-architecture sweep. Analysis-only — no assertions.
 *
 * Redis-style: Cache is backend-only, shared behind both Servers. LB fronts
 * the Servers as the client-facing entry.
 */

const W2 = CAMPAIGN_WAVES[1]!;
const CUMULATIVE_BUDGET_W2 = 900;

describe("wave 2 — candidate architectures", () => {
  it.skip("ranked sweep", () => {
    // intended: Client → LB → {s1, s2} → Cache → DB (shared backend cache)
    const intended = topology("intended")
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

    // no-cache: LB → two Servers → DB (no hot-key absorber)
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

    // no-scale: single Server with backend cache — no horizontal scale-out
    const noScale = topology("no-scale")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .build();

    // carry-over-only: Wave 1 intended (no LB, no cache)
    const carryOver = topology("carry-over-only")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    // over-engineered: LB → 3 Servers → shared Cache → DB
    const overEngineered = topology("over-engineered")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("server", "s3")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("s3", "c1")
      .connect("c1", "db1")
      .build();

    // edge-cache-replaces-scale: Client → Edge Cache → Server → Cache → DB.
    // Testing if a single Edge Cache + Server beats LB + 2 Servers at 4x
    // traffic. Edge Cache absorbs repeats at the edge; Data Cache absorbs
    // tail misses behind the single Server.
    const edgeCacheReplacesScale = topology("edge-cache-replaces-scale")
      .add("edge_cache", "ec1")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("ec1")
      .connect("ec1", "s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .build();

    const topologies = [intended, noCache, noScale, carryOver, overEngineered, edgeCacheReplacesScale];
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

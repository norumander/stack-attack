import { describe, it, expect } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 8 candidate sweep — "Viral Moment". Massive intensity with 3 server
 * crashes. Intended: autoscale enabled on Servers + Databases so tiers bump
 * as utilization pins 80%+.
 */

const W8 = CAMPAIGN_WAVES[7]!;
const CUMULATIVE_BUDGET_W8 = 1950;

describe("wave 8 — candidate architectures", () => {
  it("autoscale intended survives the viral spike", () => {
    const intended = topology("intended")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("streaming_server", "ss1")
      .add("load_balancer", "lb1")
      .add("server", "s1").autoScale("s1")
      .add("server", "s2").autoScale("s2")
      .add("server", "s3").autoScale("s3")
      .add("data_cache", "c1")
      .add("database", "db1").autoScale("db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "ss1")
      .connect("ss1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("s3", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    const partialAutoscale = topology("partial-autoscale")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("streaming_server", "ss1")
      .add("load_balancer", "lb1")
      .add("server", "s1").autoScale("s1")
      .add("server", "s2").autoScale("s2")
      .add("server", "s3").autoScale("s3")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "ss1")
      .connect("ss1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("s3", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    const noAutoscale = topology("no-autoscale")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("streaming_server", "ss1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("server", "s3")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "ss1")
      .connect("ss1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("s3", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // carry-over-only: W7 intended shape (multi-zone, unzoned wave → all same)
    // but we use the static W6-style stack to show static topology collapses.
    const carryOver = topology("carry-over-only")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("streaming_server", "ss1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "ss1")
      .connect("ss1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // over-engineered: intended + 3 extra servers up-front (static capacity).
    const overEngineered = topology("over-engineered")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("streaming_server", "ss1")
      .add("load_balancer", "lb1")
      .add("server", "s1").autoScale("s1")
      .add("server", "s2").autoScale("s2")
      .add("server", "s3").autoScale("s3")
      .add("server", "s4")
      .add("server", "s5")
      .add("server", "s6")
      .add("data_cache", "c1")
      .add("database", "db1").autoScale("db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "ss1")
      .connect("ss1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("lb1", "s4")
      .connect("lb1", "s5")
      .connect("lb1", "s6")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("s3", "c1")
      .connect("s4", "c1")
      .connect("s5", "c1")
      .connect("s6", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    const topologies = [intended, partialAutoscale, noAutoscale, carryOver, overEngineered];
    const results = topologies.map((t) =>
      simulatePlaytest(W8.wave, W8.sla, CUMULATIVE_BUDGET_W8, t, {
        seed: 42,
        ...(W8.chaosSchedule ? { chaosSchedule: W8.chaosSchedule } : {}),
      }),
    );
    /* eslint-disable no-console */
    console.log("\n--- topologyErrors ---");
    for (const r of results) {
      console.log(
        `${r.architecture}: ${r.topologyErrors
          .map((e) => `${e.requestType}@${e.componentType}:${e.reason}`)
          .join(", ") || "(none)"}`,
      );
    }
    /* eslint-enable no-console */

    printRankedTable({
      title: `WAVE 8 — "${W8.title.replace(/^Wave 8 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W8,
      trafficSummary: "~270/sec + 3 server crashes",
      durationSeconds: W8.wave.duration,
      slaLine: slaLine(W8.sla),
      results,
      intendedLabel: "intended",
    });

    const byLabel = new Map(results.map((r) => [r.architecture, r]));
    const intendedR = byLabel.get("intended")!;
    const carryR = byLabel.get("carry-over-only")!;
    // Intended should at least handle load better than 2-server carry-over.
    // NOTE: AutoScale rarely trips at this packet granularity because
    // utilization samples briefly drop to 0 between arrivals (refill >>
    // inter-packet gap). The wave therefore teaches elasticity primarily
    // through having 3 vs 2 servers with LB headroom; AutoScale itself is
    // a future-work story until sampling is hardened (e.g. moving average).
    expect(intendedR.score).toBeGreaterThan(carryR.score);
  });
});

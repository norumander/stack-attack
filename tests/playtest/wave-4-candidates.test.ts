import { describe, it } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 4 candidate-architecture sweep. Analysis-only — no assertions.
 *
 * Redis-style: Cache is backend-only. Async branch splits off Gateway into
 * Queue → Worker → DB; sync branch is CDN → Gateway → LB → Servers → Cache → DB.
 */

const W4 = CAMPAIGN_WAVES[3]!;
const CUMULATIVE_BUDGET_W4 = 1625;

describe("wave 4 — candidate architectures", () => {
  it.skip("ranked sweep", () => {
    // intended: CDN → Gateway → LB → {s1, s2} → Cache → DB (sync)
    //           Gateway → Queue → Worker → DB (async)
    const intended = topology("intended")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // no-Queue: Worker wired without Queue — Worker is inert without upstream Queue
    const noQueue = topology("no-Queue")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("worker", "w1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "w1")
      .connect("w1", "db1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .build();

    // no-Worker: Queue present with no Worker downstream
    const noWorker = topology("no-Worker")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "q1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .build();

    // carry-over-only: Wave 3 intended (no async handling)
    const carryOver = topology("carry-over-only")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .build();

    // over-engineered: intended + extra server + extra worker
    const overEngineered = topology("over-engineered")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("worker", "w2")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("server", "s3")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("q1", "w2")
      .connect("w1", "db1")
      .connect("w2", "db1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("s3", "c1")
      .connect("c1", "db1")
      .build();

    const topologies = [intended, noQueue, noWorker, carryOver, overEngineered];
    const results = topologies.map((t) =>
      simulatePlaytest(W4.wave, W4.sla, CUMULATIVE_BUDGET_W4, t, { seed: 42 }),
    );

    /* eslint-disable no-console */
    console.log("\n--- topologyErrors per candidate ---");
    for (const r of results) {
      console.log(
        `${r.architecture}: ${r.topologyErrors
          .map((e) => `${e.requestType}@${e.componentType}:${e.reason}`)
          .join(", ") || "(none)"}`,
      );
    }
    /* eslint-enable no-console */

    printRankedTable({
      title: `WAVE 4 — "${W4.title.replace(/^Wave 4 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W4,
      trafficSummary: "~100/sec, +20% async_work (20% large, 15% auth, 15% write)",
      durationSeconds: W4.wave.duration,
      slaLine: slaLine(W4.sla),
      results,
      intendedLabel: "intended",
    });
  });
});

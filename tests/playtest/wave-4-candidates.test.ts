import { describe, it } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 4 candidate-architecture sweep. Analysis-only — no assertions.
 *
 * The canonical Queue/Worker pattern from tests/integration/sim/waves/wave-6-queue-worker.test.ts
 * uses a custom ServerTrioDispatcher that routes async → queue, write → db,
 * else → cache. The playtest harness only uses factory components, so we
 * approximate the routing by giving an upstream forwarder (api_gateway)
 * multiple egresses — one into queue→worker (async path), one into the
 * cache/LB/server/db sync path. The topology validator is optimistic so the
 * async path is considered satisfied as long as Worker is reachable.
 */

const W4 = CAMPAIGN_WAVES[3]!;
const CUMULATIVE_BUDGET_W4 = 1625;

describe("wave 4 — candidate architectures", () => {
  it.skip("ranked sweep", () => {
    // intended: CDN → Gateway → (Queue→Worker) + (Cache → LB → s1,s2 → DB)
    const intended = topology("intended")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("data_cache", "c1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "c1")
      .connect("c1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "db1")
      .connect("s2", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // no-Queue: Worker wired without Queue in front. Per wire-workers.ts,
    // Worker only binds to an upstream Queue, so without a Queue the Worker
    // is inert — but the validator treats Worker as terminal for async_work.
    const noQueue = topology("no-Queue")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("worker", "w1")
      .add("data_cache", "c1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "w1")
      .connect("w1", "db1")
      .connect("ag1", "c1")
      .connect("c1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "db1")
      .connect("s2", "db1")
      .build();

    // no-Worker: Queue present with no Worker downstream — should be invalid
    // (async_work has no terminal reachable).
    const noWorker = topology("no-Worker")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("data_cache", "c1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "q1")
      .connect("ag1", "c1")
      .connect("c1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "db1")
      .connect("s2", "db1")
      .build();

    // carry-over-only: Wave 3 intended (no async handling).
    const carryOver = topology("carry-over-only")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("data_cache", "c1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "c1")
      .connect("c1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "db1")
      .connect("s2", "db1")
      .build();

    // over-engineered: intended + extra server + extra worker.
    const overEngineered = topology("over-engineered")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("worker", "w2")
      .add("data_cache", "c1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("server", "s3")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("q1", "w2")
      .connect("w1", "db1")
      .connect("w2", "db1")
      .connect("ag1", "c1")
      .connect("c1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("s1", "db1")
      .connect("s2", "db1")
      .connect("s3", "db1")
      .build();

    const topologies = [intended, noQueue, noWorker, carryOver, overEngineered];
    const results = topologies.map((t) =>
      simulatePlaytest(W4.wave, W4.sla, CUMULATIVE_BUDGET_W4, t, { seed: 42 }),
    );

    // Diagnostic: per-topology topology-error breakdown.
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

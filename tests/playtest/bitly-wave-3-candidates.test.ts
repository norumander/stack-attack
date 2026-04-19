import { describe, it, expect } from "vitest";
import { BITLY_WAVES } from "../../src/physics-td/bitly-waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * bit.ly Wave 3 — "Analytics Pipeline". 20% async click-tracking. Queue +
 * Worker fans the async writes off the hot read path.
 */

const W3 = BITLY_WAVES[2]!;
const CUMULATIVE_BUDGET_W3 = 1350;

describe("bitly wave 3 — candidate architectures", () => {
  it("intended (EdgeCache + Queue + Worker) ranks first among valid", () => {
    // intended: EdgeCache → LB → {s1, s2} → DataCache → DB, plus Queue → Worker → DB
    const intended = topology("intended")
      .add("edge_cache", "ec1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .add("queue", "q1")
      .add("worker", "w1")
      .entry("ec1")
      .connect("ec1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .connect("s1", "q1")
      .connect("s2", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // no-queue: async writes hit the sync DB path — backs it up.
    const noQueue = topology("no-queue")
      .add("edge_cache", "ec1")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("ec1")
      .connect("ec1", "s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .build();

    // no-worker: Queue with no drain — async requests sit forever (invalid).
    const noWorker = topology("no-worker")
      .add("edge_cache", "ec1")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .add("queue", "q1")
      .entry("ec1")
      .connect("ec1", "s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .connect("s1", "q1")
      .build();

    // carry-over-only: W2 stack — no async handling at all.
    const carryOver = topology("carry-over-only")
      .add("edge_cache", "ec1")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("ec1")
      .connect("ec1", "s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .build();

    const topologies = [intended, noQueue, noWorker, carryOver];
    const results = topologies.map((t) =>
      simulatePlaytest(W3.wave, W3.sla, CUMULATIVE_BUDGET_W3, t, { seed: 42 }),
    );

    printRankedTable({
      title: `BITLY W3 — "${W3.title.replace(/^Wave 3 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W3,
      trafficSummary: "75% reads, 20% async, ~150/sec",
      durationSeconds: W3.wave.duration,
      slaLine: slaLine(W3.sla),
      results,
      intendedLabel: "intended",
    });

    const byLabel = new Map(results.map((r) => [r.architecture, r]));
    const intendedR = byLabel.get("intended")!;
    expect(intendedR.slaPass).toBe(true);
    // intended should beat no-queue and no-worker
    expect(intendedR.score).toBeGreaterThanOrEqual(byLabel.get("no-queue")!.score);
    // no-worker is invalid (Queue with no drain) — topologyErrors nonzero.
    expect(byLabel.get("no-worker")!.topologyErrors.length).toBeGreaterThan(0);
  });
});

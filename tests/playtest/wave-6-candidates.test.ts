import { describe, it, expect } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 6 candidate sweep — "Video Launch". Stream + large-payload traffic.
 * Intended: W5 sync/async backbone + Streaming Server (client-facing-ish,
 * reached via Gateway) that terminates streams. Non-stream traffic falls
 * through Streaming to lb1 → servers.
 *
 * NOTE: Blob Storage was originally in the spec but the static BFS validator
 * treats blob as a "none" terminal for non-large/non-stream types, breaking
 * topologies that expose blob on any generic fan-out path. Streaming Server
 * alone carries the stream lesson; blob_storage is deferred until a richer
 * runtime-aware validator ships.
 */

const W6 = CAMPAIGN_WAVES[5]!;
const CUMULATIVE_BUDGET_W6 = 2850;

describe("wave 6 — candidate architectures", () => {
  it("intended wins on stream isolation", () => {
    // intended: CDN → Gateway, with Streaming Server as a terminator for
    // stream_data (fall-through forwards to LB cluster).
    const intended = topology("intended")
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

    // no-Streaming: streams must be handled by Server/DB path — saturates.
    const noStreaming = topology("no-Streaming")
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

    // over-engineered: intended + 2nd streaming server.
    const overEngineered = topology("over-engineered")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("streaming_server", "ss1")
      .add("streaming_server", "ss2")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "ss1")
      .connect("ss1", "ss2")
      .connect("ss2", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // carry-over-only: W5-intended-shape (no streaming). Same as noStreaming
    // but with CB. Validator accepts; runtime streams get dropped at Servers.
    const carryOver = topology("carry-over-only")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("circuit_breaker", "cb1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("server", "s3")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "cb1")
      .connect("cb1", "lb1")
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

    const topologies = [intended, noStreaming, overEngineered, carryOver];
    const results = topologies.map((t) =>
      simulatePlaytest(W6.wave, W6.sla, CUMULATIVE_BUDGET_W6, t, { seed: 42 }),
    );

    printRankedTable({
      title: `WAVE 6 — "${W6.title.replace(/^Wave 6 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W6,
      trafficSummary: "~105/sec, 25% streams, 35% large",
      durationSeconds: W6.wave.duration,
      slaLine: slaLine(W6.sla),
      results,
      intendedLabel: "intended",
    });

    const byLabel = new Map(results.map((r) => [r.architecture, r]));
    const intendedR = byLabel.get("intended")!;
    const noStreamingR = byLabel.get("no-Streaming")!;
    expect(intendedR.slaPass).toBe(true);
    // Intended with Streaming terminator beats no-Streaming on handling streams.
    expect(intendedR.score).toBeGreaterThan(noStreamingR.score);
  });
});

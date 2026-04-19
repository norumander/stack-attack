import { describe, it, expect } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 6 candidate sweep — "Video Launch". Stream + large-payload traffic.
 * Intended: W5 sync/async backbone + Streaming Server fronting a Blob
 * Storage tee (stream/large terminator). Non-stream traffic falls through
 * Streaming into the LB cluster and onward to Server → Cache → DB.
 *
 * The multi-egress validator now permits Blob on a tee branch without
 * marking api_read invalid (other sibling egresses satisfy the read path).
 *
 * Test is skipped by default — playtest sweeps are research/analysis and
 * not part of the production contract surface.
 */

const W6 = CAMPAIGN_WAVES[5]!;
const CUMULATIVE_BUDGET_W6 = 2850;

describe.skip("wave 6 — candidate architectures", () => {
  it("intended wins on stream isolation", () => {
    // intended: CDN → Gateway tees into (a) Streaming Server → Blob Storage
    // stream/large path and (b) LB → server cluster for reads/writes. Queue
    // + Worker handle async. Blob sits behind Streaming on a dedicated tee
    // branch; the validator must NOT treat Blob's api_read dead-end as
    // topology-invalidating because the sibling branch satisfies reads.
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
      .add("streaming_server", "ss1")
      .add("blob_storage", "bs1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .connect("ag1", "ss1")
      .connect("ss1", "bs1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // no-Blob: intended shape minus the blob tee. Streaming Server still
    // handles streams, but large payloads terminate inline at DB (slower
    // under load).
    const noBlob = topology("no-Blob")
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

    const topologies = [intended, noBlob, noStreaming];
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
    const noBlobR = byLabel.get("no-Blob")!;
    const noStreamingR = byLabel.get("no-Streaming")!;
    expect(intendedR.slaPass).toBe(true);
    // Intended (with Blob tee) beats both no-Blob and no-Streaming.
    expect(intendedR.score).toBeGreaterThan(noBlobR.score);
    expect(intendedR.score).toBeGreaterThan(noStreamingR.score);
  });
});

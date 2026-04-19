import { describe, it } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 1 candidate-architecture sweep. Analysis-only — no assertions.
 *
 * Under the Redis-style backend-only rule, Cache and Database cannot be the
 * direct entry from Client. Client-facing components: server, cdn, gateway,
 * load_balancer, streaming_server, dns_gtm.
 */

const W1 = CAMPAIGN_WAVES[0]!;
const CUMULATIVE_BUDGET_W1 = 400;

describe("wave 1 — candidate architectures", () => {
  it.skip("ranked sweep", () => {
    const intended = topology("intended")
      .add("server", "s1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "db1")
      .build();

    const withCache = topology("with-cache")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .build();

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

    // Invalid: Database is backend-only, cannot be entry.
    const backendAsEntry = topology("backend-as-entry")
      .add("database", "db1")
      .entry("db1")
      .build();

    // Invalid: Server has no terminal behind it.
    const underBuilt = topology("under-built")
      .add("server", "s1")
      .entry("s1")
      .build();

    // with-edge-cache: Client → Edge Cache → Server → DB. Edge Cache is
    // client-facing and absorbs repeated api_read lookups at the edge.
    const withEdgeCache = topology("with-edge-cache")
      .add("edge_cache", "ec1")
      .add("server", "s1")
      .add("database", "db1")
      .entry("ec1")
      .connect("ec1", "s1")
      .connect("s1", "db1")
      .build();

    const topologies = [intended, withCache, withEdgeCache, overEngineered, backendAsEntry, underBuilt];
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

import { describe, it } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 3 candidate-architecture sweep. Analysis-only — no assertions.
 *
 * Redis-style: Cache is backend-only behind Servers. Edge chain:
 * CDN → Gateway → LB → {Servers} → Cache → DB.
 */

const W3 = CAMPAIGN_WAVES[2]!;
const CUMULATIVE_BUDGET_W3 = 1450;

describe("wave 3 — candidate architectures", () => {
  it.skip("ranked sweep", () => {
    const intended = topology("intended")
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

    const noCdn = topology("no-CDN")
      .add("api_gateway", "ag1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("ag1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .build();

    const noGateway = topology("no-Gateway")
      .add("cdn", "cdn1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .build();

    const noEdge = topology("no-edge")
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

    const overEngineered = topology("over-engineered")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("server", "s3")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("s3", "c1")
      .connect("c1", "db1")
      .build();

    // cdn+edgecache: CDN absorbs large static; Edge Cache absorbs api_read
    // at the edge. Tests whether layered edge caching beats CDN-only for
    // mixed large/text traffic.
    const cdnPlusEdgeCache = topology("cdn+edgecache")
      .add("cdn", "cdn1")
      .add("edge_cache", "ec1")
      .add("api_gateway", "ag1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ec1")
      .connect("ec1", "ag1")
      .connect("ag1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .build();

    const topologies = [intended, noCdn, noGateway, noEdge, overEngineered, cdnPlusEdgeCache];
    const results = topologies.map((t) =>
      simulatePlaytest(W3.wave, W3.sla, CUMULATIVE_BUDGET_W3, t, { seed: 42 }),
    );

    printRankedTable({
      title: `WAVE 3 — "${W3.title.replace(/^Wave 3 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W3,
      trafficSummary: "~80/sec, 30% large_payload + 20% auth + 15% write",
      durationSeconds: W3.wave.duration,
      slaLine: slaLine(W3.sla),
      results,
      intendedLabel: "intended",
    });
  });
});

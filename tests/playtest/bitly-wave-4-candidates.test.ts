import { describe, it, expect } from "vitest";
import { BITLY_WAVES } from "../../src/physics-td/bitly-waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * bit.ly Wave 4 — "Global Viral". Multi-zone (NA/EU/AP). DNS/GTM routes
 * zone-local; per-zone replicated stacks keep cross-zone latency out.
 */

const W4 = BITLY_WAVES[3]!;
const CUMULATIVE_BUDGET_W4 = 2900;

function zoneStack(
  t: ReturnType<typeof topology>,
  zone: string,
  suffix: string,
): ReturnType<typeof topology> {
  const EC = `ec_${suffix}`;
  const S = `s_${suffix}`;
  const C = `c_${suffix}`;
  const DB = `db_${suffix}`;
  const Q = `q_${suffix}`;
  const W = `w_${suffix}`;
  // Lightweight per-zone stack: handles reads locally; async fans into
  // zone-local Queue+Worker+DB so validator sees a full handler graph.
  return t
    .add("edge_cache", EC).inZone(EC, zone)
    .add("server", S).inZone(S, zone)
    .add("data_cache", C).inZone(C, zone)
    .add("database", DB).inZone(DB, zone)
    .add("queue", Q).inZone(Q, zone)
    .add("worker", W).inZone(W, zone)
    .connect(EC, S)
    .connect(S, C)
    .connect(C, DB)
    .connect(S, Q)
    .connect(Q, W)
    .connect(W, DB);
}

describe("bitly wave 4 — candidate architectures", () => {
  it("intended (multi-zone) passes SLA, beats single-zone", () => {
    // intended: DNS/GTM → per-zone (EdgeCache → Server → Cache → DB) + Queue/Worker in each
    let b = topology("intended")
      .add("dns_gtm", "dns1")
      .entry("dns1");
    b = zoneStack(b, "zone_na", "na");
    b = zoneStack(b, "zone_eu", "eu");
    b = zoneStack(b, "zone_ap", "ap");
    const intended = b
      .connect("dns1", "ec_na")
      .connect("dns1", "ec_eu")
      .connect("dns1", "ec_ap")
      .build();

    // single-zone: DNS/GTM + NA stack only — EU/AP traffic pays cross-zone tax.
    let b2 = topology("single-zone")
      .add("dns_gtm", "dns1")
      .entry("dns1");
    b2 = zoneStack(b2, "zone_na", "na");
    const singleZone = b2.connect("dns1", "ec_na").build();

    // no-dns-routing: W3 carry-over, no DNS/GTM. All traffic goes to the one
    // unzoned EdgeCache entry.
    const noDnsRouting = topology("no-dns-routing")
      .add("edge_cache", "ec1")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .add("queue", "q1")
      .add("worker", "w1")
      .entry("ec1")
      .connect("ec1", "s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .connect("s1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // carry-over-only: identical to W3 intended.
    const carryOver = topology("carry-over-only")
      .add("edge_cache", "ec1")
      .add("server", "s1")
      .add("data_cache", "c1")
      .add("database", "db1")
      .add("queue", "q1")
      .add("worker", "w1")
      .entry("ec1")
      .connect("ec1", "s1")
      .connect("s1", "c1")
      .connect("c1", "db1")
      .connect("s1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    const topologies = [intended, singleZone, noDnsRouting, carryOver];
    const results = topologies.map((t) =>
      simulatePlaytest(W4.wave, W4.sla, CUMULATIVE_BUDGET_W4, t, { seed: 42 }),
    );

    printRankedTable({
      title: `BITLY W4 — "${W4.title.replace(/^Wave 4 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W4,
      trafficSummary: "~200/sec, 3 zones (40/30/30 NA/EU/AP)",
      durationSeconds: W4.wave.duration,
      slaLine: slaLine(W4.sla),
      results,
      intendedLabel: "intended",
    });

    const byLabel = new Map(results.map((r) => [r.architecture, r]));
    const intendedR = byLabel.get("intended")!;
    const singleR = byLabel.get("single-zone")!;
    expect(intendedR.slaPass).toBe(true);
    expect(intendedR.score).toBeGreaterThan(singleR.score);
  });
});

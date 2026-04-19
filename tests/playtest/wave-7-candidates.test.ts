import { describe, it, expect } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 7 candidate sweep — "Going Global". Multi-zone traffic; cross-zone
 * hops cost +0.1s per edge. DNS/GTM (GeoRoutingCapability) picks an egress
 * whose target component is in the packet's originZone. Intended replicates
 * the backend stack across zone_na / zone_eu / zone_ap.
 *
 * NOTE: DNS/GTM with GeoRoutingCapability routes stream_data/large/write
 * by picking the zone-matched egress. The static validator does not model
 * runtime zone selection — it BFS-walks every egress. To avoid false
 * invalid verdicts, each per-zone backend stack must itself be fully
 * handler-complete for every request type the wave emits.
 */

const W7 = CAMPAIGN_WAVES[6]!;
const CUMULATIVE_BUDGET_W7 = 4850;

function zoneStack(
  t: ReturnType<typeof topology>,
  zone: string,
  suffix: string,
): ReturnType<typeof topology> {
  const AG = `ag_${suffix}`;
  const SS = `ss_${suffix}`;
  const LB = `lb_${suffix}`;
  const S1 = `s1_${suffix}`;
  const S2 = `s2_${suffix}`;
  const C = `c_${suffix}`;
  const DB = `db_${suffix}`;
  return t
    .add("api_gateway", AG).inZone(AG, zone)
    .add("streaming_server", SS).inZone(SS, zone)
    .add("load_balancer", LB).inZone(LB, zone)
    .add("server", S1).inZone(S1, zone)
    .add("server", S2).inZone(S2, zone)
    .add("data_cache", C).inZone(C, zone)
    .add("database", DB).inZone(DB, zone)
    .connect(AG, SS)
    .connect(SS, LB)
    .connect(LB, S1)
    .connect(LB, S2)
    .connect(S1, C)
    .connect(S2, C)
    .connect(C, DB);
}

describe("wave 7 — candidate architectures", () => {
  it("intended (per-zone replication) wins on cross-zone latency", () => {
    // intended: DNS/GTM routes each zone's traffic to a per-zone LB → Streaming
    // → Servers → Cache → DB stack. Zone_na / zone_eu / zone_ap each have one.
    let b = topology("intended")
      .add("dns_gtm", "dns1")
      .entry("dns1");
    b = zoneStack(b, "zone_na", "na");
    b = zoneStack(b, "zone_eu", "eu");
    b = zoneStack(b, "zone_ap", "ap");
    const intended = b
      .connect("dns1", "ag_na")
      .connect("dns1", "ag_eu")
      .connect("dns1", "ag_ap")
      .build();

    // single-zone-stack: DNS/GTM + one backend in NA only. EU/AP traffic
    // cross-zones and suffers.
    let b2 = topology("single-zone-stack")
      .add("dns_gtm", "dns1")
      .entry("dns1");
    b2 = zoneStack(b2, "zone_na", "na");
    const singleZone = b2.connect("dns1", "ag_na").build();

    // two-zones: NA + EU only; AP traffic has no match and drops no_zone_match.
    let b3 = topology("two-zones")
      .add("dns_gtm", "dns1")
      .entry("dns1");
    b3 = zoneStack(b3, "zone_na", "na");
    b3 = zoneStack(b3, "zone_eu", "eu");
    const twoZones = b3
      .connect("dns1", "ag_na")
      .connect("dns1", "ag_eu")
      .build();

    // carry-over-only: W6 intended (single unzoned stack, no DNS/GTM).
    // All cross-zone traffic rides the zonePair penalty.
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

    // over-engineered: intended + a 4th (unused) zone replicated.
    let b4 = topology("over-engineered")
      .add("dns_gtm", "dns1")
      .entry("dns1");
    b4 = zoneStack(b4, "zone_na", "na");
    b4 = zoneStack(b4, "zone_eu", "eu");
    b4 = zoneStack(b4, "zone_ap", "ap");
    b4 = zoneStack(b4, "zone_sa", "sa");
    const overEngineered = b4
      .connect("dns1", "ag_na")
      .connect("dns1", "ag_eu")
      .connect("dns1", "ag_ap")
      .connect("dns1", "ag_sa")
      .build();

    // with-edge-cache: intended per-zone stacks + a single front Edge Cache
    // ahead of DNS/GTM. Tests if an edge text cache helps layered atop
    // zone-aware routing. (Unzoned Edge Cache — text reads still resolve,
    // but post-cache misses fan out via DNS/GTM.)
    let b5 = topology("with-edge-cache")
      .add("edge_cache", "ec1")
      .add("dns_gtm", "dns1")
      .entry("ec1")
      .connect("ec1", "dns1");
    b5 = zoneStack(b5, "zone_na", "na");
    b5 = zoneStack(b5, "zone_eu", "eu");
    b5 = zoneStack(b5, "zone_ap", "ap");
    const withEdgeCache = b5
      .connect("dns1", "ag_na")
      .connect("dns1", "ag_eu")
      .connect("dns1", "ag_ap")
      .build();

    const topologies = [intended, singleZone, twoZones, carryOver, overEngineered, withEdgeCache];
    const results = topologies.map((t) =>
      simulatePlaytest(W7.wave, W7.sla, CUMULATIVE_BUDGET_W7, t, { seed: 42 }),
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
      title: `WAVE 7 — "${W7.title.replace(/^Wave 7 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W7,
      trafficSummary: "~130/sec, 3 zones (40/35/25 NA/EU/AP)",
      durationSeconds: W7.wave.duration,
      slaLine: slaLine(W7.sla),
      results,
      intendedLabel: "intended",
    });

    const byLabel = new Map(results.map((r) => [r.architecture, r]));
    const intendedR = byLabel.get("intended")!;
    const singleR = byLabel.get("single-zone-stack")!;
    // intended should pass SLA; single-zone-stack should struggle.
    expect(intendedR.slaPass).toBe(true);
    expect(intendedR.score).toBeGreaterThan(singleR.score);
  });
});

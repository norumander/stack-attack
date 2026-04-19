import { describe, it, expect } from "vitest";
import { CAMPAIGN_WAVES } from "../../src/physics-td/waves";
import { simulatePlaytest } from "../../src/playtest/run";
import { topology } from "../../src/playtest/topology-builder";
import { printRankedTable, slaLine } from "./_candidates-helpers";

/**
 * Wave 5 candidate-architecture sweep — "Things Break".
 * Chaos crashes 2 Servers and severs a DB edge mid-wave. Candidates with
 * Circuit Breaker + redundancy (extra Server) should rank highest.
 */

const W5 = CAMPAIGN_WAVES[4]!;
const CUMULATIVE_BUDGET_W5 = 2300;

describe("wave 5 — candidate architectures", () => {
  it("intended ranks first under chaos", () => {
    // intended: W4 async+sync + CB in front of server cluster + 3rd Server.
    const intended = topology("intended")
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

    // no-CB: intended with 3 servers and no CB. CB is runtime-inert right
    // now (reportFailure/reportSuccess not wired), so this candidate has
    // near-identical chaos resilience as intended. Kept for completeness.
    const noCB = topology("no-CB")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
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
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // no-redundancy: W4 intended + CB only (2 servers, single failure could cascade).
    const noRedundancy = topology("no-redundancy")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("circuit_breaker", "cb1")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "cb1")
      .connect("cb1", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    // carry-over-only: W4 intended unchanged (no CB, 2 servers) — should FAIL under chaos.
    const carryOver = topology("carry-over-only")
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

    // over-engineered: intended + extra CB + 4th server.
    const overEngineered = topology("over-engineered")
      .add("cdn", "cdn1")
      .add("api_gateway", "ag1")
      .add("queue", "q1")
      .add("worker", "w1")
      .add("circuit_breaker", "cb1")
      .add("circuit_breaker", "cb2")
      .add("load_balancer", "lb1")
      .add("server", "s1")
      .add("server", "s2")
      .add("server", "s3")
      .add("server", "s4")
      .add("data_cache", "c1")
      .add("database", "db1")
      .entry("cdn1")
      .connect("cdn1", "ag1")
      .connect("ag1", "cb1")
      .connect("cb1", "cb2")
      .connect("cb2", "lb1")
      .connect("lb1", "s1")
      .connect("lb1", "s2")
      .connect("lb1", "s3")
      .connect("lb1", "s4")
      .connect("s1", "c1")
      .connect("s2", "c1")
      .connect("s3", "c1")
      .connect("s4", "c1")
      .connect("c1", "db1")
      .connect("ag1", "q1")
      .connect("q1", "w1")
      .connect("w1", "db1")
      .build();

    const topologies = [intended, noCB, noRedundancy, carryOver, overEngineered];
    const results = topologies.map((t) =>
      simulatePlaytest(W5.wave, W5.sla, CUMULATIVE_BUDGET_W5, t, {
        seed: 42,
        ...(W5.chaosSchedule ? { chaosSchedule: W5.chaosSchedule } : {}),
      }),
    );

    printRankedTable({
      title: `WAVE 5 — "${W5.title.replace(/^Wave 5 — /, "")}"`,
      cumulativeBudget: CUMULATIVE_BUDGET_W5,
      trafficSummary: "~75/sec + chaos (2 crashes + DB edge severed)",
      durationSeconds: W5.wave.duration,
      slaLine: slaLine(W5.sla),
      results,
      intendedLabel: "intended",
    });

    // Pedagogic expectations (CB reportFailure not yet wired into chaos, so
    // CB is runtime-inert; redundancy is the only real resilience lever here):
    //   - intended passes SLA
    //   - carry-over-only fails SLA (no redundancy collapses under crashes)
    //   - intended outranks no-redundancy and carry-over
    const byLabel = new Map(results.map((r) => [r.architecture, r]));
    const intendedR = byLabel.get("intended")!;
    const carryR = byLabel.get("carry-over-only")!;
    const noRedR = byLabel.get("no-redundancy")!;
    expect(intendedR.slaPass).toBe(true);
    expect(carryR.slaPass).toBe(false);
    expect(intendedR.score).toBeGreaterThan(carryR.score);
    expect(intendedR.score).toBeGreaterThan(noRedR.score);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentId } from "@core/types/ids";
import { NETFLIX_LEVELS } from "../../../src/diagnose/netflix-levels";
import { DIAGNOSE_LEVELS, INSTAGRAM_LEVELS } from "../../../src/diagnose/diagnose-level";
import { simulatePlaytest } from "../../../src/playtest/run";
import { topology, type TopologyDef } from "../../../src/playtest/topology-builder";

/**
 * Mirrors the Instagram arc test. We run the starting topology through
 * simulatePlaytest (short duration) — it internally runs validateTopology —
 * and for Level 1 we build the expected-fix topology and assert the SLA
 * passes on a full playtest.
 */
function validateLevelStartingTopology(level: {
  startingTopology: TopologyDef;
  wave: import("@sim/wave").WaveDef;
  sla: import("@sim/sla").SLAThresholds;
  remediationBudget: number;
}) {
  return simulatePlaytest(level.wave, level.sla, level.remediationBudget, level.startingTopology, {
    seed: 42,
    durationOverride: 2,
  });
}

describe("Netflix diagnose arc — 5 levels", () => {
  it("DIAGNOSE_LEVELS includes Instagram then Netflix arcs", () => {
    expect(NETFLIX_LEVELS).toHaveLength(5);
    expect(DIAGNOSE_LEVELS).toHaveLength(INSTAGRAM_LEVELS.length + NETFLIX_LEVELS.length);
    expect(DIAGNOSE_LEVELS.slice(0, INSTAGRAM_LEVELS.length)).toEqual(INSTAGRAM_LEVELS);
    expect(DIAGNOSE_LEVELS.slice(INSTAGRAM_LEVELS.length)).toEqual(NETFLIX_LEVELS);
  });

  it.each(NETFLIX_LEVELS.map((l) => [l.id, l] as const))(
    "%s starting topology has entry + connected endpoints",
    (_id, level) => {
      const topo = level.startingTopology;
      expect(topo.entryTargetId).toBeTruthy();
      const ids = new Set(topo.components.map((c) => c.id));
      for (const edge of topo.connections) {
        expect(ids.has(edge.from)).toBe(true);
        expect(ids.has(edge.to)).toBe(true);
      }
      // 14 baseline-ish + progression; ≥13 is the safety floor.
      expect(topo.components.length).toBeGreaterThanOrEqual(13);
    },
  );

  it.each(NETFLIX_LEVELS.map((l) => [l.id, l] as const))(
    "%s starting topology passes static validateTopology for its wave",
    (_id, level) => {
      const result = validateLevelStartingTopology(level);
      expect(result.topologyErrors).toEqual([]);
    },
  );

  it("Level 1 expected fix (add Profile Cache) passes SLA on playtest", () => {
    // Fix: insert a data_cache between the API Servers and Profile DB.
    const start = NETFLIX_LEVELS[0]!.startingTopology;
    const fix: TopologyDef = {
      ...start,
      components: [
        ...start.components,
        { type: "data_cache", id: "c_profile", label: "Profile Cache" },
      ],
      connections: [
        // Drop direct s* → db_profile; route via c_profile instead.
        ...start.connections.filter((c) => !(c.to === "db_profile" && c.from.startsWith("s"))),
        { from: "s1", to: "c_profile" },
        { from: "s2", to: "c_profile" },
        { from: "s3", to: "c_profile" },
        { from: "c_profile", to: "db_profile" },
      ],
    };
    const level = NETFLIX_LEVELS[0]!;
    const result = simulatePlaytest(level.wave, level.sla, level.remediationBudget, fix, { seed: 42 });
    expect(result.topologyErrors).toEqual([]);
    expect(result.slaPass).toBe(true);
  });

  it("Level 5 carries a chaosSchedule with 4 events", () => {
    const l5 = NETFLIX_LEVELS[4]!;
    expect(l5.chaosSchedule).toBeDefined();
    expect(l5.chaosSchedule!.length).toBe(4);
    for (const ev of l5.chaosSchedule!) {
      expect(ev.atSeconds).toBeGreaterThan(0);
      expect(ev.kind).toMatch(/crash_component|sever_connection/);
      expect(ev.targetRole).toBeTruthy();
    }
  });

  it("Level 4 starting topology assigns zones (zone_na) to core components", () => {
    const l4 = NETFLIX_LEVELS[3]!;
    const zoned = l4.startingTopology.components.filter((c) => c.zone !== undefined);
    expect(zoned.length).toBeGreaterThan(0);
    for (const c of zoned) {
      expect(c.zone).toBe("zone_na");
    }
  });

  it("Level 5 starting topology has both zone_na and zone_ap components", () => {
    const l5 = NETFLIX_LEVELS[4]!;
    const zones = new Set(
      l5.startingTopology.components.map((c) => c.zone).filter((z): z is string => z !== undefined),
    );
    expect(zones.has("zone_na")).toBe(true);
    expect(zones.has("zone_ap")).toBe(true);
  });

  it("Level 4 wave uses 3-zone distribution", () => {
    const l4 = NETFLIX_LEVELS[3]!;
    const zd = l4.wave.zoneDistribution;
    expect(zd).toBeDefined();
    expect(zd!.get("zone_na")).toBeCloseTo(0.4);
    expect(zd!.get("zone_eu")).toBeCloseTo(0.25);
    expect(zd!.get("zone_ap")).toBeCloseTo(0.35);
  });

  it("Level 3 wave is stream-heavy (live-event shape)", () => {
    const l3 = NETFLIX_LEVELS[2]!;
    expect(l3.wave.composition.streamRatio).toBeGreaterThanOrEqual(0.25);
    expect(l3.wave.streamConfig).toBeDefined();
  });

  it("diagnose-levels.html references all 5 Netflix diagnose levels via diagnose.html?level=<id>", () => {
    const levelsHtmlPath = resolve(__dirname, "../../../src/diagnose-levels.html");
    const html = readFileSync(levelsHtmlPath, "utf8");
    for (const level of NETFLIX_LEVELS) {
      expect(html).toContain(`diagnose.html?level=${level.id}`);
    }
  });

  // Keep helper imports live even if the file is edited down later.
  it("__marker__ keeps helper imports live", () => {
    const t = topology("x").add("server", "s1").entry("s1").build();
    expect(t.entryTargetId).toBe("s1");
    const cid: ComponentId = "client" as ComponentId;
    expect(typeof cid).toBe("string");
  });
});

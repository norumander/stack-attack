import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentId } from "@core/types/ids";
import { INSTAGRAM_LEVELS } from "../../../src/diagnose/instagram-levels";
import { DIAGNOSE_LEVELS } from "../../../src/diagnose/diagnose-level";
import { simulatePlaytest } from "../../../src/playtest/run";
import { topology, type TopologyDef } from "../../../src/playtest/topology-builder";

/**
 * Build a sim-compatible TopologyDef from a DiagnoseLevel's starting
 * topology and run it through simulatePlaytest — that utility already runs
 * `validateTopology` internally and surfaces any errors in the result.
 */
function validateLevelStartingTopology(level: {
  startingTopology: TopologyDef;
  wave: import("@sim/wave").WaveDef;
  sla: import("@sim/sla").SLAThresholds;
  remediationBudget: number;
}) {
  return simulatePlaytest(level.wave, level.sla, level.remediationBudget, level.startingTopology, {
    seed: 42,
    // Short duration keeps the test fast; we only care about validation +
    // smoke — SLA numbers are not asserted for the starting topology.
    durationOverride: 2,
  });
}

describe("Instagram diagnose arc — 5 levels", () => {
  it("DIAGNOSE_LEVELS exposes the Instagram arc as its prefix", () => {
    expect(INSTAGRAM_LEVELS).toHaveLength(5);
    expect(DIAGNOSE_LEVELS.slice(0, 5)).toEqual(INSTAGRAM_LEVELS);
  });

  it.each(INSTAGRAM_LEVELS.map((l) => [l.id, l] as const))(
    "%s starting topology has entry + connected endpoints",
    (_id, level) => {
      const topo = level.startingTopology;
      expect(topo.entryTargetId).toBeTruthy();
      const ids = new Set(topo.components.map((c) => c.id));
      for (const edge of topo.connections) {
        expect(ids.has(edge.from)).toBe(true);
        expect(ids.has(edge.to)).toBe(true);
      }
      expect(topo.components.length).toBeGreaterThanOrEqual(12);
    },
  );

  it.each(INSTAGRAM_LEVELS.map((l) => [l.id, l] as const))(
    "%s starting topology passes static validateTopology for its wave",
    (_id, level) => {
      const result = validateLevelStartingTopology(level);
      expect(result.topologyErrors).toEqual([]);
    },
  );

  it("Level 1 expected fix (add Posts Cache) passes SLA on playtest", () => {
    // Fix: insert a data_cache between Servers and Posts CB.
    const start = INSTAGRAM_LEVELS[0]!.startingTopology;
    const fix: TopologyDef = {
      ...start,
      components: [
        ...start.components,
        { type: "data_cache", id: "c_posts", label: "Posts Cache" },
      ],
      connections: [
        // Drop s* → cb_posts; route via c_posts.
        ...start.connections.filter((c) => c.to !== "cb_posts" || !c.from.startsWith("s")),
        { from: "s1", to: "c_posts" },
        { from: "s2", to: "c_posts" },
        { from: "s3", to: "c_posts" },
        { from: "s4", to: "c_posts" },
        { from: "c_posts", to: "cb_posts" },
      ],
    };
    const level = INSTAGRAM_LEVELS[0]!;
    const result = simulatePlaytest(level.wave, level.sla, level.remediationBudget, fix, { seed: 42 });
    expect(result.topologyErrors).toEqual([]);
    expect(result.slaPass).toBe(true);
  });

  it("Level 5 carries a chaosSchedule with 3 events", () => {
    const l5 = INSTAGRAM_LEVELS[4]!;
    expect(l5.chaosSchedule).toBeDefined();
    expect(l5.chaosSchedule!.length).toBe(3);
    // sanity: all events have kind + targetRole + positive atSeconds.
    for (const ev of l5.chaosSchedule!) {
      expect(ev.atSeconds).toBeGreaterThan(0);
      expect(ev.kind).toMatch(/crash_component|sever_connection/);
      expect(ev.targetRole).toBeTruthy();
    }
  });

  it("Level 4 starting topology assigns zones (zone_na) to core components", () => {
    const l4 = INSTAGRAM_LEVELS[3]!;
    const zoned = l4.startingTopology.components.filter((c) => c.zone !== undefined);
    expect(zoned.length).toBeGreaterThan(0);
    for (const c of zoned) {
      expect(c.zone).toBe("zone_na");
    }
  });

  it("Level 5 starting topology has both zone_na and zone_ap components", () => {
    const l5 = INSTAGRAM_LEVELS[4]!;
    const zones = new Set(
      l5.startingTopology.components.map((c) => c.zone).filter((z): z is string => z !== undefined),
    );
    expect(zones.has("zone_na")).toBe(true);
    expect(zones.has("zone_ap")).toBe(true);
  });

  it("levels.html references all 5 Instagram levels via diagnose.html?level=<id>", () => {
    const levelsHtmlPath = resolve(__dirname, "../../../src/levels.html");
    const html = readFileSync(levelsHtmlPath, "utf8");
    for (const level of INSTAGRAM_LEVELS) {
      expect(html).toContain(`diagnose.html?level=${level.id}`);
    }
  });

  // Silence lint/ts unused imports if future edits drop some helpers.
  it("__marker__ keeps helper imports live", () => {
    const t = topology("x").add("server", "s1").entry("s1").build();
    expect(t.entryTargetId).toBe("s1");
    const cid: ComponentId = "client" as ComponentId;
    expect(typeof cid).toBe("string");
  });
});

import { describe, it, expect } from "vitest";
import type { ComponentId } from "@core/types/ids";
import {
  PhysicsDiagnoseController,
  DEFAULT_DELETE_REFUND_RATE,
  type DiagnoseCallbacks,
} from "../../../src/diagnose/diagnose-controller";
import { PLACEHOLDER_DIAGNOSE_LEVEL } from "../../../src/diagnose/placeholder-level";
import type { DiagnoseLevel } from "../../../src/diagnose/diagnose-level";
import { topology } from "../../../src/playtest/topology-builder";

const COSTS = new Map<string, number>([
  ["server", 100],
  ["database", 200],
  ["data_cache", 150],
]);

function makeController(overrides: Partial<DiagnoseLevel> = {}) {
  const placed: Array<{ type: string; id: ComponentId; pos: { x: number; y: number } }> = [];
  const connected: Array<{ from: ComponentId; to: ComponentId }> = [];
  const phases: string[] = [];
  const budgetChanges: number[] = [];

  const callbacks: DiagnoseCallbacks = {
    onPlaced: (type, id, pos) => placed.push({ type, id, pos }),
    onConnected: (from, to) => connected.push({ from, to }),
    onComponentDeleted: () => {},
    onConnectionDeleted: () => {},
    onBudgetChange: (b) => budgetChanges.push(b),
    onPhaseChange: (p) => phases.push(p),
  };

  const level: DiagnoseLevel = { ...PLACEHOLDER_DIAGNOSE_LEVEL, ...overrides };

  const controller = new PhysicsDiagnoseController({
    level,
    componentCosts: COSTS,
    callbacks,
  });
  return { controller, placed, connected, phases, budgetChanges };
}

describe("PhysicsDiagnoseController", () => {
  it("starts in build phase with remediationBudget", () => {
    const { controller } = makeController();
    expect(controller.phase).toBe("build");
    expect(controller.budget).toBe(PLACEHOLDER_DIAGNOSE_LEVEL.remediationBudget);
  });

  it("preplace fires onPlaced for every starting component", () => {
    const { controller, placed } = makeController();
    controller.preplace();
    const expected = PLACEHOLDER_DIAGNOSE_LEVEL.startingTopology.components.length;
    expect(placed).toHaveLength(expected);
    expect(placed.map((p) => p.type)).toEqual(
      PLACEHOLDER_DIAGNOSE_LEVEL.startingTopology.components.map((c) => c.type),
    );
  });

  it("preplace fires onConnected for every starting connection", () => {
    const { controller, connected } = makeController();
    controller.preplace();
    const expected = PLACEHOLDER_DIAGNOSE_LEVEL.startingTopology.connections.length;
    expect(connected).toHaveLength(expected);
  });

  it("preplace does NOT deduct budget for inherited components", () => {
    const { controller, budgetChanges } = makeController();
    const before = controller.budget;
    controller.preplace();
    expect(controller.budget).toBe(before);
    // No onBudgetChange fired from preplace itself.
    expect(budgetChanges).toEqual([]);
  });

  it("preplace is idempotent (second call is a no-op)", () => {
    const { controller, placed } = makeController();
    controller.preplace();
    const count = placed.length;
    controller.preplace();
    expect(placed).toHaveLength(count);
  });

  it("tryDeleteComponent refunds 70% by default (rounded)", () => {
    const { controller, placed } = makeController();
    controller.preplace();
    const budgetAfterPreplace = controller.budget;
    // Delete the first inherited component (a "server" = $100). Expect refund = 70.
    const target = placed[0]!;
    expect(target.type).toBe("server");
    const ok = controller.tryDeleteComponent(target.id);
    expect(ok).toBe(true);
    expect(controller.budget).toBe(budgetAfterPreplace + Math.round(100 * DEFAULT_DELETE_REFUND_RATE));
  });

  it("honors a custom deleteRefundRate on the level", () => {
    const { controller, placed } = makeController({ deleteRefundRate: 0.5 });
    controller.preplace();
    const before = controller.budget;
    const target = placed[0]!;
    controller.tryDeleteComponent(target.id);
    expect(controller.budget).toBe(before + Math.round(100 * 0.5));
  });

  it("tryPlace deducts full cost from remediation budget (like campaign)", () => {
    const level: DiagnoseLevel = {
      ...PLACEHOLDER_DIAGNOSE_LEVEL,
      remediationBudget: 500,
      startingTopology: topology("empty").add("server", "s1").entry("s1").build(),
    };
    const { controller } = makeController(level);
    controller.preplace();
    const before = controller.budget;
    const result = controller.tryPlace("database", { x: 5, y: 5 });
    expect(result.ok).toBe(true);
    expect(controller.budget).toBe(before - 200);
  });

  it("tryPlace fails when remediation budget is exhausted", () => {
    const { controller } = makeController({ remediationBudget: 50 });
    controller.preplace();
    const result = controller.tryPlace("server", { x: 0, y: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insufficient_budget");
  });

  it("tryConnect works like campaign (forward+back ids, no self-connect)", () => {
    const { controller } = makeController({ remediationBudget: 1000 });
    controller.preplace();
    const a = controller.tryPlace("server", { x: 0, y: 0 });
    const b = controller.tryPlace("database", { x: 1, y: 0 });
    if (!a.ok || !b.ok) throw new Error("setup failed");
    const ok = controller.tryConnect(a.componentId, b.componentId);
    expect(ok.ok).toBe(true);
    const self = controller.tryConnect(a.componentId, a.componentId);
    expect(self.ok).toBe(false);
    const dup = controller.tryConnect(a.componentId, b.componentId);
    expect(dup.ok).toBe(false);
  });

  it("ready transitions build → simulate", () => {
    const { controller, phases } = makeController();
    controller.preplace();
    controller.ready();
    expect(controller.phase).toBe("simulate");
    expect(phases).toContain("simulate");
  });

  it("onWaveEnd routes to won or lost based on SLA pass", () => {
    const a = makeController();
    a.controller.preplace();
    a.controller.ready();
    a.controller.onWaveEnd(true);
    expect(a.controller.phase).toBe("won");

    const b = makeController();
    b.controller.preplace();
    b.controller.ready();
    b.controller.onWaveEnd(false);
    expect(b.controller.phase).toBe("lost");
  });

  it("tryPlace/tryDelete disabled after ready", () => {
    const { controller, placed } = makeController();
    controller.preplace();
    controller.ready();
    const place = controller.tryPlace("server", { x: 0, y: 0 });
    expect(place.ok).toBe(false);
    const del = controller.tryDeleteComponent(placed[0]!.id);
    expect(del).toBe(false);
  });
});

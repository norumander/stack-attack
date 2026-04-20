/**
 * Diagnose boot runtime — verifies that the tier-based layout + controller
 * preplace combine to produce a visible system. Doesn't spin up the real
 * renderer or HUD; it taps the callback surface and a mock renderer/sim to
 * observe that N components + M connections made it through.
 */
import { describe, it, expect } from "vitest";
import type { ComponentId } from "@core/types/ids";
import {
  PhysicsDiagnoseController,
  type DiagnoseCallbacks,
} from "../../../src/diagnose/diagnose-controller";
import { COMPONENT_COSTS } from "../../../src/physics-td/component-factory";
import { INSTAGRAM_LEVELS } from "../../../src/diagnose/instagram-levels";

/**
 * Duplicate of the buildLayout closure in diagnose-boot.ts. Kept here so
 * the test doesn't need to stand up the whole boot graph (DOM, renderer,
 * chatbot) — and lets us assert column-spreading without brittle DOM.
 * If the production layout algorithm changes the tests in this file
 * should be updated in lockstep.
 */
function tierColumnFor(type: string): number {
  switch (type) {
    case "dns_gtm":
      return 0;
    case "cdn":
      return 1;
    case "api_gateway":
      return 2;
    case "load_balancer":
      return 3;
    case "server":
    case "streaming_server":
    case "queue":
      return 4;
    case "data_cache":
    case "edge_cache":
    case "worker":
    case "circuit_breaker":
      return 5;
    case "database":
    case "blob_storage":
      return 6;
    default:
      return 5;
  }
}

describe("diagnose-boot runtime (preplace + layout)", () => {
  it("Instagram L1: preplace fires all components + connections", () => {
    const level = INSTAGRAM_LEVELS[0]!;
    const expectedComponents = level.startingTopology.components.length;
    const expectedConnections = level.startingTopology.connections.length;

    const placed: Array<{ type: string; id: ComponentId; pos: { x: number; y: number } }> = [];
    const connected: Array<{ from: ComponentId; to: ComponentId }> = [];
    const phases: string[] = [];

    const callbacks: DiagnoseCallbacks = {
      onPlaced: (type, id, pos) => placed.push({ type, id, pos }),
      onConnected: (from, to) => connected.push({ from, to }),
      onComponentDeleted: () => {},
      onConnectionDeleted: () => {},
      onBudgetChange: () => {},
      onPhaseChange: (p) => phases.push(p),
    };

    const controller = new PhysicsDiagnoseController({
      level,
      componentCosts: COMPONENT_COSTS,
      callbacks,
    });

    // Tier layout identical to what diagnose-boot.ts uses at runtime.
    const components = level.startingTopology.components;
    const colCounts = new Map<number, number>();
    const assigned = new Map<string, { x: number; y: number }>();
    for (const c of components) {
      const col = tierColumnFor(c.type);
      const row = colCounts.get(col) ?? 0;
      colCounts.set(col, row + 1);
      assigned.set(c.id, { x: col, y: row });
    }
    const layout = (topoId: string): { x: number; y: number } =>
      assigned.get(topoId) ?? { x: 5, y: 0 };

    controller.preplace(layout);

    // All components fired.
    expect(placed).toHaveLength(expectedComponents);
    // All edges fired.
    expect(connected).toHaveLength(expectedConnections);

    // Budget untouched (inherited components don't cost the player).
    expect(controller.budget).toBe(level.remediationBudget);

    // Layout distinctness — no two placed components at the same (x,y).
    const posKeys = new Set(placed.map((p) => `${p.pos.x}:${p.pos.y}`));
    expect(posKeys.size).toBe(placed.length);

    // Layout spans multiple columns (ingress → data).
    const xs = new Set(placed.map((p) => p.pos.x));
    expect(xs.size).toBeGreaterThanOrEqual(4);
  });

  it("preplace is idempotent", () => {
    const level = INSTAGRAM_LEVELS[0]!;
    const placed: unknown[] = [];
    const callbacks: DiagnoseCallbacks = {
      onPlaced: (type, id, pos) => placed.push({ type, id, pos }),
      onConnected: () => {},
      onComponentDeleted: () => {},
      onConnectionDeleted: () => {},
      onBudgetChange: () => {},
      onPhaseChange: () => {},
    };
    const controller = new PhysicsDiagnoseController({
      level,
      componentCosts: COMPONENT_COSTS,
      callbacks,
    });
    controller.preplace();
    const count = placed.length;
    controller.preplace();
    expect(placed.length).toBe(count);
  });

  it("Instagram L1 topology includes the expected ingress tiers", () => {
    const level = INSTAGRAM_LEVELS[0]!;
    const types = new Set(level.startingTopology.components.map((c) => c.type));
    // Reads as a real system at a glance.
    expect(types.has("cdn")).toBe(true);
    expect(types.has("api_gateway")).toBe(true);
    expect(types.has("server")).toBe(true);
    expect(types.has("database")).toBe(true);
    // Instagram L1 specifically ships with a queue/worker pair for the async path.
    expect(types.has("queue")).toBe(true);
    expect(types.has("worker")).toBe(true);
  });
});

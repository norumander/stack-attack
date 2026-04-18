import { describe, it, beforeEach, expect } from "vitest";
import { PhysicsCampaignController } from "../../../../src/dashboard/physics-td/campaign-controller";
import type { ComponentId } from "@core/types/ids";

describe("PhysicsCampaignController", () => {
  function makeController() {
    const callbacks = {
      placed: [] as Array<{ type: string; gridPos: { x: number; y: number } }>,
      phaseChanges: [] as Array<{ phase: string; waveIndex: number }>,
      budgetChanges: [] as number[],
    };
    const controller = new PhysicsCampaignController({
      waves: [
        { id: "test-1", startBudget: 500 },
        { id: "test-2", startBudget: 700 },
      ],
      componentCosts: new Map([["server", 100], ["data_cache", 150]]),
      callbacks: {
        onPlaced: (type, _id, gridPos) => callbacks.placed.push({ type, gridPos }),
        onConnected: () => {},
        onPhaseChange: (phase, waveIndex) => callbacks.phaseChanges.push({ phase, waveIndex }),
        onBudgetChange: (b) => callbacks.budgetChanges.push(b),
      },
    });
    return { controller, callbacks };
  }

  it("starts in build phase at wave 0 with starting budget", () => {
    const { controller } = makeController();
    expect(controller.phase).toBe("build");
    expect(controller.currentWaveIndex).toBe(0);
    expect(controller.budget).toBe(500);
  });

  it("tryPlace deducts cost and fires onPlaced + onBudgetChange", () => {
    const { controller, callbacks } = makeController();
    const result = controller.tryPlace("server", { x: 1, y: 1 });
    expect(result.ok).toBe(true);
    expect(controller.budget).toBe(400);
    expect(callbacks.placed).toHaveLength(1);
    expect(callbacks.placed[0]).toEqual({ type: "server", gridPos: { x: 1, y: 1 } });
    expect(callbacks.budgetChanges).toEqual([400]);
  });

  it("tryPlace fails when budget insufficient", () => {
    const { controller, callbacks } = makeController();
    controller.tryPlace("server", { x: 1, y: 1 });
    controller.tryPlace("server", { x: 2, y: 1 });
    controller.tryPlace("server", { x: 3, y: 1 });
    controller.tryPlace("server", { x: 4, y: 1 });
    controller.tryPlace("server", { x: 5, y: 1 });
    const result = controller.tryPlace("server", { x: 6, y: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_budget");
    expect(controller.budget).toBe(0);
    expect(callbacks.placed).toHaveLength(5);
  });

  it("ready() transitions build → simulate", () => {
    const { controller, callbacks } = makeController();
    controller.ready();
    expect(controller.phase).toBe("simulate");
    expect(callbacks.phaseChanges.at(-1)).toEqual({ phase: "simulate", waveIndex: 0 });
  });

  it("onWaveEnd(passed=true) → won phase, then nextWave advances", () => {
    const { controller, callbacks } = makeController();
    controller.ready();
    controller.onWaveEnd(true);
    expect(controller.phase).toBe("won");
    controller.nextWave();
    expect(controller.currentWaveIndex).toBe(1);
    expect(controller.phase).toBe("build");
    expect(controller.budget).toBe(700);
    expect(callbacks.phaseChanges.map((p) => p.phase)).toEqual(["simulate", "won", "build"]);
  });

  it("onWaveEnd(passed=false) → lost phase, retry resets to current wave start", () => {
    const { controller, callbacks } = makeController();
    controller.tryPlace("server", { x: 1, y: 1 });
    expect(controller.budget).toBe(400);
    controller.ready();
    controller.onWaveEnd(false);
    expect(controller.phase).toBe("lost");
    controller.retry();
    expect(controller.phase).toBe("build");
    expect(controller.budget).toBe(500);
    expect(callbacks.phaseChanges.map((p) => p.phase)).toEqual(["simulate", "lost", "build"]);
  });

  it("nextWave on the last wave triggers campaign-complete", () => {
    const { controller } = makeController();
    controller.ready();
    controller.onWaveEnd(true);
    controller.nextWave();
    controller.ready();
    controller.onWaveEnd(true);
    controller.nextWave();
    expect(controller.phase).toBe("campaign-complete");
  });
});

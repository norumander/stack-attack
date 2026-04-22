import { describe, it, expect } from "vitest";
import { SandboxController } from "../../src/sandbox/sandbox-controller";
import type { ComponentId, ConnectionId } from "@core/types/ids";

describe("SandboxController", () => {
  function makeController() {
    const placed: Array<{ type: string; id: ComponentId }> = [];
    const connected: Array<{ src: ComponentId; tgt: ComponentId }> = [];
    const ctrl = new SandboxController({
      onPlaced: (type, id, _pos) => placed.push({ type, id }),
      onConnected: (src, tgt) => connected.push({ src, tgt }),
      onComponentDeleted: () => {},
      onConnectionDeleted: () => {},
      onBudgetChange: () => {},
    });
    return { ctrl, placed, connected };
  }

  it("places components with no budget limit", () => {
    const { ctrl, placed } = makeController();
    for (let i = 0; i < 100; i++) {
      const r = ctrl.tryPlace("server", { x: i, y: 0 });
      expect(r.ok).toBe(true);
    }
    expect(placed).toHaveLength(100);
  });

  it("isBuildPhase returns true in build, false in simulate", () => {
    const { ctrl } = makeController();
    expect(ctrl.phase).toBe("build");
    const r = ctrl.tryPlace("server", { x: 0, y: 0 });
    expect(r.ok).toBe(true);
    ctrl.startSimulate();
    const r2 = ctrl.tryPlace("server", { x: 1, y: 0 });
    expect(r2.ok).toBe(false);
    ctrl.stopSimulate();
    expect(ctrl.phase).toBe("build");
  });
});

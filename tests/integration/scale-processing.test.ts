import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { makeComponent } from "@harness/fixtures";
import { TestScalingCapability } from "@harness/scaling-capability";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { CapabilityId, ComponentId } from "@core/types/ids";

describe("SCALE side effect end-to-end", () => {
  it("scales instanceCount via engine tick and records it in metrics", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const scaleCap = new TestScalingCapability("scale" as CapabilityId, 3);
    const comp = makeComponent({
      id: "c1",
      capabilities: new Map([["scale" as CapabilityId, scaleCap]]),
      tiers: new Map([["scale" as CapabilityId, 1]]),
    });
    // Enable scaling (runtime override of readonly)
    (comp as { maxInstances: number }).maxInstances = 5;
    state.placeComponent(comp);

    const mc = new NoOpModeController({
      targetEntryPointId: "c1" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });

    const engine = new Engine(state);

    // Tick 0: request processed → SCALE(3) emitted → instanceCount becomes 3
    engine.tick(mc);

    expect(comp.instanceCount).toBe(3);

    // Metrics should show instanceCount = 3 for this tick
    const metrics = state.metricsHistory[0]!;
    const perComp = metrics.perComponent.get("c1" as ComponentId)!;
    expect(perComp.instanceCount).toBe(3);

    // SCALED event should be in the request log
    let foundScaled = false;
    for (const log of state.requestLog.values()) {
      if (log.some((e) => e.type === "SCALED")) {
        foundScaled = true;
        break;
      }
    }
    expect(foundScaled).toBe(true);
  });
});

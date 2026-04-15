import { describe, it, expect } from "vitest";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import { bootTDRegistry, makeRng } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";

const MINIMAL_WAVE: TDWaveDefinition = {
  id: 1,
  name: "Test",
  startingBudget: 600,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 30,
  ttl: 10,
  availableComponents: ["server", "database"],
  dropThreshold: 0.2,
  revenuePerRequestType: new Map([["api_read", 1]]),
  viabilityPerFailure: 0.1,
  viabilityRampPenalty: 0.5,
};

function makeController(): TDModeController {
  return new TDModeController({
    waves: [MINIMAL_WAVE],
    economy: new TDEconomy({
      startingBudget: 600,
      revenuePerRequestType: new Map([["api_read", 1]]),
    }),
    entryPointId: "client-entry" as ComponentId,
    rng: makeRng(1),
    componentRegistry: bootTDRegistry(),
  });
}

describe("TDModeController.getViability", () => {
  it("starts at 100/100", () => {
    const controller = makeController();
    const v = controller.getViability();
    expect(v.value).toBe(100);
    expect(v.max).toBe(100);
    expect(v.fraction).toBe(1);
    expect(v.isDead).toBe(false);
  });
});

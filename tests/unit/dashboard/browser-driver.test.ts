import { describe, it, expect } from "vitest";
import { Sim } from "@sim/sim";
import { BrowserDriver } from "../../../src/dashboard/sim-demo/browser-driver";

describe("BrowserDriver", () => {
  it("drains wall-clock delta in fixed 1/60s sim steps", () => {
    const sim = new Sim({ seed: 1 });
    const driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    const stepsTaken = driver.tick(100);
    expect(stepsTaken).toBe(6);
    expect(sim.simTime).toBeCloseTo(6 / 60, 6);
  });

  it("accumulates leftover delta between ticks", () => {
    const sim = new Sim({ seed: 1 });
    const driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    expect(driver.tick(10)).toBe(0);
    expect(driver.tick(10)).toBe(1);
  });

  it("caps catch-up to avoid death spiral", () => {
    const sim = new Sim({ seed: 1 });
    const driver = new BrowserDriver(sim, { stepSeconds: 1 / 60, maxStepsPerTick: 4 });
    expect(driver.tick(1000)).toBe(4);
  });
});

import { describe, it, expect } from "vitest";
import { Sim } from "@sim/sim";

describe("Sim — empty state", () => {
  it("steps without error and advances sim time", () => {
    const sim = new Sim({ seed: 1 });
    expect(sim.simTime).toBe(0);
    sim.step(1 / 60);
    expect(sim.simTime).toBeCloseTo(1 / 60, 9);
    sim.step(1 / 60);
    expect(sim.simTime).toBeCloseTo(2 / 60, 9);
  });

  it("tracks empty collections at start", () => {
    const sim = new Sim({ seed: 1 });
    expect(sim.components.size).toBe(0);
    expect(sim.connections.size).toBe(0);
    expect(sim.activePackets.length).toBe(0);
  });
});

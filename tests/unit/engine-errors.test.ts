import { describe, it, expect } from "vitest";
import { FixedPointRunaway, IllegalStateError } from "@core/engine/errors";
import { FIXED_POINT_CAP } from "@core/engine/constants";
import { SimulationState } from "@core/state/simulation-state";

describe("engine constants and errors", () => {
  it("FIXED_POINT_CAP is 256", () => {
    expect(FIXED_POINT_CAP).toBe(256);
  });

  it("FixedPointRunaway carries the state snapshot and iteration count", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const err = new FixedPointRunaway(state, 256);
    expect(err).toBeInstanceOf(Error);
    expect(err.iterations).toBe(256);
    expect(err.state).toBe(state);
    expect(err.message).toContain("256");
  });

  it("IllegalStateError is a plain Error subclass", () => {
    const err = new IllegalStateError("cannot place during simulate");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("cannot place during simulate");
  });
});

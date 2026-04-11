import type { SimulationState } from "../state/simulation-state.js";

export class FixedPointRunaway extends Error {
  constructor(
    public readonly state: SimulationState,
    public readonly iterations: number,
  ) {
    super(
      `Fixed-point loop failed to quiesce after ${iterations} iterations. ` +
      `This indicates a bug: either a processing cycle that never terminates, ` +
      `or a capability that unconditionally stages new work on every visit.`,
    );
    this.name = "FixedPointRunaway";
  }
}

export class IllegalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalStateError";
  }
}

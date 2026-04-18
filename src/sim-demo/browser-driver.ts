import type { Sim } from "@sim/sim";

export type BrowserDriverOptions = {
  readonly stepSeconds: number;
  readonly maxStepsPerTick?: number;
};

export class BrowserDriver {
  private accumulatedMs = 0;
  private readonly stepMs: number;
  private readonly maxSteps: number;

  constructor(private readonly sim: Sim, opts: BrowserDriverOptions) {
    this.stepMs = opts.stepSeconds * 1000;
    this.maxSteps = opts.maxStepsPerTick ?? 6;
  }

  tick(deltaMs: number): number {
    this.accumulatedMs += deltaMs;
    let steps = 0;
    // Small epsilon absorbs floating-point drift so that e.g. 100ms at 1/60s
    // reliably yields 6 steps instead of 5 due to stepMs being 16.66...68.
    const epsilon = 1e-9;
    while (this.accumulatedMs + epsilon >= this.stepMs && steps < this.maxSteps) {
      this.sim.step(this.stepMs / 1000);
      this.accumulatedMs -= this.stepMs;
      steps += 1;
    }
    return steps;
  }
}

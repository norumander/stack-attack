import type { Sim } from "@sim/sim";
import type { SimEvent } from "@sim/types";

export type BrowserDriverOptions = {
  readonly stepSeconds: number;
  readonly maxStepsPerTick?: number;
};

export class BrowserDriver {
  private accumulatedMs = 0;
  private readonly stepMs: number;
  private readonly maxSteps: number;
  /** All SimEvents emitted across every step in the most recent tick() call. */
  readonly tickEvents: SimEvent[] = [];

  constructor(private readonly sim: Sim, opts: BrowserDriverOptions) {
    this.stepMs = opts.stepSeconds * 1000;
    this.maxSteps = opts.maxStepsPerTick ?? 6;
  }

  tick(deltaMs: number): number {
    this.tickEvents.length = 0;
    this.accumulatedMs += deltaMs;
    let steps = 0;
    // Small epsilon absorbs floating-point drift so that e.g. 100ms at 1/60s
    // reliably yields 6 steps instead of 5 due to stepMs being 16.66...68.
    const epsilon = 1e-9;
    while (this.accumulatedMs + epsilon >= this.stepMs && steps < this.maxSteps) {
      this.sim.step(this.stepMs / 1000);
      for (const ev of this.sim.lastStepEvents) this.tickEvents.push(ev);
      this.accumulatedMs -= this.stepMs;
      steps += 1;
    }
    return steps;
  }
}

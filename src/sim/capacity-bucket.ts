export type CapacityBucketOptions = {
  readonly capacityPerSecond: number;
};

/**
 * Per-component credit bucket. Starts full. Refills at capacityPerSecond × dt
 * per sim step, capped at capacityPerSecond (one full refill per second).
 * Consume atomically succeeds or fails — no fractional acceptance.
 */
export class CapacityBucket {
  private credits: number;
  private max: number;
  /** Tokens consumed since the last `refill()` call. Used by AutoScale to
   * compute a windowed utilization rate rather than sampling instantaneous
   * remaining credits (which is spiky under sparse arrivals). */
  private consumedThisStep = 0;

  constructor(opts: CapacityBucketOptions) {
    this.max = opts.capacityPerSecond;
    this.credits = opts.capacityPerSecond;
  }

  available(): number {
    return this.credits;
  }

  capacity(): number {
    return this.max;
  }

  /** Tokens consumed since the last `refill()` call (i.e. this sim step). */
  getConsumedThisStep(): number {
    return this.consumedThisStep;
  }

  /** Resize the bucket's max capacity. Does not refill credits; clamps if
   * current credits exceed new max. Used by AutoScale tier bumps. */
  setCapacity(capacityPerSecond: number): void {
    this.max = capacityPerSecond;
    if (this.credits > this.max) this.credits = this.max;
  }

  tryConsume(amount: number): boolean {
    if (amount > this.credits) return false;
    this.credits -= amount;
    this.consumedThisStep += amount;
    return true;
  }

  refill(dt: number): void {
    this.credits = Math.min(this.max, this.credits + this.max * dt);
    this.consumedThisStep = 0;
  }
}

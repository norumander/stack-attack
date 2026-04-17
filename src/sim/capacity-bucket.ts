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
  private readonly max: number;

  constructor(opts: CapacityBucketOptions) {
    this.max = opts.capacityPerSecond;
    this.credits = opts.capacityPerSecond;
  }

  available(): number {
    return this.credits;
  }

  tryConsume(amount: number): boolean {
    if (amount > this.credits) return false;
    this.credits -= amount;
    return true;
  }

  refill(dt: number): void {
    this.credits = Math.min(this.max, this.credits + this.max * dt);
  }
}

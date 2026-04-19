/**
 * Campaign viability pool. Drains on failed requests, never refills.
 * Hits zero → game over → restart from wave 1.
 *
 * Tunable: DAMAGE_PER_FAILURE is intentionally coarse. A bad wave ~5
 * (480 packets at 50% fail = 240 hits) will kill a full bar. Ok run
 * (~30 drops across the campaign) costs about a third.
 */
export const DAMAGE_PER_FAILURE = 1;

export class Viability {
  private current: number;
  readonly max: number;

  constructor(initial = 100, max = 100) {
    this.max = max;
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  get fraction(): number {
    return this.current / this.max;
  }

  get isDead(): boolean {
    return this.current <= 0;
  }

  damage(amount: number): void {
    if (amount <= 0) return;
    this.current = Math.max(0, this.current - amount);
  }
}

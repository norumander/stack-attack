/**
 * TD-mode campaign viability (health pool).
 *
 * Persistent across the entire TD campaign — never refilled, never reset
 * between waves. Damaged by dropped/timed-out requests (per-failure cost)
 * and by sustained SLA failures (ramping per-tick cost). Hits zero → run
 * is over → dashboard death modal → restart from Wave 1.
 *
 * Lives entirely in TD-mode land. The engine and other modes have no
 * knowledge of viability.
 */
export class TDViability {
  private current: number;
  private readonly max: number;

  constructor(initial = 100, max = 100) {
    this.max = max;
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  get maxValue(): number {
    return this.max;
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

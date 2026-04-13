import type { Engine } from "@core/engine/engine";
import type { SimulationState } from "@core/state/simulation-state";
import type { ModeController } from "@core/mode/mode-controller";

export interface SimLoopOptions<T extends ModeController> {
  engine: Engine;
  state: SimulationState;
  controller: T;
  /**
   * Called after each tick. Receives the controller (concrete type)
   * so the caller can extract mode-specific snapshot data.
   */
  onTick: (controller: T, state: SimulationState) => void;
  /** Optional: called before each tick. If it returns true, the loop halts. */
  shouldStop?: (controller: T, state: SimulationState) => boolean;
  /** Initial tick interval in ms. Defaults to 300. */
  tickInterval?: number;
}

export class SimLoop<T extends ModeController> {
  private engine: Engine;
  private state: SimulationState;
  private controller: T;
  private readonly onTickCb: (c: T, s: SimulationState) => void;
  private readonly shouldStop?: (c: T, s: SimulationState) => boolean;

  private running = false;
  private animFrameId = 0;
  private lastTickTime = 0;
  private _tickInterval: number;

  constructor(options: SimLoopOptions<T>) {
    this.engine = options.engine;
    this.state = options.state;
    this.controller = options.controller;
    this.onTickCb = options.onTick;
    if (options.shouldStop !== undefined) {
      this.shouldStop = options.shouldStop;
    }
    this._tickInterval = Math.max(20, options.tickInterval ?? 300);
  }

  get tickInterval(): number {
    return this._tickInterval;
  }

  set tickInterval(ms: number) {
    this._tickInterval = Math.max(20, ms);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentTick(): number {
    return this.state.currentTick;
  }

  reset(engine: Engine, state: SimulationState, controller: T): void {
    this.stop();
    this.engine = engine;
    this.state = state;
    this.controller = controller;
  }

  step(): void {
    if (this.shouldStop?.(this.controller, this.state)) {
      this.stop();
      return;
    }
    this.engine.tick(this.controller);
    this.onTickCb(this.controller, this.state);
  }

  play(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = performance.now();
    this.loop(this.lastTickTime);
  }

  stop(): void {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
  }

  private loop(timestamp: number): void {
    if (!this.running) return;
    if (timestamp - this.lastTickTime >= this._tickInterval) {
      this.step();
      this.lastTickTime = timestamp;
    }
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }
}

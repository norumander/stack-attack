import type { Engine } from "@core/engine/engine";
import type { SimulationState } from "@core/state/simulation-state";
import type { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import type { TickMetrics } from "@core/types/metrics";
import type { MetricsSnapshot } from "@modes/sandbox/sandbox-mode-controller";

export type TickCallback = (
  tick: number,
  metrics: TickMetrics,
  snapshot: MetricsSnapshot,
) => void;

export class SimLoop {
  private engine: Engine;
  private state: SimulationState;
  private controller: SandboxModeController;
  private running = false;
  private animFrameId = 0;
  private lastTickTime = 0;
  private _tickInterval = 300;
  private _onTick: TickCallback = () => {};

  constructor(engine: Engine, state: SimulationState, controller: SandboxModeController) {
    this.engine = engine;
    this.state = state;
    this.controller = controller;
  }

  set onTick(cb: TickCallback) {
    this._onTick = cb;
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

  reset(engine: Engine, state: SimulationState, controller: SandboxModeController): void {
    this.stop();
    this.engine = engine;
    this.state = state;
    this.controller = controller;
  }

  step(): void {
    this.engine.tick(this.controller);
    const history = this.state.metricsHistory;
    const lastMetrics = history[history.length - 1];
    if (lastMetrics) {
      const snapshot = this.controller.getMetricsSnapshot(this.state);
      this._onTick(this.state.currentTick, lastMetrics, snapshot);
    }
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
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }
}

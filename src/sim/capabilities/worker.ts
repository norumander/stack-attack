import type { Packet, SimCapability } from "../types";
import type { QueueCapability } from "./queue";

export type WorkerCapabilityOptions = {
  readonly pullRate: number;
  readonly revenuePerItem: number;
};

export class WorkerCapability implements SimCapability {
  readonly id = "worker";
  readonly queue: QueueCapability;
  private credits = 0;
  constructor(public readonly opts: WorkerCapabilityOptions, queue: QueueCapability) {
    this.queue = queue;
  }
  onArriveRequest(): { kind: "drop"; reason: string; count: number } {
    return { kind: "drop", reason: "worker_not_arrived_path", count: 0 };
  }
  refillPull(dt: number): void {
    this.credits = Math.min(this.opts.pullRate, this.credits + this.opts.pullRate * dt);
  }
  tryPullOne(): Packet | null {
    if (this.credits < 1) return null;
    const p = this.queue.held.shift();
    if (!p) return null;
    this.credits -= 1;
    return p;
  }
}

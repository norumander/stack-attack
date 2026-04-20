import { SimComponent, type SimComponentOptions } from "./component";
import type { Packet } from "./types";
import type { TrafficSource } from "./traffic-source";

export type SimClientOptions = SimComponentOptions & {
  readonly packetRate: number;
  readonly snakeMax?: number;
  readonly trafficSource?: TrafficSource;
  readonly waveStartTime?: number;
  readonly waveEndTime?: number;
  /** Seconds over which traffic ramps from 0 to full packetRate. */
  readonly rampSeconds?: number;
};

export class SimClient extends SimComponent {
  readonly packetRate: number;
  readonly snakeMax: number;
  readonly snake: Packet[] = [];
  readonly trafficSource: TrafficSource | null;
  readonly waveStartTime: number;
  readonly waveEndTime: number;
  readonly rampSeconds: number;
  nextLaunchTime: number = 0;
  nextGenerateTime: number = 0;

  constructor(opts: SimClientOptions) {
    super(opts);
    this.packetRate = opts.packetRate;
    this.snakeMax = opts.snakeMax ?? 10;
    this.trafficSource = opts.trafficSource ?? null;
    this.waveStartTime = opts.waveStartTime ?? 0;
    this.waveEndTime = opts.waveEndTime ?? Number.POSITIVE_INFINITY;
    this.rampSeconds = opts.rampSeconds ?? 0;
    this.nextLaunchTime = this.waveStartTime;
    this.nextGenerateTime = this.waveStartTime;
  }

  /** Ramp factor (0..1) at the given sim time. 1 = full intensity. */
  rampFactor(simTime: number): number {
    if (this.rampSeconds <= 0) return 1;
    const elapsed = simTime - this.waveStartTime;
    if (elapsed >= this.rampSeconds) return 1;
    return Math.max(0, elapsed / this.rampSeconds);
  }
}

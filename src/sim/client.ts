import { SimComponent, type SimComponentOptions } from "./component";
import type { Packet } from "./types";
import type { TrafficSource } from "./traffic-source";

export type SimClientOptions = SimComponentOptions & {
  readonly packetRate: number;
  readonly snakeMax?: number;
  readonly trafficSource?: TrafficSource;
  readonly waveStartTime?: number;
  readonly waveEndTime?: number;
};

export class SimClient extends SimComponent {
  readonly packetRate: number;
  readonly snakeMax: number;
  readonly snake: Packet[] = [];
  readonly trafficSource: TrafficSource | null;
  readonly waveStartTime: number;
  readonly waveEndTime: number;
  nextLaunchTime: number = 0;
  nextGenerateTime: number = 0;

  constructor(opts: SimClientOptions) {
    super(opts);
    this.packetRate = opts.packetRate;
    this.snakeMax = opts.snakeMax ?? 10;
    this.trafficSource = opts.trafficSource ?? null;
    this.waveStartTime = opts.waveStartTime ?? 0;
    this.waveEndTime = opts.waveEndTime ?? Number.POSITIVE_INFINITY;
    this.nextLaunchTime = this.waveStartTime;
    this.nextGenerateTime = this.waveStartTime;
  }
}

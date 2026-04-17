import { SimComponent, type SimComponentOptions } from "./component";
import type { Packet } from "./types";

export type SimClientOptions = SimComponentOptions & {
  readonly packetRate: number;
  readonly snakeMax?: number;
};

export class SimClient extends SimComponent {
  readonly packetRate: number;
  readonly snakeMax: number;
  readonly snake: Packet[] = [];
  nextLaunchTime: number = 0;
  nextGenerateTime: number = 0;

  constructor(opts: SimClientOptions) {
    super(opts);
    this.packetRate = opts.packetRate;
    this.snakeMax = opts.snakeMax ?? 10;
  }
}

import type { ComponentId } from "@core/types/ids";
import type { SimCapability } from "./types";
import { CapacityBucket } from "./capacity-bucket";

export type SimComponentOptions = {
  readonly id: ComponentId;
  readonly capabilities: readonly SimCapability[];
  readonly capacityPerSecond?: number;
};

export class SimComponent {
  readonly id: ComponentId;
  readonly capabilities: readonly SimCapability[];
  readonly bucket: CapacityBucket | null;
  readonly state: Map<string, unknown> = new Map();

  constructor(opts: SimComponentOptions) {
    this.id = opts.id;
    this.capabilities = opts.capabilities;
    this.bucket =
      opts.capacityPerSecond !== undefined
        ? new CapacityBucket({ capacityPerSecond: opts.capacityPerSecond })
        : null;
  }

  refillBucket(dt: number): void {
    this.bucket?.refill(dt);
  }
}

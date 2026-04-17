import type { ComponentId } from "@core/types/ids";
import type { SimCapability, Zone } from "./types";
import { CapacityBucket } from "./capacity-bucket";

export type SimComponentOptions = {
  readonly id: ComponentId;
  readonly capabilities: readonly SimCapability[];
  readonly capacityPerSecond?: number;
  readonly zone?: Zone;
};

export class SimComponent {
  readonly id: ComponentId;
  readonly capabilities: readonly SimCapability[];
  readonly bucket: CapacityBucket | null;
  readonly state: Map<string, unknown> = new Map();
  readonly zone: Zone | null;

  constructor(opts: SimComponentOptions) {
    this.id = opts.id;
    this.capabilities = opts.capabilities;
    this.bucket =
      opts.capacityPerSecond !== undefined
        ? new CapacityBucket({ capacityPerSecond: opts.capacityPerSecond })
        : null;
    this.zone = opts.zone ?? null;
  }

  refillBucket(dt: number): void {
    this.bucket?.refill(dt);
  }
}

import type { ComponentId } from "@core/types/ids";
import type { SimCapability, Zone } from "./types";
import { CapacityBucket } from "./capacity-bucket";

export const MAX_TIER = 5;

export type SimComponentOptions = {
  readonly id: ComponentId;
  readonly capabilities: SimCapability[];
  readonly capacityPerSecond?: number;
  readonly zone?: Zone;
  readonly tier?: number;
  /**
   * Optional short human-readable identifier shown above the sprite
   * (e.g. "Server 1", "Profile DB"). When omitted, the renderer
   * auto-generates one based on type + per-type index.
   */
  readonly label?: string;
};

export class SimComponent {
  readonly id: ComponentId;
  readonly capabilities: SimCapability[];
  readonly bucket: CapacityBucket | null;
  /** Base (tier-1) capacity. Effective capacity is base × tier. */
  readonly capacityPerSecond: number | null;
  readonly state: Map<string, unknown> = new Map();
  readonly zone: Zone | null;
  readonly label: string | undefined;
  tier: number;

  constructor(opts: SimComponentOptions) {
    this.id = opts.id;
    this.capabilities = [...opts.capabilities];
    this.tier = opts.tier ?? 1;
    this.capacityPerSecond = opts.capacityPerSecond ?? null;
    this.bucket =
      opts.capacityPerSecond !== undefined
        ? new CapacityBucket({ capacityPerSecond: opts.capacityPerSecond * this.tier })
        : null;
    this.zone = opts.zone ?? null;
    this.label = opts.label;
  }

  /** Tier-scaled capacity. Returns 0 when the component has no bucket. */
  getEffectiveCapacity(): number {
    if (this.capacityPerSecond === null) return 0;
    return this.capacityPerSecond * this.tier;
  }

  /** Increment tier, capped at MAX_TIER. Resizes the bucket so current
   * sim steps immediately see the larger capacity. Returns true if bumped. */
  bumpTier(): boolean {
    if (this.tier >= MAX_TIER) return false;
    this.tier += 1;
    if (this.bucket && this.capacityPerSecond !== null) {
      this.bucket.setCapacity(this.capacityPerSecond * this.tier);
    }
    return true;
  }

  refillBucket(dt: number): void {
    this.bucket?.refill(dt);
  }
}

import type { TrafficSource } from "@core/mode/traffic-source.js";
import type { Request } from "@core/types/request.js";
import type { ComponentId, RequestId } from "@core/types/ids.js";
import type { TDWaveDefinition } from "./td-waves.js";

export interface TDTrafficSourceOptions {
  readonly wave: TDWaveDefinition;
  readonly targetEntryPointId: ComponentId;
  readonly rng: () => number;
}

/**
 * Generates requests for a TD wave. Samples request type from the wave's
 * composition map and assigns api_read requests a payload key from a
 * small pool (configured via wave.readKeyPoolSize) so CachingCapability
 * sees a realistic working set instead of collapsing to a single bucket.
 */
export class TDTrafficSource implements TrafficSource {
  // `targetEntryPointId` must be public — TrafficSource interface declares it readonly public.
  readonly targetEntryPointId: ComponentId;
  private readonly wave: TDWaveDefinition;
  private readonly rng: () => number;
  private readonly readKeyPoolSize: number;
  private requestCounter = 0;

  constructor(options: TDTrafficSourceOptions) {
    this.wave = options.wave;
    this.targetEntryPointId = options.targetEntryPointId;
    this.rng = options.rng;
    this.readKeyPoolSize = options.wave.readKeyPoolSize ?? 20;
  }

  generate(tick: number): Request[] {
    if (tick >= this.wave.duration) return [];

    const out: Request[] = [];
    for (let i = 0; i < this.wave.intensity; i++) {
      const type = this.sampleType();
      out.push({
        id: this.nextId(),
        parentId: null,
        type,
        payload: this.makePayload(type),
        origin: this.targetEntryPointId,
        createdAt: tick,
        ttl: this.wave.ttl,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      });
    }
    return out;
  }

  private sampleType(): string {
    // Weighted sample from composition map.
    const entries = [...this.wave.composition.entries()];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.rng() * total;
    for (const [type, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return type;
    }
    return entries[entries.length - 1]![0];
  }

  private makePayload(type: string): string | null {
    if (type === "api_read") {
      const idx = Math.floor(this.rng() * this.readKeyPoolSize);
      return `read-${idx}`;
    }
    // api_write and other types: use a unique counter so the cache never
    // sees a collision on these.
    return `write-${this.requestCounter}`;
  }

  private nextId(): RequestId {
    this.requestCounter += 1;
    return `td-req-${this.requestCounter}` as RequestId;
  }
}

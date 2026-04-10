import type { TrafficSource } from "@core/mode/traffic-source";
import type { Request } from "@core/types/request";
import type { ComponentId, RequestId } from "@core/types/ids";

export interface FixedIntensityConfig {
  targetEntryPointId: ComponentId;
  intensity: number;
  requestType: string;
}

export class FixedIntensityTrafficSource implements TrafficSource {
  readonly targetEntryPointId: ComponentId;
  private readonly intensity: number;
  private readonly requestType: string;
  private counter = 0;

  constructor(cfg: FixedIntensityConfig) {
    this.targetEntryPointId = cfg.targetEntryPointId;
    this.intensity = cfg.intensity;
    this.requestType = cfg.requestType;
  }

  generate(tick: number): Request[] {
    const out: Request[] = [];
    for (let i = 0; i < this.intensity; i++) {
      this.counter += 1;
      out.push({
        id: `fixed-r-${this.counter}` as RequestId,
        parentId: null,
        type: this.requestType,
        payload: null,
        origin: this.targetEntryPointId,
        createdAt: tick,
        ttl: 10,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      });
    }
    return out;
  }
}

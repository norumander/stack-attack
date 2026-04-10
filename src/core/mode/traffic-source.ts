import type { ComponentId } from "../types/ids.js";
import type { Request } from "../types/request.js";

export interface TrafficSource {
  readonly targetEntryPointId: ComponentId | null;
  generate(tick: number): Request[];
  getSubSources?(): readonly TrafficSource[];
}

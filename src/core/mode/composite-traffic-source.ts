import type { Request } from "../types/request.js";
import type { TrafficSource } from "./traffic-source.js";

export class CompositeTrafficSource implements TrafficSource {
  readonly targetEntryPointId: null = null;
  private readonly sources: readonly TrafficSource[];

  constructor(sources: readonly TrafficSource[]) {
    this.sources = sources;
  }

  generate(tick: number): Request[] {
    const out: Request[] = [];
    for (const src of this.sources) {
      for (const r of src.generate(tick)) out.push(r);
    }
    return out;
  }

  getSubSources(): readonly TrafficSource[] {
    return this.sources;
  }
}

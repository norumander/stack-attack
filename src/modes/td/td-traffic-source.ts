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
 * Generates requests for a TD wave.
 *
 * **One type per tick.** Every request generated in a given tick shares
 * the same `type`. The wave's `composition` distribution is realized
 * across ticks, not within a single tick — a 30-tick wave with
 * {api_read: 0.7, api_write: 0.3} produces ~21 reads-only ticks and ~9
 * writes-only ticks, shuffled. Prior behavior was per-request sampling
 * which produced mixed batches every tick; the renderer was then
 * forced to draw multiple dot types simultaneously on the same
 * connection, which read as visual noise. Single-type ticks make each
 * dot unambiguously represent "this tick is a wave of reads" or
 * "this tick is a wave of writes."
 *
 * Also assigns cacheable request types (api_read, static_asset) a payload
 * key drawn from a small pool (`wave.keyPoolSize`) so CachingCapability sees
 * a realistic working set and produces a meaningful hit rate. Non-cacheable
 * types get unique-per-request payloads.
 */
export class TDTrafficSource implements TrafficSource {
  // TrafficSource interface requires readonly public.
  readonly targetEntryPointId: ComponentId;
  private readonly wave: TDWaveDefinition;
  private readonly rng: () => number;
  private readonly keyPoolSize: number;
  /**
   * Pre-computed one-type-per-tick schedule. `typeSchedule[i]` is the
   * type all requests generated in the i-th generate() call will use.
   * Length == wave.duration. Built once in the constructor; stable
   * across subsequent generate() calls.
   */
  private readonly typeSchedule: readonly string[];
  private requestCounter = 0;
  private ticksGenerated = 0;

  constructor(options: TDTrafficSourceOptions) {
    this.wave = options.wave;
    this.targetEntryPointId = options.targetEntryPointId;
    this.rng = options.rng;
    this.keyPoolSize = options.wave.keyPoolSize ?? 20;
    this.typeSchedule = buildTypeSchedule(options.wave, options.rng);
  }

  isExhausted(): boolean {
    return this.ticksGenerated >= this.wave.duration;
  }

  generate(tick: number): Request[] {
    if (this.ticksGenerated >= this.wave.duration) return [];
    const tickType =
      this.typeSchedule[this.ticksGenerated] ?? this.fallbackType();
    this.ticksGenerated += 1;

    const out: Request[] = [];
    for (let i = 0; i < this.wave.intensity; i++) {
      out.push({
        id: this.nextId(),
        parentId: null,
        type: tickType,
        payload: this.makePayload(tickType),
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

  private fallbackType(): string {
    // Defensive: if typeSchedule is short (shouldn't happen — it's
    // sized to wave.duration in the constructor), return the first
    // composition entry.
    const first = [...this.wave.composition.keys()][0];
    return first ?? "api_read";
  }

  private makePayload(type: string): string | null {
    // Cacheable types draw from a bounded pool so the CachingCapability can
    // produce a meaningful hit rate. Non-cacheable types (writes, auth) get
    // unique-per-request ids so they can't accidentally collide on a cached
    // entry if someone extends CACHEABLE_TYPES in the future.
    if (type === "api_read" || type === "static_asset") {
      const idx = Math.floor(this.rng() * this.keyPoolSize);
      return `${type}-${idx}`;
    }
    return `${type}-${this.requestCounter}`;
  }

  private nextId(): RequestId {
    this.requestCounter += 1;
    return `td-req-${this.requestCounter}` as RequestId;
  }
}

/**
 * Build a deterministic, stratified, shuffled schedule of tick types.
 *
 * Counts per type come from rounding `weight / totalWeight * duration`
 * to integers via largest-remainder rounding (guarantees the counts
 * sum to exactly `duration`). The counts are then expanded into a
 * flat array and Fisher-Yates shuffled with the provided RNG so the
 * schedule is stable across runs (same seed -> same schedule) but
 * not clustered (all reads then all writes).
 *
 * Exported for test purposes only.
 */
export function buildTypeSchedule(
  wave: TDWaveDefinition,
  rng: () => number,
): string[] {
  const duration = wave.duration;
  if (duration <= 0) return [];

  const entries = [...wave.composition.entries()];
  if (entries.length === 0) return Array<string>(duration).fill("api_read");

  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight <= 0) {
    return Array<string>(duration).fill(entries[0]![0]);
  }

  // Largest-remainder rounding: assign each type its integer floor of
  // (weight / totalWeight * duration), then distribute the remainder
  // to the highest fractional parts so counts sum to exactly duration.
  const allocations = entries.map(([type, weight]) => {
    const exact = (weight / totalWeight) * duration;
    const floor = Math.floor(exact);
    return { type, floor, frac: exact - floor };
  });

  let assigned = allocations.reduce((s, a) => s + a.floor, 0);
  const byFrac = [...allocations].sort((a, b) => b.frac - a.frac);
  let idx = 0;
  while (assigned < duration) {
    byFrac[idx % byFrac.length]!.floor += 1;
    assigned += 1;
    idx += 1;
  }

  const schedule: string[] = [];
  for (const a of allocations) {
    for (let i = 0; i < a.floor; i++) schedule.push(a.type);
  }

  // Fisher-Yates shuffle in place.
  for (let i = schedule.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = schedule[i]!;
    schedule[i] = schedule[j]!;
    schedule[j] = tmp;
  }

  return schedule;
}

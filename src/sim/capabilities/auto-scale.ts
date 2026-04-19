import type { ArrivalContext, Outcome, Packet, SimCapability, StepContext } from "../types";
import type { SimComponent } from "../component";

export type AutoScaleEvent = { kind: "scaled"; componentId: string; newTier: number; simTime: number };
export type AutoScaleListener = (ev: AutoScaleEvent) => void;

export type AutoScaleCapabilityOptions = {
  /** Utilization threshold above which time accumulates toward a bump. */
  readonly threshold?: number;
  /** Seconds of sustained above-threshold utilization needed to bump. */
  readonly sustainSeconds?: number;
  /** Seconds of cooldown after a bump before another can accumulate. */
  readonly cooldownSeconds?: number;
  /** Seconds of history used to compute windowed utilization. Smooths the
   * spiky instantaneous "available credits" signal under sparse arrivals. */
  readonly windowSeconds?: number;
};

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_SUSTAIN = 2;
const DEFAULT_COOLDOWN = 5;
const DEFAULT_WINDOW = 1;

/**
 * Second capability attached to a component. Samples utilization each sim
 * step via `onStep` and bumps the parent component's tier after utilization
 * stays above `threshold` for `sustainSeconds` of sim time. A cooldown gate
 * prevents consecutive bumps within `cooldownSeconds`.
 *
 * The parent reference is resolved via `onStep`'s `parent` argument rather
 * than captured at construction — keeps capabilities value-type and lets the
 * sim be the single source of truth about ownership.
 *
 * Utilization is derived from the component's CapacityBucket:
 *   1 - bucket.available() / bucket.capacity()
 * Components without a bucket are skipped (nothing to scale).
 */
export class AutoScaleCapability implements SimCapability {
  readonly id = "auto-scale";

  private readonly threshold: number;
  private readonly sustainSeconds: number;
  private readonly cooldownSeconds: number;
  private readonly windowSeconds: number;

  private sustainedTime = 0;
  private cooldownRemaining = 0;
  /** Rolling window of per-step consumption samples. Each entry captures the
   * tokens consumed during a sim step along with the step's duration so the
   * window length in seconds can be computed exactly (variable dt). */
  private readonly window: { dt: number; consumed: number }[] = [];
  private windowTime = 0;
  private windowConsumed = 0;
  private readonly listeners: Set<AutoScaleListener> = new Set();

  constructor(opts: AutoScaleCapabilityOptions = {}) {
    this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    this.sustainSeconds = opts.sustainSeconds ?? DEFAULT_SUSTAIN;
    this.cooldownSeconds = opts.cooldownSeconds ?? DEFAULT_COOLDOWN;
    this.windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW;
  }

  /** AutoScale never receives request arrivals directly — the component's
   * first capability handles forward traffic. If invoked, it no-ops with
   * drop(0) so it can't accidentally terminate a packet. */
  onArriveRequest(packet: Packet, _ctx: ArrivalContext): Outcome {
    return { kind: "drop", reason: "auto_scale_not_arrival_path", count: packet.requests.length };
  }

  onStep(ctx: StepContext, parent: SimComponent): void {
    const bucket = parent.bucket;
    if (!bucket) return;
    const cap = bucket.capacity();
    if (cap <= 0) return;

    // Record this step's consumption in the rolling window. We always record
    // — even during cooldown — so the signal remains accurate across gates.
    const consumed = bucket.getConsumedThisStep();
    this.window.push({ dt: ctx.dt, consumed });
    this.windowTime += ctx.dt;
    this.windowConsumed += consumed;
    // Evict samples older than windowSeconds. Keep at least one so a single
    // oversized dt doesn't starve the average.
    while (this.window.length > 1 && this.windowTime - this.window[0]!.dt >= this.windowSeconds) {
      const evicted = this.window.shift()!;
      this.windowTime -= evicted.dt;
      this.windowConsumed -= evicted.consumed;
    }

    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - ctx.dt);
      // During cooldown, reset sustained counter so the next bump requires a
      // fresh sustain window.
      this.sustainedTime = 0;
      return;
    }

    // Windowed utilization = tokens consumed over the window ÷ tokens that
    // *could* have been consumed over the same window at current capacity.
    const windowSpan = Math.max(this.windowTime, ctx.dt);
    const utilization = this.windowConsumed / (windowSpan * cap);
    if (utilization > this.threshold) {
      this.sustainedTime += ctx.dt;
    } else {
      this.sustainedTime = 0;
    }
    if (this.sustainedTime >= this.sustainSeconds) {
      const bumped = parent.bumpTier();
      this.sustainedTime = 0;
      if (bumped) {
        this.cooldownRemaining = this.cooldownSeconds;
        const ev: AutoScaleEvent = {
          kind: "scaled",
          componentId: parent.id,
          newTier: parent.tier,
          simTime: ctx.simTime,
        };
        for (const l of this.listeners) l(ev);
      }
    }
  }

  /** Test-only: consumption rate over the current window (tokens/sec). */
  _windowConsumedRate(): number {
    return this.windowTime > 0 ? this.windowConsumed / this.windowTime : 0;
  }

  /** Subscribe to "scaled" events emitted after each successful tier bump. */
  on(listener: AutoScaleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Test-only introspection.
  _sustainedTime(): number { return this.sustainedTime; }
  _cooldownRemaining(): number { return this.cooldownRemaining; }
}

/**
 * Attach an AutoScaleCapability to an existing component. Idempotent: a
 * component already carrying an AutoScaleCapability is left alone.
 *
 * Parent reference: the capability does NOT capture `component` here; it
 * receives the parent via `onStep`'s second arg, resolved by the sim. This
 * avoids circular ownership and keeps capability construction cheap.
 */
export function enableAutoScale(
  component: SimComponent,
  opts: AutoScaleCapabilityOptions = {},
): AutoScaleCapability {
  const existing = component.capabilities.find((c) => c.id === "auto-scale");
  if (existing) return existing as AutoScaleCapability;
  const cap = new AutoScaleCapability(opts);
  component.capabilities.push(cap);
  return cap;
}

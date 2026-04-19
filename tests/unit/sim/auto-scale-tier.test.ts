import { describe, it, expect } from "vitest";
import { SimComponent, MAX_TIER } from "@sim/component";
import { ProcessingCapability } from "@sim/capabilities/processing";
import {
  AutoScaleCapability,
  enableAutoScale,
  type AutoScaleEvent,
} from "@sim/capabilities/auto-scale";
import type { ComponentId } from "@core/types/ids";
import type { StepContext } from "@sim/types";

function makeComp(capacityPerSecond = 10): SimComponent {
  return new SimComponent({
    id: "c" as ComponentId,
    capabilities: [
      new ProcessingCapability({ revenuePerWrite: 1, revenuePerRead: 1 }),
    ],
    capacityPerSecond,
  });
}

/**
 * Step order mirrors `Sim.step()`: refill first, then the caller's `consume`
 * callback runs (representing arrivals), then capabilities see the step.
 * This ordering matters now that AutoScale reads consumedThisStep — if refill
 * runs *after* consume the consumption record is wiped before onStep sees it.
 */
function tick(
  cap: AutoScaleCapability,
  comp: SimComponent,
  dt: number,
  simTime: number,
  consume?: () => void,
): void {
  comp.refillBucket(dt);
  consume?.();
  const ctx: StepContext = { dt, simTime };
  cap.onStep!(ctx, comp);
}

describe("SimComponent tier", () => {
  it("defaults tier to 1 and getEffectiveCapacity returns base × tier", () => {
    const c = makeComp(30);
    expect(c.tier).toBe(1);
    expect(c.getEffectiveCapacity()).toBe(30);
  });

  it("bumpTier scales effective capacity and resizes the bucket", () => {
    const c = makeComp(10);
    expect(c.bumpTier()).toBe(true);
    expect(c.tier).toBe(2);
    expect(c.getEffectiveCapacity()).toBe(20);
    expect(c.bucket!.capacity()).toBe(20);
  });

  it("bumpTier caps at MAX_TIER and returns false at the ceiling", () => {
    const c = makeComp(10);
    for (let i = 1; i < MAX_TIER; i++) expect(c.bumpTier()).toBe(true);
    expect(c.tier).toBe(MAX_TIER);
    expect(c.bumpTier()).toBe(false);
    expect(c.tier).toBe(MAX_TIER);
  });
});

describe("AutoScaleCapability", () => {
  it("enableAutoScale appends a second capability and is idempotent", () => {
    const c = makeComp();
    const a = enableAutoScale(c);
    expect(c.capabilities).toHaveLength(2);
    expect(c.capabilities[1]).toBe(a);
    const b = enableAutoScale(c);
    expect(c.capabilities).toHaveLength(2);
    expect(b).toBe(a);
  });

  it("does not bump when utilization stays under threshold", () => {
    const c = makeComp(10);
    const a = enableAutoScale(c);
    // 30 steps of 0.1s each = 3s sim time. Consume 0.1 tokens/step
    // → 1 token/sec on a 10/s bucket → windowed util ≈ 0.1, well below 0.8.
    for (let i = 0; i < 30; i++) {
      tick(a, c, 0.1, i * 0.1, () => {
        c.bucket!.tryConsume(0.1);
      });
    }
    expect(c.tier).toBe(1);
  });

  it("bumps exactly once after ~2s of saturation", () => {
    const c = makeComp(10);
    const events: AutoScaleEvent[] = [];
    const a = enableAutoScale(c);
    a.on((ev) => events.push(ev));
    // Saturate every tick for 3s to let the 1s window ramp up and the 2s
    // sustain window accumulate. One bump, then cooldown suppresses more.
    for (let i = 0; i < 30; i++) {
      tick(a, c, 0.1, i * 0.1, () => {
        c.bucket!.tryConsume(c.bucket!.available()); // drain fully
      });
    }
    expect(c.tier).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "scaled", newTier: 2 });
  });

  it("bumps again after cooldown expires under sustained load", () => {
    const c = makeComp(10);
    const events: AutoScaleEvent[] = [];
    const a = enableAutoScale(c);
    a.on((ev) => events.push(ev));
    // ~15s saturated. With a 1s window ramp + 2s sustain + 5s cooldown, expect
    // at least two bumps within the run.
    for (let i = 0; i < 150; i++) {
      tick(a, c, 0.1, i * 0.1, () => {
        c.bucket!.tryConsume(c.bucket!.available());
      });
    }
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(c.tier).toBeGreaterThanOrEqual(3);
  });

  it("stops bumping once MAX_TIER is reached", () => {
    const c = makeComp(10);
    const events: AutoScaleEvent[] = [];
    const a = enableAutoScale(c);
    a.on((ev) => events.push(ev));
    // Run for a very long saturated time — enough for far more than MAX_TIER bumps.
    for (let i = 0; i < 1000; i++) {
      tick(a, c, 0.1, i * 0.1, () => {
        c.bucket!.tryConsume(c.bucket!.available());
      });
    }
    expect(c.tier).toBe(MAX_TIER);
    expect(events.length).toBe(MAX_TIER - 1);
    expect(c.getEffectiveCapacity()).toBe(10 * MAX_TIER);
  });

  it("smooths sparse arrivals: windowed util stays stable, never falsely trips", () => {
    // Sparse but consistent: 1 packet every 0.2s on a 10/s bucket.
    // Instantaneous util spikes to 0.1 then drops to 0 as the bucket refills —
    // would never cross 0.8. The windowed average is a true rate of
    // (1 token / 0.2s) / 10 = 0.05 → safely under threshold and never trips.
    const c = makeComp(10);
    const events: AutoScaleEvent[] = [];
    const a = enableAutoScale(c);
    a.on((ev) => events.push(ev));
    const dt = 0.1;
    for (let i = 0; i < 100; i++) {
      tick(a, c, dt, i * dt, () => {
        // Send a packet every other tick.
        if (i % 2 === 0) c.bucket!.tryConsume(1);
      });
    }
    expect(c.tier).toBe(1);
    expect(events).toHaveLength(0);
    // Windowed consumption rate ≈ 5 tokens/sec (util ≈ 0.5) — stable.
    expect(a._windowConsumedRate()).toBeGreaterThan(4);
    expect(a._windowConsumedRate()).toBeLessThan(6);
  });

  it("triggers when windowed utilization stays >0.8 for 2s (arrivals below instantaneous saturation)", () => {
    // Consume 0.9/step on 10/s bucket with dt=0.1 → 9 tokens/sec → util 0.9.
    // Bucket available dips only slightly each tick (instant sample ~0.09),
    // but the windowed rate correctly reads 0.9 → crosses threshold.
    const c = makeComp(10);
    const events: AutoScaleEvent[] = [];
    const a = enableAutoScale(c);
    a.on((ev) => events.push(ev));
    const dt = 0.1;
    for (let i = 0; i < 40; i++) {
      tick(a, c, dt, i * dt, () => {
        c.bucket!.tryConsume(0.9);
      });
    }
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(c.tier).toBeGreaterThanOrEqual(2);
  });

  it("is skipped on components without a bucket (no crash, no bump)", () => {
    const c = new SimComponent({
      id: "nobucket" as ComponentId,
      capabilities: [],
      // no capacityPerSecond → no bucket
    });
    const a = enableAutoScale(c);
    for (let i = 0; i < 50; i++) tick(a, c, 0.1, i * 0.1);
    expect(c.tier).toBe(1);
  });
});

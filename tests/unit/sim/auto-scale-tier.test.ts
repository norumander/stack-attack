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

function tick(cap: AutoScaleCapability, comp: SimComponent, dt: number, simTime: number): void {
  comp.refillBucket(dt);
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
    // 10 steps of 0.1s each — consume only 10% of bucket capacity per tick.
    for (let i = 0; i < 30; i++) {
      c.bucket!.tryConsume(1); // 10% util
      tick(a, c, 0.1, i * 0.1);
    }
    expect(c.tier).toBe(1);
  });

  it("bumps exactly once after ~2s of saturation", () => {
    const c = makeComp(10);
    const events: AutoScaleEvent[] = [];
    const a = enableAutoScale(c);
    a.on((ev) => events.push(ev));
    // Saturate every tick for 2.5s; expect one bump (the 2nd second crosses
    // sustainSeconds=2, then cooldown=5s prevents a second bump).
    for (let i = 0; i < 25; i++) {
      c.bucket!.tryConsume(c.bucket!.available()); // drain fully → util = 1
      tick(a, c, 0.1, i * 0.1);
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
    // 10 seconds saturated. Bumps should fire at ~2s and then after
    // cooldown (5s) + another sustain window (2s) ≈ 9s → exactly two bumps.
    for (let i = 0; i < 100; i++) {
      c.bucket!.tryConsume(c.bucket!.available());
      tick(a, c, 0.1, i * 0.1);
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
      c.bucket!.tryConsume(c.bucket!.available());
      tick(a, c, 0.1, i * 0.1);
    }
    expect(c.tier).toBe(MAX_TIER);
    expect(events.length).toBe(MAX_TIER - 1);
    expect(c.getEffectiveCapacity()).toBe(10 * MAX_TIER);
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

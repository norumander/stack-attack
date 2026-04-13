import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import {
  TestForwardingCapability,
  TestQueueCapability,
} from "@harness/test-capabilities";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

describe("integration — TTL expiry for buffered requests", () => {
  it("times out requests stuck in a TestQueueCapability buffer past their TTL", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // Upstream: entry point. Forwards traffic into the bottleneck.
    const upstreamCap = new TestForwardingCapability("cap-up" as CapabilityId);
    const upstream = makeComponent({
      id: "upstream",
      ports: [makePort("p-up-out", "egress")],
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-up" as CapabilityId, upstreamCap],
      ]),
      tiers: new Map([["cap-up" as CapabilityId, 1]]),
    });

    // Bottleneck: holds the EngineBufferable buffer plus a TestForwardingCapability.
    // It has a self-loop egress (cx-bn-self) whose bandwidth is 0. When the
    // engine re-emits buffered items from reEmitQueued, they get tagged with
    // sourceComponentId=bottleneck and deliverStaged picks the bottleneck's
    // egress — which is the self-loop with bw=0, so every retry re-buffers the
    // item in bottleneck's own TestQueueCapability. That traps tick-0 requests
    // long enough for checkTTL's bufferable partition scan to expire them.
    const bottleneckBufCap = new TestQueueCapability("cap-bn-buf" as CapabilityId, 256);
    const bottleneckFwdCap = new TestForwardingCapability("cap-bn-fwd" as CapabilityId);
    const bottleneck = makeComponent({
      id: "bottleneck",
      ports: [
        makePort("p-bn-in", "ingress"),
        makePort("p-bn-loop-in", "ingress"),
        makePort("p-bn-out", "egress"),
      ],
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-bn-buf" as CapabilityId, bottleneckBufCap],
        ["cap-bn-fwd" as CapabilityId, bottleneckFwdCap],
      ]),
      tiers: new Map([
        ["cap-bn-buf" as CapabilityId, 1],
        ["cap-bn-fwd" as CapabilityId, 1],
      ]),
    });

    state.placeComponent(upstream);
    state.placeComponent(bottleneck);

    // upstream → bottleneck: wide so everything lands at bottleneck's pending.
    state.addConnection(
      makeConnection(
        "cx-up-bn",
        { componentId: "upstream", portId: "p-up-out" },
        { componentId: "bottleneck", portId: "p-bn-in" },
        { bandwidth: 100, latency: 1 },
      ),
    );
    // bottleneck self-loop: bandwidth=0 so every FORWARD from bottleneck gets
    // backpressured into bottleneck's own EngineBufferable buffer.
    state.addConnection(
      makeConnection(
        "cx-bn-self",
        { componentId: "bottleneck", portId: "p-bn-out" },
        { componentId: "bottleneck", portId: "p-bn-loop-in" },
        { bandwidth: 0, latency: 1 },
      ),
    );

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: "upstream" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });

    // FixedIntensityTrafficSource hardcodes ttl=10. Requests born on tick T
    // expire once currentTick > T + ttl (i.e. at tick T+10 + carryover).
    // Run 11 ticks so tick-0 requests are inspected past their TTL.
    const TICKS = 11;
    expect(() => {
      for (let i = 0; i < TICKS; i++) engine.tick(mc);
    }).not.toThrow();

    // Metrics history recorded one snapshot per tick.
    expect(state.metricsHistory.length).toBe(TICKS);

    // At least one request timed out. With bandwidth=0 from upstream→bottleneck
    // and intensity=2 per tick, every forward gets backpressured into the
    // TestQueueCapability buffer — the earliest entries sit there long enough
    // to exceed ttl=10 and are expired by checkTTL's bufferable partition scan.
    let timedOutCount = 0;
    for (const events of state.requestLog.values()) {
      if (events.some((e) => e.type === "TIMED_OUT")) timedOutCount += 1;
    }
    expect(timedOutCount).toBeGreaterThan(0);

    // Any request that timed out must not also be RESPONDED (sanity — no dual terminal).
    for (const [id, events] of state.requestLog.entries()) {
      const timedOut = events.some((e) => e.type === "TIMED_OUT");
      const responded = events.some((e) => e.type === "RESPONDED");
      expect(timedOut && responded, `request ${id as string} has both TIMED_OUT and RESPONDED`).toBe(false);
    }
  });
});

import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import {
  ForwardingCapability,
  RespondingCapability,
  TestQueueCapability,
} from "@harness/test-capabilities";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

describe("integration — backpressure re-drive across ticks", () => {
  it("drains all 3 requests through a bandwidth-1 bottleneck with queue buffering", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const upstreamCap = new ForwardingCapability("cap-up" as CapabilityId);
    const upstream = makeComponent({
      id: "c-upstream",
      ports: [makePort("p-up-out", "egress")],
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-up" as CapabilityId, upstreamCap],
      ]),
      tiers: new Map([["cap-up" as CapabilityId, 1]]),
    });

    const queueBufferCap = new TestQueueCapability("cap-queue-buf" as CapabilityId, 64);
    const queueForwardCap = new ForwardingCapability("cap-queue-fwd" as CapabilityId);
    const queue = makeComponent({
      id: "c-queue",
      ports: [makePort("p-q-in", "ingress"), makePort("p-q-out", "egress")],
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-queue-buf" as CapabilityId, queueBufferCap],
        ["cap-queue-fwd" as CapabilityId, queueForwardCap],
      ]),
      tiers: new Map([
        ["cap-queue-buf" as CapabilityId, 1],
        ["cap-queue-fwd" as CapabilityId, 1],
      ]),
    });

    const finalCap = new RespondingCapability("cap-final" as CapabilityId);
    const final = makeComponent({
      id: "c-final",
      ports: [makePort("p-f-in", "ingress")],
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-final" as CapabilityId, finalCap],
      ]),
      tiers: new Map([["cap-final" as CapabilityId, 1]]),
    });

    state.placeComponent(upstream);
    state.placeComponent(queue);
    state.placeComponent(final);

    // Bandwidth-1 upstream → queue bottleneck; normal queue → final.
    state.addConnection(
      makeConnection(
        "cx1",
        { componentId: "c-upstream", portId: "p-up-out" },
        { componentId: "c-queue", portId: "p-q-in" },
        { bandwidth: 1, latency: 1 },
      ),
    );
    state.addConnection(
      makeConnection(
        "cx2",
        { componentId: "c-queue", portId: "p-q-out" },
        { componentId: "c-final", portId: "p-f-in" },
        { bandwidth: 100, latency: 1 },
      ),
    );

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: "c-upstream" as ComponentId,
      intensity: 0,
      requestType: "api_read",
    });

    // Inject 3 requests into upstream's pending manually.
    const reqIds = ["r-1", "r-2", "r-3"] as const;
    for (const id of reqIds) {
      const req: Request = {
        id: id as RequestId,
        parentId: null,
        type: "api_read",
        payload: null,
        origin: "c-upstream" as ComponentId,
        createdAt: 0,
        ttl: 100,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      };
      state.requestLog.set(req.id, []);
      state.enqueuePending(upstream.id, req);
    }

    // --- TICK 1 ---
    // Upstream processes all 3 → 3 FORWARD outcomes → only 1 fits cx1 (bw 1).
    // Other 2 are backpressured into the queue's TestQueueCapability buffer.
    engine.tick(mc);

    // After tick 1, at least 2 BACKPRESSURED events should have fired.
    const backpressuredCount = reqIds.reduce((sum, id) => {
      const evs = state.requestLog.get(id as RequestId)!;
      return sum + evs.filter((e) => e.type === "BACKPRESSURED").length;
    }, 0);
    expect(backpressuredCount).toBe(2);

    // The one that got through cx1 should have already landed at Final and resolved
    // (since cx2 has bandwidth 100 and the final responds immediately in the same tick).
    const respondedAfterTick1 = reqIds.filter((id) =>
      state.requestLog.get(id as RequestId)!.some((e) => e.type === "RESPONDED"),
    );
    expect(respondedAfterTick1).toHaveLength(1);

    // --- TICK 2 ---
    // Step 2 reEmitQueued drains the queue's awaitingDelivery (2 entries) into
    // state.stagedOutcomes. Fixed-point re-delivers them via cx2 (bandwidth 100).
    // Both land at Final; both resolve.
    engine.tick(mc);

    // All 3 requests now have a RESPONDED event.
    for (const id of reqIds) {
      const evs = state.requestLog.get(id as RequestId)!;
      expect(evs.some((e) => e.type === "RESPONDED")).toBe(true);
    }

    // Queue buffer is empty.
    expect(queueBufferCap.emitReady().awaitingDelivery).toHaveLength(0);

    // All pending queues empty.
    expect(state.pending.get(upstream.id)).toHaveLength(0);
    expect(state.pending.get(queue.id)).toHaveLength(0);
    expect(state.pending.get(final.id)).toHaveLength(0);
  });
});

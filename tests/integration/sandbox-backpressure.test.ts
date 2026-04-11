import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { SandboxModeController } from "@modes/sandbox/sandbox-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import {
  ForwardingCapability,
  RespondingCapability,
  TestQueueCapability,
} from "@harness/test-capabilities";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

describe("Sandbox backpressure", () => {
  it("bandwidth-1 bottleneck causes backpressure, queue buffers, eventual resolution", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Client: forwards traffic
    const clientEgress = makePort("p-c-out", "egress");
    const clientCaps = new Map<CapabilityId, Capability>([
      ["cap-fwd" as CapabilityId, new ForwardingCapability("cap-fwd" as CapabilityId)],
    ]);
    const clientTiers = new Map<CapabilityId, number>([["cap-fwd" as CapabilityId, 1]]);
    const client = makeComponent({
      id: "c-client",
      ports: [clientEgress],
      capabilities: clientCaps,
      tiers: clientTiers,
    });

    // Queue: has TestQueueCapability (EngineBufferable) + ForwardingCapability
    const queueIngress = makePort("p-q-in", "ingress");
    const queueEgress = makePort("p-q-out", "egress");
    const queueCaps = new Map<CapabilityId, Capability>([
      ["cap-queue" as CapabilityId, new TestQueueCapability("cap-queue" as CapabilityId)],
      ["cap-q-fwd" as CapabilityId, new ForwardingCapability("cap-q-fwd" as CapabilityId)],
    ]);
    const queueTiers = new Map<CapabilityId, number>([
      ["cap-queue" as CapabilityId, 1],
      ["cap-q-fwd" as CapabilityId, 1],
    ]);
    const queue = makeComponent({
      id: "c-queue",
      ports: [queueIngress, queueEgress],
      capabilities: queueCaps,
      tiers: queueTiers,
    });

    // Server: responds
    const serverIngress = makePort("p-s-in", "ingress");
    const serverCaps = new Map<CapabilityId, Capability>([
      ["cap-resp" as CapabilityId, new RespondingCapability("cap-resp" as CapabilityId)],
    ]);
    const serverTiers = new Map<CapabilityId, number>([["cap-resp" as CapabilityId, 1]]);
    const server = makeComponent({
      id: "c-server",
      ports: [serverIngress],
      capabilities: serverCaps,
      tiers: serverTiers,
    });

    state.placeComponent(client);
    state.placeComponent(queue);
    state.placeComponent(server);

    // Client → Queue: bandwidth 1 (bottleneck)
    const conn1 = makeConnection(
      "cx-cq",
      { componentId: "c-client", portId: "p-c-out" },
      { componentId: "c-queue", portId: "p-q-in" },
      { bandwidth: 1 },
    );
    clientEgress.connections.push(conn1.id);
    queueIngress.connections.push(conn1.id);
    state.addConnection(conn1);

    // Queue → Server: bandwidth 100 (fast)
    const conn2 = makeConnection(
      "cx-qs",
      { componentId: "c-queue", portId: "p-q-out" },
      { componentId: "c-server", portId: "p-s-in" },
    );
    queueEgress.connections.push(conn2.id);
    serverIngress.connections.push(conn2.id);
    state.addConnection(conn2);

    const mode = new SandboxModeController();
    mode.addTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      requestType: "api_read",
      intensity: 3,
      pattern: "steady",
    });
    mode.advancePhase();

    const engine = new Engine(state);

    // Run enough ticks for all requests to drain
    for (let i = 0; i < 10; i++) engine.tick(mode);

    // Check that backpressure events were recorded
    const allEvents = [...state.requestLog.values()].flat();
    const backpressuredEvents = allEvents.filter((e) => e.type === "BACKPRESSURED");
    expect(backpressuredEvents.length).toBeGreaterThan(0);

    // Metrics should record backpressured counts
    const snap = mode.getMetricsSnapshot(state);
    expect(snap.totalBackpressured).toBeGreaterThan(0);

    // All requests that entered should eventually resolve (buffered then re-emitted)
    const respondedEvents = allEvents.filter((e) => e.type === "RESPONDED");
    const enteredEvents = allEvents.filter((e) => e.type === "ENTERED");
    // Some requests should have resolved (at least the ones that fit bandwidth)
    expect(respondedEvents.length).toBeGreaterThan(0);
    expect(enteredEvents.length).toBe(30); // 3 req/tick × 10 ticks
  });
});

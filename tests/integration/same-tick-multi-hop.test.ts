/**
 * Integration test: same-tick multi-hop
 *
 * Topology: Client --cx1--> LB --cx2--> Server  [blocking SPAWN]  DB
 *                                                                   |
 *                                               Server <---unblock--+
 *                                               Server --RESPOND--> Client
 *
 * - Client: TestForwardingCapability  (FORWARDs to LB)
 * - LB:     TestForwardingCapability  (FORWARDs to Server)
 * - Server: BlockingDbCapability  (first pass: blocking SPAWN to DB; re-entry: RESPOND)
 * - DB:     RespondingCapability  (RESPONDs to child, triggering Server unblock)
 *
 * The entire round-trip must complete within a single engine tick.
 */

import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import {
  TestForwardingCapability,
  RespondingCapability,
  BlockingDbCapability,
} from "@harness/test-capabilities";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

describe("integration — same-tick multi-hop (Client → LB → Server → DB → Server → Client)", () => {
  it("resolves a request through the full topology in exactly one tick", () => {
    // ------------------------------------------------------------------ setup
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // Client — forwards everything to LB.
    const clientCap = new TestForwardingCapability("cap-client" as CapabilityId);
    const client = makeComponent({
      id: "c-client",
      ports: [makePort("p-c-out", "egress")],
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-client" as CapabilityId, clientCap],
      ]),
      tiers: new Map([["cap-client" as CapabilityId, 1]]),
    });

    // LB — forwards everything to Server.
    const lbCap = new TestForwardingCapability("cap-lb" as CapabilityId);
    const lb = makeComponent({
      id: "c-lb",
      ports: [makePort("p-lb-in", "ingress"), makePort("p-lb-out", "egress")],
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-lb" as CapabilityId, lbCap],
      ]),
      tiers: new Map([["cap-lb" as CapabilityId, 1]]),
    });

    // Server — issues a blocking SPAWN to DB on first pass; RESPONDs on re-entry.
    const serverCap = new BlockingDbCapability(
      "cap-server" as CapabilityId,
      "c-db" as ComponentId,
    );
    const server = makeComponent({
      id: "c-server",
      ports: [makePort("p-s-in", "ingress")],
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-server" as CapabilityId, serverCap],
      ]),
      tiers: new Map([["cap-server" as CapabilityId, 1]]),
    });

    // DB — immediately RESPONDs to the child, triggering the Server unblock.
    // No port or connection needed — children arrive via blocking-SPAWN side effect.
    const dbCap = new RespondingCapability("cap-db" as CapabilityId);
    const db = makeComponent({
      id: "c-db",
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-db" as CapabilityId, dbCap],
      ]),
      tiers: new Map([["cap-db" as CapabilityId, 1]]),
    });

    state.placeComponent(client);
    state.placeComponent(lb);
    state.placeComponent(server);
    state.placeComponent(db);

    // cx1: Client → LB  (latency 3)
    // cx2: LB → Server  (latency 5)
    // No connection for Server → DB: children are teleported via SPAWN side effect.
    const cx1 = makeConnection(
      "cx1",
      { componentId: "c-client", portId: "p-c-out" },
      { componentId: "c-lb", portId: "p-lb-in" },
      { bandwidth: 100, latency: 3 },
    );
    const cx2 = makeConnection(
      "cx2",
      { componentId: "c-lb", portId: "p-lb-out" },
      { componentId: "c-server", portId: "p-s-in" },
      { bandwidth: 100, latency: 5 },
    );
    state.addConnection(cx1);
    state.addConnection(cx2);

    // ------------------------------------------------------------------ engine
    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 0, // we inject the request manually below
      requestType: "api_read",
    });

    // ------------------------------------------------------------------ inject parent request manually
    // (skips injectTraffic so we control the exact request id)
    const parentReq: Request = {
      id: "r-parent" as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: "c-client" as ComponentId,
      createdAt: 0,
      ttl: 100,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
    state.requestLog.set(parentReq.id, []);
    state.enqueuePending("c-client" as ComponentId, parentReq);

    // ------------------------------------------------------------------ tick
    engine.tick(mc);

    // ------------------------------------------------------------------ assertions on the parent
    const parentEvents = state.requestLog.get(parentReq.id);
    expect(parentEvents).toBeDefined();
    const parentEventTypes = (parentEvents ?? []).map((e) => e.type);

    // Two TRAVERSED events: Client→LB and LB→Server.
    expect(parentEventTypes.filter((t) => t === "TRAVERSED")).toHaveLength(2);

    // The parent was blocked on a child (SPAWNED_SUB) and resumed (CHILD_RESOLVED).
    expect(parentEventTypes).toContain("SPAWNED_SUB");
    expect(parentEventTypes).toContain("CHILD_RESOLVED");

    // Terminal event: RESPONDED, emitted exactly once.
    const respondedEvents = (parentEvents ?? []).filter((e) => e.type === "RESPONDED");
    expect(respondedEvents).toHaveLength(1);

    // Latency: forward path = cx1.latency + cx2.latency = 3 + 5 = 8
    //          return path  = cx2.latency + cx1.latency = 5 + 3 = 8
    const respondedMeta = respondedEvents[0]!.metadata as {
      forwardLatency?: number;
      returnLatency?: number;
    };
    expect(respondedMeta.forwardLatency).toBe(8);
    expect(respondedMeta.returnLatency).toBe(8);

    // ------------------------------------------------------------------ assertions on the child
    const spawnedSubEvent = (parentEvents ?? []).find((e) => e.type === "SPAWNED_SUB");
    expect(spawnedSubEvent).toBeDefined();
    const childId = (spawnedSubEvent!.metadata as { childId: RequestId }).childId;

    const childEvents = state.requestLog.get(childId);
    expect(childEvents).toBeDefined();
    const childEventTypes = (childEvents ?? []).map((e) => e.type);

    // The DB child resolved successfully.
    expect(childEventTypes).toContain("RESPONDED");

    // ------------------------------------------------------------------ state cleanup assertions
    // Parent is no longer blocked.
    expect(state.blockedParents.has(parentReq.id)).toBe(false);

    // All pending queues are drained.
    const emptyOrMissing = (id: ComponentId) => {
      const q = state.pending.get(id);
      return q === undefined || q.length === 0;
    };
    expect(emptyOrMissing("c-client" as ComponentId)).toBe(true);
    expect(emptyOrMissing("c-lb" as ComponentId)).toBe(true);
    expect(emptyOrMissing("c-server" as ComponentId)).toBe(true);
    expect(emptyOrMissing("c-db" as ComponentId)).toBe(true);

    // Exactly one tick has elapsed.
    expect(state.currentTick).toBe(1);
  });
});

/**
 * Stage 3c regression: silent-PASS drops are now visible DROP events.
 *
 * Before: when no PROCESS capability matched `canHandle(request.type)`, or
 * the matching cap explicitly returned PASS, `Component.process` returned
 * `{kind: "PASS"}`, which `deliverStaged` handled via `default: return false`
 * — silently vanishing the request with no event and no counter increment.
 *
 * After: the component converts trailing-PASS outcomes to
 * `{kind: "DROP", reason: "no_handler"}`, so the request emits a DROPPED
 * event at the component and increments `perComponentThisTick.drops`. This
 * makes the renderer's red flash fire, diagnose-wave's bottleneck picker
 * find the offender, and wave metrics account for the failure.
 */
import { describe, it, expect } from "vitest";
import { Component } from "@core/component/component";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { makeComponent, makeConnection, makePort } from "@harness/fixtures";
import { computeVisitOrder } from "@core/engine/visit-order";
import type { Capability } from "@core/capability/capability";
import type {
  CapabilityId,
  ComponentId,
  RequestId,
  ConnectionId,
  PortId,
} from "@core/types/ids";
import type { Request } from "@core/types/request";

function forwardingOnly(id: string): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({
      outcome: { kind: "FORWARD" },
      sideEffects: [],
      events: [],
    }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

function readsOnly(id: string): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: (t) => t === "api_read",
    process: () => ({
      outcome: { kind: "RESPOND" },
      sideEffects: [],
      events: [],
    }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

function makeReq(id: string, type: string, origin: ComponentId): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type,
    payload: null,
    origin,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("no-handler DROP (Stage 3c silent-PASS fix)", () => {
  it("emits a DROPPED event at the component when no PROCESS cap matches canHandle", () => {
    const state = new SimulationState({
      zones: [],
      pairLatency: new Map(),
    });

    // Client has a forwarder; target has a read-only cap. Send a WRITE request.
    const clientCaps = new Map<CapabilityId, Capability>();
    clientCaps.set("fwd" as CapabilityId, forwardingOnly("fwd"));
    const client = makeComponent({
      id: "client",
      type: "client",
      ports: [makePort("out", "egress"), makePort("in", "ingress")],
      capabilities: clientCaps,
      tiers: new Map([["fwd" as CapabilityId, 1]]),
    });

    const targetCaps = new Map<CapabilityId, Capability>();
    targetCaps.set("ro" as CapabilityId, readsOnly("ro"));
    const target = makeComponent({
      id: "target",
      type: "server",
      ports: [makePort("in", "ingress")],
      capabilities: targetCaps,
      tiers: new Map([["ro" as CapabilityId, 1]]),
    });

    state.placeComponent(client);
    state.placeComponent(target);
    state.addConnection(
      makeConnection(
        "c1",
        { componentId: "client" as ComponentId, portId: "out" as PortId },
        { componentId: "target" as ComponentId, portId: "in" as PortId },
      ),
    );
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeReq("r1", "api_write", client.id);
    state.requestLog.set(req.id, []);
    state.enqueuePending(client.id, req);

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: client.id,
      intensity: 0,
      requestType: "api_write",
    });

    // Tick once to forward client → target.
    engine.tick(mc);
    // Tick again so target processes the forwarded request.
    engine.tick(mc);

    const events = state.requestLog.get(req.id) ?? [];
    const eventTypes = events.map((e) => e.type);

    expect(eventTypes).toContain("DROPPED");
    const dropped = events.find((e) => e.type === "DROPPED");
    expect(dropped?.componentId).toBe(target.id);
    const meta = dropped?.metadata as { reason?: string } | undefined;
    expect(meta?.reason).toBe("no_handler");
  });

  it("increments the component's drops counter so metrics see the failure", () => {
    const state = new SimulationState({
      zones: [],
      pairLatency: new Map(),
    });

    const targetCaps = new Map<CapabilityId, Capability>();
    targetCaps.set("ro" as CapabilityId, readsOnly("ro"));
    const target = makeComponent({
      id: "target",
      type: "server",
      ports: [makePort("in", "ingress")],
      capabilities: targetCaps,
      tiers: new Map([["ro" as CapabilityId, 1]]),
    });
    state.placeComponent(target);
    state.visitOrder.push(...computeVisitOrder(state.components));

    // Enqueue a write directly; target's only cap rejects it.
    const req = makeReq("r1", "api_write", target.id);
    state.requestLog.set(req.id, []);
    state.enqueuePending(target.id, req);

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: target.id,
      intensity: 0,
      requestType: "api_write",
    });
    engine.tick(mc);

    const lastTickMetrics =
      state.metricsHistory[state.metricsHistory.length - 1]!;
    const pc = lastTickMetrics.perComponent.get(target.id);
    expect(pc?.dropped).toBe(1);
  });

  it("leaves write-routing pipelines untouched (reads PASS, writes FORWARD)", () => {
    // Regression guard: the Server pattern from Stage 3a (Processing for
    // reads-only + Forwarding for writes) must still work. The Processing
    // cap rejects writes via canHandle, so PROCESS loop moves on — it
    // DOES find the Forwarding cap (canHandle=true), which FORWARDs.
    // The trailing-PASS fallback must NOT kick in when a matching cap
    // found a handler.
    const state = new SimulationState({
      zones: [],
      pairLatency: new Map(),
    });

    const serverCaps = new Map<CapabilityId, Capability>();
    serverCaps.set("reads" as CapabilityId, readsOnly("reads"));
    serverCaps.set("fwd" as CapabilityId, {
      id: "fwd" as CapabilityId,
      phase: "PROCESS",
      canHandle: (t) => t === "api_write",
      process: () => ({
        outcome: { kind: "FORWARD" },
        sideEffects: [],
        events: [],
      }),
      getUpkeepCost: () => 0,
      getStats: () => ({}),
    });
    const server = makeComponent({
      id: "server",
      type: "server",
      ports: [makePort("in", "ingress"), makePort("out", "egress")],
      capabilities: serverCaps,
      tiers: new Map([
        ["reads" as CapabilityId, 1],
        ["fwd" as CapabilityId, 1],
      ]),
    });

    const dbCaps = new Map<CapabilityId, Capability>();
    dbCaps.set("storage" as CapabilityId, {
      id: "storage" as CapabilityId,
      phase: "PROCESS",
      canHandle: (t) => t === "api_write",
      process: () => ({
        outcome: { kind: "RESPOND" },
        sideEffects: [],
        events: [],
      }),
      getUpkeepCost: () => 0,
      getStats: () => ({}),
    });
    const db = makeComponent({
      id: "db",
      type: "database",
      ports: [makePort("in", "ingress")],
      capabilities: dbCaps,
      tiers: new Map([["storage" as CapabilityId, 1]]),
    });

    state.placeComponent(server);
    state.placeComponent(db);
    state.addConnection(
      makeConnection(
        "c1" as unknown as string,
        { componentId: "server" as ComponentId, portId: "out" as PortId },
        { componentId: "db" as ComponentId, portId: "in" as PortId },
      ),
    );
    state.visitOrder.push(...computeVisitOrder(state.components));

    const req = makeReq("r1", "api_write", server.id);
    state.requestLog.set(req.id, []);
    state.enqueuePending(server.id, req);

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: server.id,
      intensity: 0,
      requestType: "api_write",
    });
    engine.tick(mc);
    engine.tick(mc);

    const events = state.requestLog.get(req.id) ?? [];
    const types = events.map((e) => e.type);
    expect(types).toContain("FORWARDED");
    // And no false-positive DROP.
    const dropped = events.find(
      (e) =>
        e.type === "DROPPED" &&
        (e.metadata as { reason?: string } | undefined)?.reason === "no_handler",
    );
    expect(dropped).toBeUndefined();
  });
});

// Silence unused-import warnings.
void (null as unknown as ConnectionId);

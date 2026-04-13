import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state.js";
import { Engine } from "@core/engine/engine.js";
import { NoOpModeController } from "@harness/noop-mode-controller.js";
import { makeComponent, makeConnection, makePort } from "@harness/fixtures.js";
import {
  TestForwardingCapability,
  RespondingCapability,
} from "@harness/test-capabilities.js";
import type {
  ComponentId,
  RequestId,
  CapabilityId,
} from "@core/types/ids.js";
import type { Capability } from "@core/capability/capability.js";

describe("FORWARDED events carry metadata.requestType", () => {
  it("engine target-side FORWARDED has metadata.requestType from the request", () => {
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const fwdCap = new TestForwardingCapability("fwd" as CapabilityId);
    const fwdCaps = new Map<CapabilityId, Capability>();
    fwdCaps.set(fwdCap.id, fwdCap);
    const source = makeComponent({
      id: "src",
      type: "client",
      capabilities: fwdCaps,
      ports: [makePort("p-out", "egress")],
    });

    const respCap = new RespondingCapability("resp" as CapabilityId);
    const respCaps = new Map<CapabilityId, Capability>();
    respCaps.set(respCap.id, respCap);
    const target = makeComponent({
      id: "tgt",
      type: "server",
      capabilities: respCaps,
      ports: [makePort("p-in", "ingress")],
    });

    state.placeComponent(source);
    state.placeComponent(target);
    state.recomputeVisitOrder();
    const conn = makeConnection(
      "c1",
      { componentId: source.id, portId: "p-out" },
      { componentId: target.id, portId: "p-in" },
    );
    state.addConnection(conn);

    state.requestLog.set("r1" as RequestId, []);
    state.enqueuePending(source.id, {
      id: "r1" as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: source.id,
      createdAt: 0,
      ttl: 10,
      originZone: "default",
      streamDuration: null,
      streamBandwidth: null,
    });

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: source.id,
      intensity: 0,
      requestType: "api_read",
    });
    engine.tick(mc);

    const forwardedEvents = state.lastTickEvents.filter((e) => e.type === "FORWARDED");
    expect(forwardedEvents.length).toBeGreaterThan(0);
    for (const ev of forwardedEvents) {
      expect(ev.metadata).toBeDefined();
      expect((ev.metadata as { requestType?: string }).requestType).toBe("api_read");
    }
  });
});

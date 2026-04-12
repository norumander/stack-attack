import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import {
  ForwardingCapability,
  RespondingCapability,
} from "@harness/test-capabilities";
import { RoutingCapability } from "@capabilities/routing/routing-capability";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

describe("condition-aware routing end-to-end", () => {
  it("T3 routing shifts traffic away from degraded targets", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const routingCap = new RoutingCapability("routing" as CapabilityId);
    const fwdCap = new ForwardingCapability("fwd" as CapabilityId);

    const routerCaps = new Map<CapabilityId, Capability>();
    routerCaps.set("routing" as CapabilityId, routingCap);
    routerCaps.set("fwd" as CapabilityId, fwdCap);

    const routerTiers = new Map<CapabilityId, number>();
    routerTiers.set("routing" as CapabilityId, 3);
    routerTiers.set("fwd" as CapabilityId, 1);

    const router = makeComponent({
      id: "router",
      capabilities: routerCaps,
      tiers: routerTiers,
      ports: [makePort("out", "egress")],
    });

    const targetACaps = new Map<CapabilityId, Capability>();
    targetACaps.set(
      "resp" as CapabilityId,
      new RespondingCapability("resp" as CapabilityId),
    );
    const targetA = makeComponent({
      id: "targetA",
      capabilities: targetACaps,
      ports: [makePort("in", "ingress")],
    });

    const targetBCaps = new Map<CapabilityId, Capability>();
    targetBCaps.set(
      "resp2" as CapabilityId,
      new RespondingCapability("resp2" as CapabilityId),
    );
    const targetB = makeComponent({
      id: "targetB",
      capabilities: targetBCaps,
      ports: [makePort("in", "ingress")],
    });

    state.placeComponent(router);
    state.placeComponent(targetA);
    state.placeComponent(targetB);

    // Only outbound connections from router — traffic is injected directly
    // into router's pending queue by NoOpModeController's traffic source.
    state.addConnection(
      makeConnection(
        "c-to-a",
        { componentId: "router", portId: "out" },
        { componentId: "targetA", portId: "in" },
        { bandwidth: 100 },
      ),
    );
    state.addConnection(
      makeConnection(
        "c-to-b",
        { componentId: "router", portId: "out" },
        { componentId: "targetB", portId: "in" },
        { bandwidth: 100 },
      ),
    );

    // Degrade targetA; targetB stays healthy (condition = 1.0)
    targetA.condition = 0.1;

    const mc = new NoOpModeController({
      targetEntryPointId: "router" as ComponentId,
      intensity: 5,
      requestType: "api_read",
    });

    const engine = new Engine(state);
    engine.tick(mc);

    // Count FORWARDED events arriving at each target. In deliver-staged,
    // a FORWARDED event's componentId is the *target* of the connection.
    let forwardedToA = 0;
    let forwardedToB = 0;
    for (const log of state.requestLog.values()) {
      for (const ev of log) {
        if (ev.type === "FORWARDED") {
          if (ev.componentId === ("targetA" as ComponentId)) forwardedToA++;
          if (ev.componentId === ("targetB" as ComponentId)) forwardedToB++;
        }
      }
    }

    // T3 condition-weighted scoring picks targetB (condition 1.0) over
    // targetA (condition 0.1) every time, so all 5 requests land on B.
    expect(forwardedToB).toBeGreaterThan(forwardedToA);
    expect(forwardedToA).toBe(0);
    expect(forwardedToB).toBe(5);
  });
});

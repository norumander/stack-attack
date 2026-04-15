import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { makePort } from "@harness/fixtures";
import { bootTDRegistry } from "@harness/td-fixtures";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { Capability } from "@core/capability/capability";
import type { ConditionProfile } from "@core/types/condition";
import { WAVE_5 } from "@modes/td/td-waves";
import {
  runWave,
  buildServer,
  buildDatabase,
  buildCache,
  buildCDN,
  buildAPIGateway,
  buildLoadBalancer,
  wire,
} from "./helpers";

const DEFAULT_CONDITION: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.05,
  recoveryRate: 0.02,
  degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
  criticalEffects: [{ kind: "drop_probability", p: 0.2 }],
};

function buildClient(): Component {
  const out = makePort("client-out", "egress");
  const forwarding = new ForwardingCapability("forwarding-pipe" as CapabilityId, {
    handledTypes: ["api_read", "api_write", "static_asset", "auth_required"],
    throughputPerTier: 200,
    emitForwardedEvent: true,
  });
  const monitoring = new MonitoringCapability("monitoring" as CapabilityId);
  const capabilities = new Map<CapabilityId, Capability>([
    ["forwarding-pipe" as CapabilityId, forwarding],
    ["monitoring" as CapabilityId, monitoring],
  ]);
  return new Component({
    id: "client" as ComponentId,
    type: "client",
    name: "Client",
    description: "",
    capabilities,
    initialTiers: new Map([
      ["forwarding-pipe" as CapabilityId, 1],
      ["monitoring" as CapabilityId, 1],
    ]),
    ports: [out],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: DEFAULT_CONDITION,
  });
}

describe("Wave 5 — gateway + scale rescue wins", () => {
  it("Client → CDN → Gateway → Cache → LB → [Server×2] → DB wins", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const client = buildClient();
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const cache = buildCache(compRegistry);
    const lb = buildLoadBalancer("lb", 2);
    const server1 = buildServer(compRegistry);
    const server2 = buildServer(compRegistry);
    const database = buildDatabase(compRegistry);

    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(cache.component);
    state.placeComponent(lb.component);
    state.placeComponent(server1.component);
    state.placeComponent(server2.component);
    state.placeComponent(database.component);

    // Wave 5 injects 150 req/tick — connections must carry at least that
    // much or the link itself becomes the bottleneck. Default bandwidth is
    // 100 (sufficient for Wave 1-4). Here we lift every link to 200 so the
    // connection bandwidth never gates the topology stress test.
    const hi = { bandwidth: 200 };

    wire(
      state,
      { component: client, egressPortId: "client-out" },
      { component: cdn.component, ingressPortId: cdn.ingressPortId },
      "c-client-cdn",
      hi,
    );
    wire(
      state,
      { component: cdn.component, egressPortId: cdn.egressPortId },
      { component: gateway.component, ingressPortId: gateway.ingressPortId },
      "c-cdn-gw",
      hi,
    );
    wire(
      state,
      { component: gateway.component, egressPortId: gateway.egressPortId },
      { component: cache.component, ingressPortId: cache.ingressPortId },
      "c-gw-cache",
      hi,
    );
    wire(
      state,
      { component: cache.component, egressPortId: cache.egressPortId },
      { component: lb.component, ingressPortId: lb.ingressPortId },
      "c-cache-lb",
      hi,
    );
    // LB has 2 egress ports — wire each to a different server
    wire(
      state,
      { component: lb.component, egressPortId: lb.egressPortIds[0]! },
      { component: server1.component, ingressPortId: server1.ingressPortId },
      "c-lb-s1",
      hi,
    );
    wire(
      state,
      { component: lb.component, egressPortId: lb.egressPortIds[1]! },
      { component: server2.component, ingressPortId: server2.ingressPortId },
      "c-lb-s2",
      hi,
    );
    wire(
      state,
      { component: server1.component, egressPortId: server1.egressPortId },
      { component: database.component, ingressPortId: database.ingressPortId },
      "c-s1-db",
      hi,
    );
    wire(
      state,
      { component: server2.component, egressPortId: server2.egressPortId },
      { component: database.component, ingressPortId: database.ingressPortId },
      "c-s2-db",
      hi,
    );

    const result = runWave(state, WAVE_5, "client" as ComponentId);

    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);

    // Prove the Gateway terminates auth_required — the Gateway's AuthCapability
    // saw all the auth_required requests (20% of 150/tick × 30 ticks ≈ 900).
    // authProcessedTotal is the cumulative counter (never reset per tick);
    // authProcessed resets each tick and is always 0 after the wave run.
    const gatewayAuth = gateway.component.capabilities.get(
      "auth" as CapabilityId,
    ) as any;
    expect(gatewayAuth.getStats().authProcessedTotal).toBeGreaterThan(0);
  });
});

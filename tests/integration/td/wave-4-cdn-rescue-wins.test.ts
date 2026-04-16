import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { ForwardingCapability } from "@capabilities/forwarding/forwarding-capability";
import { MonitoringCapability } from "@capabilities/monitoring/monitoring-capability";
import { CachingCapability } from "@capabilities/caching/caching-capability";
import { makePort } from "@harness/fixtures";
import { bootTDRegistry } from "@harness/td-fixtures";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { Capability } from "@core/capability/capability";
import type { ConditionProfile } from "@core/types/condition";
import { WAVE_4 } from "@modes/td/td-waves";
import { runWave, buildServer, buildDatabase, buildCDN, buildDataCache, wire } from "./helpers";

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
    handledTypes: ["api_read", "api_write", "static_asset"],
    throughputPerTier: 100,
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

describe("Wave 4 — CDN rescue wins", () => {
  it("Client → CDN → Server → Data Cache → Database wins and CDN absorbs static_asset", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    const client = buildClient();
    const cdn = buildCDN(compRegistry);
    const server = buildServer(compRegistry);
    const dataCache = buildDataCache(compRegistry);
    const database = buildDatabase(compRegistry);

    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(server.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(database.component);

    // Client → CDN
    wire(
      state,
      { component: client, egressPortId: "client-out" },
      { component: cdn.component, ingressPortId: cdn.ingressPortId },
      "c-client-cdn",
    );
    // CDN → Server
    wire(
      state,
      { component: cdn.component, egressPortId: cdn.egressPortId },
      { component: server.component, ingressPortId: server.ingressPortId },
      "c-cdn-server",
    );
    // Server → Data Cache
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "c-server-dc",
    );
    // Data Cache → Database
    wire(
      state,
      { component: dataCache.component, egressPortId: dataCache.egressPortId },
      { component: database.component, ingressPortId: database.ingressPortId },
      "c-dc-database",
    );

    const result = runWave(state, WAVE_4, "client" as ComponentId);

    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);

    // CDN must absorb static_asset via caching (caching-static variant)
    const cdnCaching = cdn.component.capabilities.get(
      "caching-static" as CapabilityId,
    ) as CachingCapability;
    const stats = cdnCaching.getStats();
    expect(stats.hitRateByType).toBeDefined();
    const staticStats = stats.hitRateByType!["static_asset"];
    expect(staticStats).toBeDefined();
    expect(staticStats!.hitRate).toBeGreaterThanOrEqual(0.3);
  });
});

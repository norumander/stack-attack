import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";
import { WAVE_7 } from "@modes/td/td-waves";
import { runWave, buildServer, buildDatabase, buildCache, buildCDN, buildAPIGateway, buildLoadBalancer, wire } from "./helpers";

describe("Wave 7 — no Circuit Breaker loses", () => {
  it("Wave 6 topology without Circuit Breaker fails when chaos hits", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Build Wave 5-style topology (no Queue/Worker for simplicity — the test is about chaos)
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
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

    const clientEgress = client.ports.find(p => p.direction === "egress")!;
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 600 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 600 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", { bandwidth: 600 });
    wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-cache-lb", { bandwidth: 600 });
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: server1.component, ingressPortId: server1.ingressPortId }, "c-lb-s1", { bandwidth: 600 });
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: server2.component, ingressPortId: server2.ingressPortId }, "c-lb-s2", { bandwidth: 600 });
    wire(state, { component: server1.component, egressPortId: server1.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, "c-s1-db", { bandwidth: 600 });
    wire(state, { component: server2.component, egressPortId: server2.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, "c-s2-db", { bandwidth: 600 });

    const result = runWave(state, WAVE_7, client.id);

    // Without Circuit Breaker, chaos-induced server failure cascades → SLA fails
    expect(result.outcome.verdict).toBe("lose");
  });
});

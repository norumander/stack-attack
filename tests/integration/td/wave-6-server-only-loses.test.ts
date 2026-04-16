import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";
import { WAVE_6 } from "@modes/td/td-waves";
import { runWave, buildServer, buildDatabase, buildDataCache, buildCDN, buildAPIGateway, buildLoadBalancer, wire } from "./helpers";

describe("Wave 6 — server-only loses", () => {
  it("Wave 5 rescue topology without Queue/Worker fails on batch traffic", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Build the Wave 5 rescue topology: Client → CDN → Gateway → LB → Server×2 → Data Cache → DB
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const lb = buildLoadBalancer("lb", 2);
    const server1 = buildServer(compRegistry);
    const server2 = buildServer(compRegistry);
    const dataCache = buildDataCache(compRegistry);
    const database = buildDatabase(compRegistry);

    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(lb.component);
    state.placeComponent(server1.component);
    state.placeComponent(server2.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 500 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 500 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-gw-lb", { bandwidth: 500 });
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: server1.component, ingressPortId: server1.ingressPortId }, "c-lb-s1", { bandwidth: 500 });
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[1]! }, { component: server2.component, ingressPortId: server2.ingressPortId }, "c-lb-s2", { bandwidth: 500 });
    wire(state, { component: server1.component, egressPortId: server1.egressPortId }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, "c-s1-dc", { bandwidth: 500 });
    wire(state, { component: server2.component, egressPortId: server2.egressPortId }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, "c-s2-dc", { bandwidth: 500 });
    wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, "c-dc-db", { bandwidth: 500 });

    const result = runWave(state, WAVE_6, client.id);

    // Without Queue+Worker, batch requests overwhelm Servers → SLA fails
    expect(result.outcome.verdict).toBe("lose");
    // TODO(T16): tune viability to actually fire on this lose path
    // viability stays at 100 even though SLA verdict is "lose" — migrate once tuned:
    // expect(result.finalViability).toBeLessThan(100);
  });
});

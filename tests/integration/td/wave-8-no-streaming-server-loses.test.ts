import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_8 } from "@modes/td/td-waves";
import {
  runWave, buildServer, buildDatabase, buildDataCache, buildCDN, buildAPIGateway,
  buildLoadBalancer, buildQueue, buildCircuitBreaker, buildWorker, wire,
} from "./helpers";

describe("Wave 8 — no streaming isolation loses", () => {
  it("Wave 7 rescue topology without streaming isolation fails on stream-heavy traffic", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Wave 7 rescue topology (no streaming components, post Data Cache redesign):
    //   Client → CDN → Gateway → Queue → Worker → LB → CB → [Server×5] → Data Cache → DB
    //
    // Why it loses: Wave 8 injects 500 req/tick with 30% stream traffic (150 stream/tick).
    // Servers don't handle "stream" type (handledTypes: api_read, static_asset, auth_required).
    // Stream requests reaching Servers get PASS'd → eventually timeout/drop.
    // Stream bandwidth reservation (3 bandwidth/tick × many streams) on shared connections
    // starves API traffic, cascading failures across the board.

    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const queue = buildQueue(compRegistry);
    const worker = buildWorker(compRegistry);
    const serverCount = 5;
    const lb = buildLoadBalancer("lb", serverCount);
    const cb = buildCircuitBreaker(compRegistry);

    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry));
    const dataCache = buildDataCache(compRegistry);
    const database = buildDatabase(compRegistry);

    // Place all components
    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(queue.component);
    state.placeComponent(worker.component);
    state.placeComponent(lb.component);
    state.placeComponent(cb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;

    // Client → CDN → Gateway → Queue → Worker → LB
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 700 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 700 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-gw-queue", { bandwidth: 700 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-queue-worker", { bandwidth: 700 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-worker-lb", { bandwidth: 700 });

    // LB egress[0] → CB → Server[0], LB egress[1..N] → Server[1..N]
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: cb.component, ingressPortId: cb.ingressPortId }, "c-lb-cb", { bandwidth: 700 });
    wire(state, { component: cb.component, egressPortId: cb.egressPortId }, { component: servers[0]!.component, ingressPortId: servers[0]!.ingressPortId }, "c-cb-s0", { bandwidth: 700 });
    for (let i = 1; i < serverCount; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 700 });
    }

    // Servers fan in to Data Cache → DB
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, `c-s${i}-dc`, { bandwidth: 700 });
    }
    wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, "c-dc-db", { bandwidth: 700 });

    const result = runWave(state, WAVE_8, client.id);

    // Without streaming isolation, stream traffic overwhelms the topology → SLA fails
    expect(result.outcome.verdict).toBe("lose");
    // TODO(T16): tune viability to actually fire on this lose path
    // viability stays at 100 even though SLA verdict is "lose" — migrate once tuned:
    // expect(result.finalViability).toBeLessThan(100);
  });
});

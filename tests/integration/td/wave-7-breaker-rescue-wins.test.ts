import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import type { CapabilityId } from "@core/types/ids";
import { WAVE_7 } from "@modes/td/td-waves";
import { QueueCapability } from "@capabilities/queue/queue-capability";
import { runWave, buildServer, buildDatabase, buildCache, buildCDN, buildAPIGateway, buildLoadBalancer, buildQueue, buildCircuitBreaker, buildWorker, wire } from "./helpers";

describe("Wave 7 — CircuitBreaker rescue wins", () => {
  it("adding CircuitBreaker to the topology rescues Wave 7 from chaos-induced failure", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Rescue topology:
    //   Client → CDN → Gateway → Cache → Queue → Worker → LB → CB → Server1 (chaos target) → DB
    //                                                          → Server2 → DB
    //                                                          → Server3 → DB
    //                                                          → Server4 → DB
    //                                                          → Server5 → DB
    //
    // CB sits between LB and Server1 to isolate chaos failures on the first server.
    // Server1 must be placed FIRST so resolveTargetByType("server", 0) targets it.
    // 5 servers needed: Wave 7 injects 350/tick (40% more than Wave 6's 250/tick),
    // requiring extra server capacity to maintain 90% availability under chaos.
    // Chaos schedule: tick 15 component_failure server[0], tick 22 component_failure server[0].
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const cache = buildCache(compRegistry);
    const queue = buildQueue(compRegistry);
    const worker = buildWorker(compRegistry);
    const serverCount = 5;
    const lb = buildLoadBalancer("lb", serverCount);
    const cb = buildCircuitBreaker(compRegistry);

    // Build servers — server1 first so chaos targets it
    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry));
    const database = buildDatabase(compRegistry);

    // Place components — server1 must be placed before server2/3 so it is
    // the first "server" type in state.components iteration order.
    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(cache.component);
    state.placeComponent(queue.component);
    state.placeComponent(worker.component);
    state.placeComponent(lb.component);
    state.placeComponent(cb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;

    // Client → CDN → Gateway → Cache → Queue → Worker → LB
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 600 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 600 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", { bandwidth: 600 });
    wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-cache-queue", { bandwidth: 600 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-queue-worker", { bandwidth: 600 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-worker-lb", { bandwidth: 600 });

    // LB egress[0] → CB → Server[0] (chaos target), LB egress[1..N] → Server[1..N]
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: cb.component, ingressPortId: cb.ingressPortId }, "c-lb-cb", { bandwidth: 600 });
    wire(state, { component: cb.component, egressPortId: cb.egressPortId }, { component: servers[0]!.component, ingressPortId: servers[0]!.ingressPortId }, "c-cb-s0", { bandwidth: 600 });
    for (let i = 1; i < serverCount; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 600 });
    }

    // Servers → DB
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, `c-s${i}-db`, { bandwidth: 600 });
    }

    const result = runWave(state, WAVE_7, client.id);

    // 1. SLA passes — wave_passed despite chaos at ticks 15 and 22
    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);

    // 2. Availability SLA passes
    expect(result.outcome.slaResults?.availability.passed).toBe(true);

    // 3. Availability is at least 90%
    expect(result.outcome.slaResults?.availability.actual).toBeGreaterThanOrEqual(0.90);

    // 4. CircuitBreaker diagnostic — prove CB was part of the active topology.
    //    CB's requestsBlocked resets per tick, so it may be 0 after the wave.
    //    Instead, verify that:
    //    (a) CB forwarded traffic (proving it was in the request path), and
    //    (b) the system maintained availability despite chaos targeting server1.
    const cbForwarded = result.forwardedCountByComponent.get(cb.component.id) ?? 0;
    expect(cbForwarded).toBeGreaterThan(0);

    // 5. Queue diagnostic: no overflow drops
    const queueCap = queue.component.capabilities.get("queue" as CapabilityId) as QueueCapability;
    const queueStats = queueCap.getStats();
    expect(queueStats.totalDroppedFull).toBe(0);
  });
});

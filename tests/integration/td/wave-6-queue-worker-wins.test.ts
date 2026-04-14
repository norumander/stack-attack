import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import type { CapabilityId } from "@core/types/ids";
import { WAVE_6 } from "@modes/td/td-waves";
import { QueueCapability } from "@capabilities/queue/queue-capability";
import { runWave, buildServer, buildDatabase, buildCache, buildCDN, buildAPIGateway, buildLoadBalancer, buildQueue, buildWorkerWithForwarding, wire } from "./helpers";

describe("Wave 6 — Queue + Worker rescue wins", () => {
  it("adding Queue + Worker to the topology rescues Wave 6 batch traffic", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Rescue topology:
    //   Client → CDN → Gateway → Cache → Queue → Worker → LB → [Server×3] → DB
    //
    // Queue sits before Worker as the backpressure buffer (EngineBufferable).
    // Worker handles batch requests inline (BatchProcessingCapability → RESPOND)
    // and forwards non-batch traffic onward (ForwardingCapability → FORWARD to LB).
    // LB distributes remaining traffic to Servers for processing.
    // This eliminates the round-robin routing problem: batch traffic is intercepted
    // by Worker before reaching Servers, while non-batch passes through cleanly.
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const cache = buildCache(compRegistry);
    const queue = buildQueue(compRegistry);
    const worker = buildWorkerWithForwarding();
    const serverCount = 3;
    const lb = buildLoadBalancer("lb", serverCount);
    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry));
    const database = buildDatabase(compRegistry);

    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(cache.component);
    state.placeComponent(queue.component);
    state.placeComponent(worker.component);
    state.placeComponent(lb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;

    // Client → CDN → Gateway → Cache → Queue → Worker → LB → Servers → DB
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 500 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 500 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", { bandwidth: 500 });
    wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-cache-queue", { bandwidth: 500 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-queue-worker", { bandwidth: 500 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-worker-lb", { bandwidth: 500 });
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 500 });
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, `c-s${i}-db`, { bandwidth: 500 });
    }

    const result = runWave(state, WAVE_6, client.id);

    // 1. SLA passes — verdict is "win"
    expect(result.outcome.verdict).toBe("win");

    // 2. Availability SLA passes
    expect(result.outcome.slaResults?.availability.passed).toBe(true);

    // 3. Queue diagnostic: Queue forwarded traffic (totalDroppedFull === 0 proves no overflow)
    const queueCap = queue.component.capabilities.get("queue" as CapabilityId) as QueueCapability;
    const queueStats = queueCap.getStats();
    expect(queueStats.totalDroppedFull).toBe(0);

    // 4. Queue diagnostic: Queue was part of the pipeline — it forwarded requests
    const queueForwarded = result.forwardedCountByComponent.get(queue.component.id) ?? 0;
    expect(queueForwarded).toBeGreaterThan(0);

    // 5. Worker diagnostic: Worker forwarded non-batch traffic (proving it processed
    //    the full traffic stream — batch was RESPOND'd, non-batch was FORWARD'd)
    const workerForwarded = result.forwardedCountByComponent.get(worker.component.id) ?? 0;
    expect(workerForwarded).toBeGreaterThan(0);
  });
});

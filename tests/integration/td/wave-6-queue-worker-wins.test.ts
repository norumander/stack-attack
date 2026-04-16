import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import type { CapabilityId } from "@core/types/ids";
import { WAVE_6 } from "@modes/td/td-waves";
import { QueueCapability } from "@capabilities/queue/queue-capability";
import { runWave, buildServer, buildDatabase, buildDataCache, buildCDN, buildAPIGateway, buildLoadBalancer, buildQueue, buildWorker, wire } from "./helpers";

describe("Wave 6 — Queue + Worker rescue wins", () => {
  it("adding Queue + Worker to the topology rescues Wave 6 batch traffic", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Rescue topology:
    //   Client → CDN → Gateway → Worker → Queue → LB → [Server×3] → Data Cache → DB
    //
    // Worker sits UPSTREAM of Queue so batch requests reach Worker first.
    // Worker's BatchProcessingCapability handles batch (RESPOND) — absorbing
    // the 20% batch load before it reaches Servers. Non-batch traffic passes
    // through Worker's forwarding-pipe to Queue, which relays it via its own
    // forwarding-pipe to LB for distribution to Servers.
    //
    // With pull semantics, Queue's INTERCEPT phase holds batch requests
    // (QUEUE_HOLD). Placing Worker upstream avoids the Queue-capacity
    // bottleneck: at tier-cap 1, Queue holds only 32 items while Wave 6
    // generates 50 batch/tick (250 × 20%). Worker processes batch inline
    // before it ever reaches Queue.
    //
    // Post Data Cache redesign: Servers fan in to a shared Data Cache which
    // then flows to DB. Data Cache absorbs repeated api_read before DB.
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const worker = buildWorker(compRegistry);
    const queue = buildQueue(compRegistry);
    const serverCount = 3;
    const lb = buildLoadBalancer("lb", serverCount);
    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry));
    const dataCache = buildDataCache(compRegistry);
    const database = buildDatabase(compRegistry);

    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(worker.component);
    state.placeComponent(queue.component);
    state.placeComponent(lb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;

    // Client → CDN → Gateway → Worker → Queue → LB → Servers → Data Cache → DB
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 500 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 500 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-gw-worker", { bandwidth: 500 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-worker-queue", { bandwidth: 500 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-queue-lb", { bandwidth: 500 });
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 500 });
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, `c-s${i}-dc`, { bandwidth: 500 });
    }
    wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, "c-dc-db", { bandwidth: 500 });

    // Post Data Cache redesign: Wave 6 at 250/tick produces ~62/tick api_read
    // and ~37/tick api_write. Tier-1 Data Cache holds only 10 keys (Wave 6
    // keyPool 15 → ~33% miss), and tier-1 DB caps at 25/tick on both reads
    // and writes. Upgrade Data Cache to tier 2 (cache capacity 50, fits the
    // full 15 keys) and DB to tier 2 (50/tick storage) so the topology can
    // absorb Wave 6 intensity. These upgrades model realistic player choices.
    dataCache.component.upgrade("caching" as CapabilityId, 3);
    database.component.upgrade("storage" as CapabilityId, 3);

    const result = runWave(state, WAVE_6, client.id);

    // 1. SLA passes — wave_passed, verdict is "win"
    expect(result.terminalState).toBe("wave_passed");
    expect(result.finalViability).toBeGreaterThan(0);
    expect(result.outcome.verdict).toBe("win");

    // 2. Availability SLA passes
    expect(result.outcome.slaResults?.availability.passed).toBe(true);

    // 3. Queue diagnostic: no batch overflowed (Worker absorbed batch upstream)
    const queueCap = queue.component.capabilities.get("queue" as CapabilityId) as QueueCapability;
    const queueStats = queueCap.getStats();
    expect(queueStats.totalDroppedFull).toBe(0);

    // 4. Queue diagnostic: Queue was part of the pipeline — it forwarded non-batch requests
    const queueForwarded = result.forwardedCountByComponent.get(queue.component.id) ?? 0;
    expect(queueForwarded).toBeGreaterThan(0);

    // 5. Worker diagnostic: Worker forwarded non-batch traffic (proving it processed
    //    the full traffic stream — batch was RESPOND'd, non-batch was FORWARD'd)
    const workerForwarded = result.forwardedCountByComponent.get(worker.component.id) ?? 0;
    expect(workerForwarded).toBeGreaterThan(0);
  });
});

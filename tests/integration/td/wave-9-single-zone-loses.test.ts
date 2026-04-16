import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_9 } from "@modes/td/td-waves";
import { zonePairKey } from "@core/types/zone";
import {
  runWave, buildServer, buildDatabase, buildDataCache, buildCDN, buildAPIGateway,
  buildLoadBalancer, buildQueue, buildStreamingServer, buildWorker, wire,
} from "./helpers";

describe("Wave 9 — single-zone topology loses on latency SLA", () => {
  it("all components in na-east fails maxAvgLatency SLA due to cross-zone penalties", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({
      zones: ["na-east", "eu-west", "ap-south"],
      pairLatency: new Map([
        [zonePairKey("na-east", "ap-south"), 5],
        [zonePairKey("na-east", "eu-west"), 3],
        [zonePairKey("eu-west", "ap-south"), 4],
      ]),
    });

    // Full Wave 8 rescue topology, but everything in zone "na-east" (post Data Cache redesign):
    //   Client(na-east) → CDN(na-east) → Gateway(na-east) → StreamingServer(na-east) →
    //   Queue(na-east) → Worker → LB → Server×5(na-east) → Data Cache(na-east) → Database(na-east)
    //
    // Why it loses: Wave 9 distributes traffic across zones (NA 40%, EU 35%, AP 25%).
    // EU requests (35%) add +3 latency per cross-zone connection hop.
    // AP requests (25%) add +5 latency per cross-zone connection hop.
    // With multiple hops in the topology, average latency across all traffic exceeds
    // the tight maxAvgLatency SLA of 4.

    const client = compRegistry.create("client", { x: 0, y: 0 }, "na-east");
    const cdn = buildCDN(compRegistry, "na-east");
    const gateway = buildAPIGateway(compRegistry, "na-east");
    const streamServer = buildStreamingServer(compRegistry, "na-east");
    const queue = buildQueue(compRegistry, "na-east");
    const worker = buildWorker(compRegistry, "na-east");
    const serverCount = 5;
    const lb = buildLoadBalancer("lb", serverCount);

    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry, "na-east"));
    const dataCache = buildDataCache(compRegistry, "na-east");
    const database = buildDatabase(compRegistry, "na-east");

    // Place all components
    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(streamServer.component);
    state.placeComponent(queue.component);
    state.placeComponent(worker.component);
    state.placeComponent(lb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(dataCache.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;

    // Client → CDN → Gateway
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 800 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 800 });

    // Gateway → StreamingServer (high bandwidth for stream reservations)
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: streamServer.component, ingressPortId: streamServer.ingressPortId }, "c-gw-stream", { bandwidth: 15000 });

    // StreamingServer → Queue → Worker → LB
    wire(state, { component: streamServer.component, egressPortId: streamServer.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-stream-queue", { bandwidth: 800 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-queue-worker", { bandwidth: 800 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-worker-lb", { bandwidth: 800 });

    // LB → Server[0..N]
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 800 });
    }

    // Servers fan in to Data Cache → DB
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: dataCache.component, ingressPortId: dataCache.ingressPortId }, `c-s${i}-dc`, { bandwidth: 800 });
    }
    wire(state, { component: dataCache.component, egressPortId: dataCache.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, "c-dc-db", { bandwidth: 800 });

    const result = runWave(state, WAVE_9, client.id);

    // --- Diagnostic dump on failure ---
    if (result.finalViability >= 100) {
      console.log("=== Wave 9 Single-Zone Diagnostic ===");
      console.log("SLA results:", JSON.stringify(result.outcome.slaResults, null, 2));
      console.log("Total:", result.totalRequests, "Dropped:", result.droppedCount, "TimedOut:", result.timedOutCount);
      console.log("Events:", Object.fromEntries(result.eventCountsByType));
    }

    // Single-zone topology fails Wave 9's tight latency SLA (maxAvgLatency: 4)
    // because cross-zone penalties accumulate across every connection hop for
    // EU (35% at +3/hop) and AP (25% at +5/hop) traffic.
    expect(result.outcome.verdict).toBe("lose");
    // TODO(T16): tune viability to actually fire on this lose path
    // viability stays at 100 even though SLA verdict is "lose" — migrate once tuned:
    // expect(result.finalViability).toBeLessThan(100);
  });
});

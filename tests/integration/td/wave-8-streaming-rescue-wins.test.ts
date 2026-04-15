import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_8 } from "@modes/td/td-waves";
import {
  runWave, buildServer, buildDatabase, buildCache, buildCDN, buildAPIGateway,
  buildLoadBalancer, buildQueue, buildCircuitBreaker, buildStreamingServer,
  buildWorker, wire,
} from "./helpers";

describe("Wave 8 — streaming isolation rescue wins", () => {
  it("adding Streaming Server + high-bandwidth ingress to isolate stream traffic rescues Wave 8", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Rescue topology (inline filter pattern):
    //   Client → CDN → Gateway → Cache → StreamingServer → Queue → Worker → LB → CB → [Server×5] → DB
    //
    // StreamingServer sits inline between Cache and Queue:
    // - "stream" requests: StreamingCapability (PROCESS) → RESPOND (engine registers
    //   active stream with bandwidth reservation on the last TRAVERSED connection)
    // - all other types: ForwardingCapability (PROCESS) → FORWARD downstream to Queue
    //
    // Tuning decision: the cache→StreamingServer connection needs high bandwidth (15,000)
    // because pickStreamConnection reserves stream bandwidth on the last TRAVERSED
    // connection (the ingress). At peak: up to 150 streams/tick * 20 tick duration *
    // 3 bandwidth/stream = 9,000 bandwidth reserved by active streams, plus ~326
    // non-stream requests/tick traversing the same connection. Standard 700 bandwidth
    // would saturate within a few ticks, causing BACKPRESSURED drops.

    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const cache = buildCache(compRegistry);
    const streamServer = buildStreamingServer(compRegistry);
    const queue = buildQueue(compRegistry);
    const worker = buildWorker(compRegistry);
    const serverCount = 5;
    const lb = buildLoadBalancer("lb", serverCount);
    const cb = buildCircuitBreaker(compRegistry);

    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry));
    const database = buildDatabase(compRegistry);

    // Place all components
    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(cache.component);
    state.placeComponent(streamServer.component);
    state.placeComponent(queue.component);
    state.placeComponent(worker.component);
    state.placeComponent(lb.component);
    state.placeComponent(cb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;

    // Client → CDN → Gateway → Cache
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 700 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 700 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", { bandwidth: 700 });

    // Cache → StreamingServer (high bandwidth to absorb stream bandwidth reservations)
    wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: streamServer.component, ingressPortId: streamServer.ingressPortId }, "c-cache-stream", { bandwidth: 15000 });

    // StreamingServer → Queue → Worker → LB
    wire(state, { component: streamServer.component, egressPortId: streamServer.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-stream-queue", { bandwidth: 700 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-queue-worker", { bandwidth: 700 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-worker-lb", { bandwidth: 700 });

    // LB egress[0] → CB → Server[0], LB egress[1..N] → Server[1..N]
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: cb.component, ingressPortId: cb.ingressPortId }, "c-lb-cb", { bandwidth: 700 });
    wire(state, { component: cb.component, egressPortId: cb.egressPortId }, { component: servers[0]!.component, ingressPortId: servers[0]!.ingressPortId }, "c-cb-s0", { bandwidth: 700 });
    for (let i = 1; i < serverCount; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 700 });
    }

    // Servers → DB
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, `c-s${i}-db`, { bandwidth: 700 });
    }

    const result = runWave(state, WAVE_8, client.id);

    // --- Diagnostic dump on failure ---
    if (result.outcome.verdict !== "win") {
      console.log("=== Wave 8 Rescue Diagnostic ===");
      console.log("SLA results:", JSON.stringify(result.outcome.slaResults, null, 2));
      console.log("Total:", result.totalRequests, "Dropped:", result.droppedCount, "TimedOut:", result.timedOutCount);
      console.log("StreamServer forwarded:", result.forwardedCountByComponent.get(streamServer.component.id) ?? 0);
      console.log("Events:", Object.fromEntries(result.eventCountsByType));
    }

    // 1. SLA passes — verdict is "win"
    expect(result.outcome.verdict).toBe("win");

    // 2. Availability SLA passes (target: 92%)
    expect(result.outcome.slaResults?.availability.passed).toBe(true);

    // 3. Streaming Server forwarded non-stream traffic (proving inline filter works)
    const streamServerForwarded = result.forwardedCountByComponent.get(streamServer.component.id) ?? 0;
    expect(streamServerForwarded).toBeGreaterThan(0);

    // 4. API path still works: servers processed requests downstream
    let totalServerProcessed = 0;
    for (const s of servers) {
      totalServerProcessed += result.processedCountByComponent.get(s.component.id) ?? 0;
    }
    expect(totalServerProcessed).toBeGreaterThan(0);
  });
});

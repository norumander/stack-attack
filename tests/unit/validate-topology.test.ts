import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { validateTopology } from "@modes/td/validate-topology";
import type { ComponentId } from "@core/types/ids";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import {
  buildServer,
  buildDatabase,
  buildDataCache,
  buildCDN,
  buildQueue,
  buildWorker,
  buildLoadBalancer,
  buildAPIGateway,
  buildStreamingServer,
  buildBlobStorage,
  wire,
} from "../../tests/integration/td/helpers";

/** Minimal wave factory for tests. */
function makeWave(composition: Map<string, number>): TDWaveDefinition {
  return {
    id: 99,
    name: "Test",
    startingBudget: 1000,
    intensity: 10,
    composition,
    duration: 5,
    ttl: 10,
    availableComponents: [],
    dropThreshold: 0.05,
    viabilityPerFailure: 0.1,
    viabilityRampPenalty: 0.5,
    revenuePerRequestType: new Map(),
    sla: {
      availabilityTarget: 0.9,
      maxAvgLatency: 10,
      minBudget: 0,
      penaltyPerTick: 5,
    },
  };
}

function makeState(): SimulationState {
  return new SimulationState({ zones: ["default"], pairLatency: new Map() });
}

describe("validateTopology", () => {
  it("valid: Client -> Server -> Database with api_read produces no errors", () => {
    // Post Data Cache redesign: Server FORWARDs api_read downstream, so a lone
    // Server (no DB egress) no longer validates. Add DB terminal.
    const reg = bootTDRegistry();
    const state = makeState();

    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const server = buildServer(reg);
    state.placeComponent(server.component);

    const db = buildDatabase(reg);
    state.placeComponent(db.component);

    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: server.component, ingressPortId: server.ingressPortId },
      "c-client-server",
    );
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "c-server-db",
    );

    const wave = makeWave(new Map([["api_read", 1.0]]));
    const errors = validateTopology(state, wave, client.id);

    expect(errors).toEqual([]);
  });

  it("no handler: Client -> Worker (no egress) with api_read produces error", () => {
    // Post Data Cache redesign: Database handles api_read too (it's a valid
    // terminal for forwarded reads). So pick a component that truly doesn't
    // handle api_read as a standalone terminal: Worker (handles batch only)
    // placed without egress. The validator should flag no_egress or no_handler.
    const reg = bootTDRegistry();
    const state = makeState();

    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const worker = buildWorker(reg);
    state.placeComponent(worker.component);

    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: worker.component, ingressPortId: worker.ingressPortId },
      "c-client-worker",
    );

    const wave = makeWave(new Map([["api_read", 1.0]]));
    const errors = validateTopology(state, wave, client.id);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.requestType).toBe("api_read");
  });

  it("no egress: Client -> LB with no wires out produces error", () => {
    const reg = bootTDRegistry();
    const state = makeState();

    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const lb = buildLoadBalancer("lb-1", 2);
    state.placeComponent(lb.component);

    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: lb.component, ingressPortId: lb.ingressPortId },
      "c-client-lb",
    );

    const wave = makeWave(new Map([["api_read", 1.0]]));
    const errors = validateTopology(state, wave, client.id);

    expect(errors.length).toBeGreaterThan(0);
    // The LB has forwarding but no egress connections
    const lbError = errors.find((e) => e.componentId === lb.component.id);
    expect(lbError).toBeDefined();
    expect(lbError!.reason).toBe("no_egress");
  });

  it("data cache path: Client -> Server -> Data Cache -> Database is valid", () => {
    const reg = bootTDRegistry();
    const state = makeState();

    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const server = buildServer(reg);
    state.placeComponent(server.component);

    const dataCache = buildDataCache(reg);
    state.placeComponent(dataCache.component);

    const db = buildDatabase(reg);
    state.placeComponent(db.component);

    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: server.component, ingressPortId: server.ingressPortId },
      "c-client-server",
    );
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "c-server-dc",
    );
    wire(
      state,
      { component: dataCache.component, egressPortId: dataCache.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "c-dc-db",
    );

    const wave = makeWave(new Map([["api_read", 1.0]]));
    const errors = validateTopology(state, wave, client.id);

    expect(errors).toEqual([]);
  });

  it("worker path: Client -> Worker -> Server -> DB valid for batch + api_read", () => {
    // Post Data Cache redesign: Server FORWARDs api_read downstream, so the
    // Server needs a DB terminal behind it.
    const reg = bootTDRegistry();
    const state = makeState();

    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const worker = buildWorker(reg);
    state.placeComponent(worker.component);

    const server = buildServer(reg);
    state.placeComponent(server.component);

    const db = buildDatabase(reg);
    state.placeComponent(db.component);

    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: worker.component, ingressPortId: worker.ingressPortId },
      "c-client-worker",
    );
    wire(
      state,
      { component: worker.component, egressPortId: worker.egressPortId },
      { component: server.component, ingressPortId: server.ingressPortId },
      "c-worker-server",
    );
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "c-server-db",
    );

    const wave = makeWave(
      new Map([
        ["batch", 0.5],
        ["api_read", 0.5],
      ]),
    );
    const errors = validateTopology(state, wave, client.id);

    expect(errors).toEqual([]);
  });

  it("zero-weight types are skipped", () => {
    const reg = bootTDRegistry();
    const state = makeState();

    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const db = buildDatabase(reg);
    state.placeComponent(db.component);

    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: db.component, ingressPortId: db.ingressPortId },
      "c-client-db",
    );

    // api_read has weight 0 (should be skipped), api_write has weight 1.0
    // Database handles api_write via storage capability
    const wave = makeWave(
      new Map([
        ["api_read", 0.0],
        ["api_write", 1.0],
      ]),
    );
    const errors = validateTopology(state, wave, client.id);

    expect(errors).toEqual([]);
  });

  it("cycle: A -> B -> A does not loop infinitely, returns error", () => {
    const reg = bootTDRegistry();
    const state = makeState();

    // Two forwarding-only nodes wired in a cycle with no terminal
    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const dataCache = buildDataCache(reg);
    state.placeComponent(dataCache.component);

    // Wire client -> data cache -> client (cycle, no terminal)
    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "c-client-dc",
    );
    wire(
      state,
      { component: dataCache.component, egressPortId: dataCache.egressPortId },
      { component: client, ingressPortId: "p-out" }, // client only has egress, but let's use a dummy
      "c-dc-client",
    );

    // api_write is NOT handled by cache's INTERCEPT (caching handles api_read/static_asset),
    // so the forwarding-pipe tries to forward, hits the cycle, and fails.
    // Actually cache's forwarding-pipe handles all types but has PROCESS phase.
    // Cache's caching is INTERCEPT for api_read. For api_write:
    //   - No INTERCEPT handles api_write on cache
    //   - forwarding-pipe PROCESS handles api_write -> forwards to client
    //   - client's forwarding-pipe handles api_write -> forwards to cache (visited) -> false
    // This should detect the cycle and return an error.
    const wave = makeWave(new Map([["api_write", 1.0]]));
    const errors = validateTopology(state, wave, client.id);

    expect(errors.length).toBeGreaterThan(0);
  });

  it("multi-type: Wave 4 composition through proper topology is valid", () => {
    const reg = bootTDRegistry();
    const state = makeState();

    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const cdn = buildCDN(reg);
    state.placeComponent(cdn.component);

    const server = buildServer(reg);
    state.placeComponent(server.component);

    const dataCache = buildDataCache(reg);
    state.placeComponent(dataCache.component);

    const db = buildDatabase(reg);
    state.placeComponent(db.component);

    // Client -> CDN -> Server -> Data Cache -> DB (post Data Cache redesign)
    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: cdn.component, ingressPortId: cdn.ingressPortId },
      "c-client-cdn",
    );
    wire(
      state,
      { component: cdn.component, egressPortId: cdn.egressPortId },
      { component: server.component, ingressPortId: server.ingressPortId },
      "c-cdn-server",
    );
    wire(
      state,
      { component: server.component, egressPortId: server.egressPortId },
      { component: dataCache.component, ingressPortId: dataCache.ingressPortId },
      "c-server-dc",
    );
    wire(
      state,
      { component: dataCache.component, egressPortId: dataCache.egressPortId },
      { component: db.component, ingressPortId: db.ingressPortId },
      "c-dc-db",
    );

    // Wave 4 composition: api_read 0.4, api_write 0.2, static_asset 0.4
    const wave = makeWave(
      new Map([
        ["api_read", 0.4],
        ["api_write", 0.2],
        ["static_asset", 0.4],
      ]),
    );
    const errors = validateTopology(state, wave, client.id);

    expect(errors).toEqual([]);
  });

  it("gateway path: auth_required terminates at API Gateway INTERCEPT", () => {
    const reg = bootTDRegistry();
    const state = makeState();

    const client = reg.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    const gateway = buildAPIGateway(reg);
    state.placeComponent(gateway.component);

    const server = buildServer(reg);
    state.placeComponent(server.component);

    wire(
      state,
      { component: client, egressPortId: "p-out" },
      { component: gateway.component, ingressPortId: gateway.ingressPortId },
      "c-client-gw",
    );
    wire(
      state,
      { component: gateway.component, egressPortId: gateway.egressPortId },
      { component: server.component, ingressPortId: server.ingressPortId },
      "c-gw-server",
    );

    const wave = makeWave(
      new Map([
        ["auth_required", 1.0],
      ]),
    );
    const errors = validateTopology(state, wave, client.id);

    // auth_required is handled by Gateway's auth INTERCEPT (terminateAuthRequired=true)
    // → optimistic terminal → valid
    expect(errors).toEqual([]);
  });

  it("entry point not found returns error", () => {
    const state = makeState();

    const wave = makeWave(new Map([["api_read", 1.0]]));
    const errors = validateTopology(
      state,
      wave,
      "nonexistent" as ComponentId,
    );

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.requestType).toBe("api_read");
  });
});

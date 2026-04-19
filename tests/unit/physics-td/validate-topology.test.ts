import { describe, it, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimClient } from "@sim/client";
import { SimConnection } from "@sim/connection";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { CachingCapability } from "@sim/capabilities/caching";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
import { QueueCapability } from "@sim/capabilities/queue";
import { WorkerCapability } from "@sim/capabilities/worker";
import { BlobStorageCapability } from "@sim/capabilities/blob-storage";
import { CircuitBreakerCapability } from "@sim/capabilities/circuit-breaker";
import { validateTopology } from "../../../src/physics-td/validate-topology";
import type { WaveDef, WaveComposition } from "@sim/wave";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

const CLIENT_ID = "client" as ComponentId;

function makeWave(overrides: Partial<WaveComposition> = {}): WaveDef {
  const composition: WaveComposition = {
    writeRatio: 0,
    authRatio: 0,
    streamRatio: 0,
    largeRatio: 0,
    asyncRatio: 0,
    ...overrides,
  };
  return {
    intensity: 1,
    packetRate: 1,
    duration: 10,
    composition,
    keyDistribution: { kind: "uniform", spaceSize: 100 },
    revenue: { perRead: 1, perWrite: 1, perAuth: 1, perStream: 1, perAsync: 1 },
    entryClients: [CLIENT_ID],
  };
}

function addClient(sim: Sim): void {
  const c = new SimClient({
    id: CLIENT_ID,
    capabilities: [],
    packetRate: 1,
  });
  sim.addClient(c);
}

function connect(sim: Sim, from: ComponentId, to: ComponentId, idx: number): void {
  const fwdId = `e${idx}f` as ConnectionId;
  const backId = `e${idx}b` as ConnectionId;
  sim.addConnection(new SimConnection({
    id: fwdId,
    from: { componentId: from, portId: "out" as PortId },
    to: { componentId: to, portId: "in" as PortId },
    bandwidth: 100, latencySeconds: 1 / 60, twinId: backId, direction: "forward",
  }));
  sim.addConnection(new SimConnection({
    id: backId,
    from: { componentId: to, portId: "out" as PortId },
    to: { componentId: from, portId: "in" as PortId },
    bandwidth: 100, latencySeconds: 1 / 60, twinId: fwdId, direction: "back",
  }));
}

function makeServer(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new ForwardingCapability()],
  });
}
function makeDB(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new ProcessingCapability({ revenuePerWrite: 1, revenuePerRead: 1 })],
    capacityPerSecond: 30,
  });
}
function makeCache(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new CachingCapability({ capacity: 16, revenuePerRead: 1 })],
  });
}
function makeLB(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new LoadBalancerCapability()],
  });
}
function makeQueue(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new QueueCapability({ capacity: 64 })],
  });
}
function makeWorker(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new WorkerCapability({ pullRate: 30, revenuePerItem: 1 }, null)],
  });
}

describe("validateTopology", () => {
  it("Client → Server → Database — api_read is valid", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeServer("server"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "server" as ComponentId, 1);
    connect(sim, "server" as ComponentId, "db" as ComponentId, 2);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    expect(errors).toEqual([]);
  });

  it("Client → Queue → Worker for api_read — no_egress error at Worker", () => {
    // Queue forwards non-async reads to Worker. Worker is now a forwarder
    // for non-async types (matches runtime: packet passes through to
    // component egress). Worker has no downstream egress here, so BFS
    // flags no_egress at Worker (previously this test expected no_handler
    // because Worker was incorrectly treated as role="none" for non-async).
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeQueue("q"));
    sim.addComponent(makeWorker("w"));
    connect(sim, CLIENT_ID, "q" as ComponentId, 1);
    connect(sim, "q" as ComponentId, "w" as ComponentId, 2);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const err = errors.find((e) => e.requestType === "api_read");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("no_egress");
    expect(err!.componentId).toBe("w");
  });

  it("Client → LB → Worker → Server → DB for api_read is valid (Worker forwards non-async)", () => {
    // Regression: Worker in the middle of a sync chain must NOT invalidate
    // api_read. Runtime passes the packet through Worker's component egress
    // to Server → DB, which terminates.
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeLB("lb"));
    sim.addComponent(makeWorker("w"));
    sim.addComponent(makeServer("server"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "lb" as ComponentId, 1);
    connect(sim, "lb" as ComponentId, "w" as ComponentId, 2);
    connect(sim, "w" as ComponentId, "server" as ComponentId, 3);
    connect(sim, "server" as ComponentId, "db" as ComponentId, 4);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    expect(errors).toEqual([]);
  });

  it("Client → Queue → Worker → DB for async_work is valid (Worker terminates async)", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeQueue("q"));
    sim.addComponent(makeWorker("w"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "q" as ComponentId, 1);
    connect(sim, "q" as ComponentId, "w" as ComponentId, 2);
    connect(sim, "w" as ComponentId, "db" as ComponentId, 3);
    const errors = validateTopology(sim, makeWave({ asyncRatio: 1 }), CLIENT_ID);
    expect(errors).toEqual([]);
  });

  it("Client → Load-Balancer (no egress) — no_egress error at LB", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeLB("lb"));
    connect(sim, CLIENT_ID, "lb" as ComponentId, 1);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe("no_egress");
    expect(errors[0]!.componentId).toBe("lb");
    expect(errors[0]!.componentType).toBe("load-balancer");
    expect(errors[0]!.requestType).toBe("api_read");
  });

  it("Client → Cache → Server → DB — api_read is valid", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeCache("cache"));
    sim.addComponent(makeServer("server"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "cache" as ComponentId, 1);
    connect(sim, "cache" as ComponentId, "server" as ComponentId, 2);
    connect(sim, "server" as ComponentId, "db" as ComponentId, 3);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    expect(errors).toEqual([]);
  });

  it("Client → Queue → Worker (async_work) is valid", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeQueue("q"));
    sim.addComponent(makeWorker("w"));
    connect(sim, CLIENT_ID, "q" as ComponentId, 1);
    connect(sim, "q" as ComponentId, "w" as ComponentId, 2);
    const errors = validateTopology(sim, makeWave({ asyncRatio: 1 }), CLIENT_ID);
    expect(errors).toEqual([]);
  });

  it("writeRatio=1 only — only api_write is validated (and passes through Server→DB)", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeServer("server"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "server" as ComponentId, 1);
    connect(sim, "server" as ComponentId, "db" as ComponentId, 2);
    // Composition: 100% write (readRatio = 0).
    const errors = validateTopology(sim, makeWave({ writeRatio: 1 }), CLIENT_ID);
    expect(errors).toEqual([]);
    // Sanity: a wave with only writes should NOT emit an api_read error
    // even if the read path were broken — but here it's fine anyway.
    expect(errors.find((e) => e.requestType === "api_read")).toBeUndefined();
  });

  it("Cycle A → B → A terminates without infinite loop (and reports no_handler)", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    // Two servers (forwarders) cycling into each other — no terminal handler.
    sim.addComponent(makeServer("a"));
    sim.addComponent(makeServer("b"));
    connect(sim, CLIENT_ID, "a" as ComponentId, 1);
    connect(sim, "a" as ComponentId, "b" as ComponentId, 2);
    connect(sim, "b" as ComponentId, "a" as ComponentId, 3);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    // BFS must terminate. At minimum it returns without hanging.
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.reason).toBe("no_handler");
  });

  it("Multi-type wave flags errors per request type independently", () => {
    // Read-path valid (Client→Server→DB). Async path is missing a worker
    // entirely (no queue/worker branch) — async_work should fail with
    // no_handler/no_egress.
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeServer("server"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "server" as ComponentId, 1);
    connect(sim, "server" as ComponentId, "db" as ComponentId, 2);
    // Mix: 50% read (implicit) + 50% async. DB terminates reads; no worker
    // anywhere, so async should error.
    const errors = validateTopology(
      sim,
      makeWave({ asyncRatio: 0.5 }),
      CLIENT_ID,
    );
    expect(errors.find((e) => e.requestType === "api_read")).toBeUndefined();
    const asyncErr = errors.find((e) => e.requestType === "async_work");
    expect(asyncErr).toBeDefined();
  });

  it("BlobStorage terminates large_payload (reachable through Client → Blob)", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(new SimComponent({
      id: "blob" as ComponentId,
      capabilities: [new BlobStorageCapability({
        revenuePerWrite: 1, revenuePerRead: 1, revenuePerStream: 1,
      })],
    }));
    connect(sim, CLIENT_ID, "blob" as ComponentId, 1);
    // large_payload path terminates at blob.
    const errors = validateTopology(sim, makeWave({ largeRatio: 1 }), CLIENT_ID);
    expect(errors.find((e) => e.requestType === "large_payload")).toBeUndefined();
    // api_read correctly flags no_handler at blob (BlobStorage drops
    // non-large/non-stream with reason "unsupported" at runtime).
    const readErr = errors.find((e) => e.requestType === "api_read");
    expect(readErr).toBeDefined();
    expect(readErr!.reason).toBe("no_handler");
  });

  it("BlobStorage drops api_write (Client → Blob for writeRatio=1 fails no_handler)", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(new SimComponent({
      id: "blob" as ComponentId,
      capabilities: [new BlobStorageCapability({
        revenuePerWrite: 1, revenuePerRead: 1, revenuePerStream: 1,
      })],
    }));
    connect(sim, CLIENT_ID, "blob" as ComponentId, 1);
    const errors = validateTopology(sim, makeWave({ writeRatio: 1 }), CLIENT_ID);
    const err = errors.find((e) => e.requestType === "api_write");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("no_handler");
  });

  it("CircuitBreaker forwards to downstream terminal (valid sync chain)", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(new SimComponent({
      id: "cb" as ComponentId,
      capabilities: [new CircuitBreakerCapability({
        failureThreshold: 3, cooldownSeconds: 1,
      })],
    }));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "cb" as ComponentId, 1);
    connect(sim, "cb" as ComponentId, "db" as ComponentId, 2);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    expect(errors).toEqual([]);
  });

  it("Client → Database (backend-only as entry) returns backend_only_as_entry error", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "db" as ComponentId, 1);
    const types = new Map<ComponentId, string>([["db" as ComponentId, "database"]]);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID, types);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe("backend_only_as_entry");
    expect(errors[0]!.componentId).toBe("db");
    expect(errors[0]!.componentType).toBe("database");
    expect(errors[0]!.requestType).toBe("*");
  });

  it("Client → Cache → DB (Cache backend-only as entry) returns backend_only_as_entry error", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeCache("cache"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "cache" as ComponentId, 1);
    connect(sim, "cache" as ComponentId, "db" as ComponentId, 2);
    const types = new Map<ComponentId, string>([
      ["cache" as ComponentId, "data_cache"],
      ["db" as ComponentId, "database"],
    ]);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID, types);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe("backend_only_as_entry");
    expect(errors[0]!.componentId).toBe("cache");
    expect(errors[0]!.componentType).toBe("data_cache");
    expect(errors[0]!.requestType).toBe("*");
  });

  it("Empty topology (only client with no connections) flags no_handler for api_read", () => {
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.requestType).toBe("api_read");
    expect(errors[0]!.reason).toBe("no_handler");
  });
});

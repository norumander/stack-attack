import { describe, it, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimClient } from "@sim/client";
import { SimConnection } from "@sim/connection";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { LoadBalancerCapability } from "@sim/capabilities/load-balancer";
import { BlobStorageCapability } from "@sim/capabilities/blob-storage";
import { StreamingCapability } from "@sim/capabilities/streaming";
import { validateTopology } from "../../../src/physics-td/validate-topology";
import type { WaveDef, WaveComposition } from "@sim/wave";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

/**
 * Multi-egress validator tests. Regression suite for the fix that lets
 * the BFS treat "type is satisfied if ANY path from entry reaches a
 * terminal". A parallel egress from a parent to a non-handler (e.g. Blob
 * Storage on a tee branch for api_read) must NOT invalidate the topology
 * when a sibling egress leads to a proper terminal.
 */

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
  sim.addClient(new SimClient({ id: CLIENT_ID, capabilities: [], packetRate: 1 }));
}

let nextEdge = 1;
function connect(sim: Sim, from: ComponentId, to: ComponentId): void {
  const idx = nextEdge++;
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
function makeLB(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new LoadBalancerCapability()],
  });
}
function makeBlob(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new BlobStorageCapability({
      revenuePerWrite: 1, revenuePerRead: 1, revenuePerStream: 1,
    })],
  });
}
function makeStreamingServer(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [new StreamingCapability({ revenuePerStream: 1 })],
  });
}

describe("validateTopology — multi-egress satisfaction", () => {
  it("Blob on a tee branch does not break api_read when a sibling branch satisfies", () => {
    // client → ss (Streaming) → bs (Blob, terminal for large, none for read)
    //                       \→ server → db  — api_read satisfied here
    nextEdge = 1;
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeStreamingServer("ss"));
    sim.addComponent(makeBlob("bs"));
    sim.addComponent(makeServer("server"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "ss" as ComponentId);
    connect(sim, "ss" as ComponentId, "bs" as ComponentId);
    connect(sim, "ss" as ComponentId, "server" as ComponentId);
    connect(sim, "server" as ComponentId, "db" as ComponentId);

    // Mixed wave: reads + large + streams. All three types must be satisfied.
    const errors = validateTopology(
      sim,
      makeWave({ largeRatio: 0.3, streamRatio: 0.2 }),
      CLIENT_ID,
    );
    expect(errors).toEqual([]);
  });

  it("When ALL paths dead-end at Blob for api_read, an error fires", () => {
    // client → cdn (Server=forwarder) → ss (Streaming=forwarder for read)
    //   → bs (Blob, dead-end for api_read)  — nothing else downstream.
    nextEdge = 1;
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeServer("cdn"));
    sim.addComponent(makeStreamingServer("ss"));
    sim.addComponent(makeBlob("bs"));
    connect(sim, CLIENT_ID, "cdn" as ComponentId);
    connect(sim, "cdn" as ComponentId, "ss" as ComponentId);
    connect(sim, "ss" as ComponentId, "bs" as ComponentId);

    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    const readErr = errors.find((e) => e.requestType === "api_read");
    expect(readErr).toBeDefined();
    // Either no_handler at blob or no_egress at ss — both are actionable.
    expect(["no_handler", "no_egress"]).toContain(readErr!.reason);
  });

  it("Blob satisfies large_payload AND server branch satisfies api_read in the same topology", () => {
    // client → cdn → ag → ss → bs (terminal large/stream)
    //                   \→ lb → server → db (terminal api_read/write)
    nextEdge = 1;
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeServer("cdn"));
    sim.addComponent(makeServer("ag"));
    sim.addComponent(makeStreamingServer("ss"));
    sim.addComponent(makeBlob("bs"));
    sim.addComponent(makeLB("lb"));
    sim.addComponent(makeServer("server"));
    sim.addComponent(makeDB("db"));
    connect(sim, CLIENT_ID, "cdn" as ComponentId);
    connect(sim, "cdn" as ComponentId, "ag" as ComponentId);
    connect(sim, "ag" as ComponentId, "ss" as ComponentId);
    connect(sim, "ss" as ComponentId, "bs" as ComponentId);
    connect(sim, "ag" as ComponentId, "lb" as ComponentId);
    connect(sim, "lb" as ComponentId, "server" as ComponentId);
    connect(sim, "server" as ComponentId, "db" as ComponentId);

    const errors = validateTopology(
      sim,
      makeWave({ writeRatio: 0.2, largeRatio: 0.3, streamRatio: 0.2 }),
      CLIENT_ID,
    );
    expect(errors).toEqual([]);
  });

  it("Backward-compat: single-path topology with a dead-end still errors", () => {
    // client → blob only — api_read has no other path, must error.
    nextEdge = 1;
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeBlob("bs"));
    connect(sim, CLIENT_ID, "bs" as ComponentId);

    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    const err = errors.find((e) => e.requestType === "api_read");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("no_handler");
    expect(err!.componentId).toBe("bs");
  });

  it("Forwarder with zero egress still reports no_egress even if siblings exist (when no terminal found)", () => {
    // client → ag → lb (dead-end: zero egress)
    //            \→ blob (dead-end for api_read)
    // No terminal exists for api_read anywhere. The validator should report
    // the structurally clearer error (no_egress at lb).
    nextEdge = 1;
    const sim = new Sim({ seed: 1 });
    addClient(sim);
    sim.addComponent(makeServer("ag"));
    sim.addComponent(makeLB("lb"));
    sim.addComponent(makeBlob("bs"));
    connect(sim, CLIENT_ID, "ag" as ComponentId);
    connect(sim, "ag" as ComponentId, "lb" as ComponentId);
    connect(sim, "ag" as ComponentId, "bs" as ComponentId);

    const errors = validateTopology(sim, makeWave(), CLIENT_ID);
    const err = errors.find((e) => e.requestType === "api_read");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("no_egress");
    expect(err!.componentId).toBe("lb");
  });
});

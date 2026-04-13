import { describe, it, expect } from "vitest";
import { GeoRoutingCapability } from "@capabilities/geo-routing/geo-routing-capability";
import type { CapabilityId, ComponentId, ConnectionId, RequestId, PortId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { Connection } from "@core/types/connection";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(originZone: string | null = "us-east"): Request {
  return { id: "r-1" as RequestId, parentId: null, type: "api_read", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone, streamDuration: null, streamBandwidth: null };
}

function conn(id: string, targetId: string): Connection {
  return { id: id as ConnectionId, source: { componentId: "c-dns" as ComponentId, portId: "out" as PortId }, target: { componentId: targetId as ComponentId, portId: "in" as PortId }, bandwidth: 100, latency: 1, currentLoad: 0 };
}

function ctx(components: [string, string | null][], pairLatency = new Map<string, number>()): ProcessContext {
  const compMap = new Map(components.map(([id, zone]) => [id as ComponentId, { zone, condition: 1 }]));
  return {
    state: { currentTick: 0, components: compMap, zoneTopology: { zones: [], pairLatency } } as any,
    componentId: "c-dns" as ComponentId, effectiveTier: 1,
    effectiveTiers: new Map([["geo" as CapabilityId, 1]]),
    activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map(),
  };
}

describe("GeoRoutingCapability", () => {
  it("routes to same-zone target", () => {
    const cap = new GeoRoutingCapability("geo" as CapabilityId);
    const conns = [conn("cx-1", "c-eu"), conn("cx-2", "c-us")];
    const c = ctx([["c-eu", "eu-west"], ["c-us", "us-east"]]);
    expect(cap.selectConnection(req("us-east"), conns, c)).toBe("cx-2");
  });

  it("falls back to first connection when no originZone", () => {
    const cap = new GeoRoutingCapability("geo" as CapabilityId);
    const conns = [conn("cx-1", "c-eu"), conn("cx-2", "c-us")];
    const c = ctx([["c-eu", "eu-west"], ["c-us", "us-east"]]);
    expect(cap.selectConnection(req(null), conns, c)).toBe("cx-1");
  });

  it("picks nearest zone by pair latency", () => {
    const cap = new GeoRoutingCapability("geo" as CapabilityId);
    const conns = [conn("cx-1", "c-eu"), conn("cx-2", "c-ap")];
    const pairLatency = new Map([["ap-south|us-east", 150], ["eu-west|us-east", 80]]);
    const c = ctx([["c-eu", "eu-west"], ["c-ap", "ap-south"]], pairLatency);
    expect(cap.selectConnection(req("us-east"), conns, c)).toBe("cx-1"); // eu-west is closer
  });

  it("getUpkeepCost = tier * 3", () => { expect(new GeoRoutingCapability("geo" as CapabilityId).getUpkeepCost(2)).toBe(6); });
});

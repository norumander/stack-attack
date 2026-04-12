import { describe, it, expect } from "vitest";
import { ReplicationCapability } from "@capabilities/replication/replication-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(type = "api_write"): Request {
  return { id: "r-1" as RequestId, parentId: null, type, payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

function ctx(tier = 1, egressCount = 2): ProcessContext {
  const ports = [{ id: "out" as any, direction: "egress" as const, dataType: "data", capacity: 100, connections: Array.from({ length: egressCount }, (_, i) => `cx-${i}` as any) }];
  return {
    state: { currentTick: 0, components: new Map([["c-a" as ComponentId, { ports }]]) } as any,
    componentId: "c-a" as ComponentId, effectiveTier: tier,
    effectiveTiers: new Map([["rep" as CapabilityId, tier]]),
    activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map(),
  };
}

describe("ReplicationCapability", () => {
  it("has REPLICATE phase", () => { expect(new ReplicationCapability("rep" as CapabilityId).phase).toBe("REPLICATE"); });
  it("canHandle api_write and event", () => {
    const cap = new ReplicationCapability("rep" as CapabilityId);
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("event")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });
  it("spawns min(tier, egressCount) non-blocking replicas", () => {
    const cap = new ReplicationCapability("rep" as CapabilityId);
    const result = cap.process(req(), ctx(1, 3));
    expect(result.sideEffects).toHaveLength(1); // tier 1, 3 egress → 1 replica
    expect(result.sideEffects[0]!.kind).toBe("SPAWN");
    if (result.sideEffects[0]!.kind === "SPAWN") {
      expect(result.sideEffects[0]!.blocking).toBe(false);
    }
  });
  it("tier 2 with 3 egress spawns 2 replicas", () => {
    const cap = new ReplicationCapability("rep" as CapabilityId);
    const result = cap.process(req(), ctx(2, 3));
    expect(result.sideEffects).toHaveLength(2);
  });
  it("getUpkeepCost = tier * 4", () => { expect(new ReplicationCapability("rep" as CapabilityId).getUpkeepCost(2)).toBe(8); });
});

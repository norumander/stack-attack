import { describe, it, expect } from "vitest";
import { ShardingCapability } from "@capabilities/sharding/sharding-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(): Request {
  return { id: "r-1" as RequestId, parentId: null, type: "api_write", payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

function ctx(egressCount = 3): ProcessContext {
  const ports = [{ id: "out" as any, direction: "egress" as const, dataType: "data", capacity: 100, connections: Array.from({ length: egressCount }, (_, i) => `cx-${i}` as any) }];
  return {
    state: { currentTick: 0, components: new Map([["c-a" as ComponentId, { ports }]]) } as any,
    componentId: "c-a" as ComponentId, effectiveTier: 1, effectiveTiers: new Map(),
    activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map(),
  };
}

describe("ShardingCapability", () => {
  it("has REPLICATE phase", () => { expect(new ShardingCapability("sh" as CapabilityId).phase).toBe("REPLICATE"); });
  it("canHandle api_write only", () => {
    const cap = new ShardingCapability("sh" as CapabilityId);
    expect(cap.canHandle("api_write")).toBe(true);
    expect(cap.canHandle("api_read")).toBe(false);
  });
  it("spawns exactly 1 non-blocking shard request", () => {
    const cap = new ShardingCapability("sh" as CapabilityId);
    const result = cap.process(req(), ctx());
    expect(result.sideEffects).toHaveLength(1);
    expect(result.sideEffects[0]!.kind).toBe("SPAWN");
    if (result.sideEffects[0]!.kind === "SPAWN") expect(result.sideEffects[0]!.blocking).toBe(false);
  });
  it("returns PASS (doesn't override primary outcome)", () => {
    expect(new ShardingCapability("sh" as CapabilityId).process(req(), ctx()).outcome.kind).toBe("PASS");
  });
  it("getUpkeepCost = tier * 5", () => { expect(new ShardingCapability("sh" as CapabilityId).getUpkeepCost(2)).toBe(10); });
});

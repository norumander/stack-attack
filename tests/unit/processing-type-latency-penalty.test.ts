import { describe, it, expect } from "vitest";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(type: string): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type,
    payload: null,
    origin: "c-a" as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function ctx(): ProcessContext {
  return {
    state: { currentTick: 0 } as any,
    componentId: "c-a" as ComponentId,
    effectiveTier: 1,
    effectiveTiers: new Map([["processing" as CapabilityId, 1]]),
    activeCapabilityIds: new Set(),
    currentTick: 0,
    rng: createRng("t"),
    directories: [],
    childResponses: new Map(),
  };
}

describe("ProcessingCapability typeLatencyPenalty", () => {
  it("adds per-type latency penalty when emitting PROCESSED", () => {
    const cap = new ProcessingCapability("processing" as CapabilityId, {
      handledTypes: ["api_read", "auth_required"],
      emitProcessedEvent: true,
      typeLatencyPenalty: { auth_required: 4 },
    });
    const result = cap.process(req("auth_required"), ctx());
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.latencyAdded).toBe(5);
  });

  it("does not penalize types missing from the penalty table", () => {
    const cap = new ProcessingCapability("processing" as CapabilityId, {
      handledTypes: ["api_read", "auth_required"],
      emitProcessedEvent: true,
      typeLatencyPenalty: { auth_required: 4 },
    });
    const result = cap.process(req("api_read"), ctx());
    expect(result.events[0]!.latencyAdded).toBe(1);
  });

  it("default config still emits latencyAdded: 1 for any type", () => {
    const cap = new ProcessingCapability("processing" as CapabilityId, {
      emitProcessedEvent: true,
    });
    const a = cap.process(req("api_read"), ctx());
    const b = cap.process(req("auth_required"), ctx());
    expect(a.events[0]!.latencyAdded).toBe(1);
    expect(b.events[0]!.latencyAdded).toBe(1);
  });
});

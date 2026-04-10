import { describe, it, expect } from "vitest";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(): Request {
  return {
    id: "r-1" as RequestId,
    parentId: null,
    type: "api_read",
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
    effectiveTiers: new Map(),
    activeCapabilityIds: new Set(),
    currentTick: 0,
    rng: createRng("t"),
    directories: [],
  };
}

describe("ProcessingCapability stub", () => {
  it("has PROCESS phase", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId);
    expect(cap.phase).toBe("PROCESS");
  });

  it("canHandle returns true for any request type", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("stream")).toBe(true);
  });

  it("process returns a PASS outcome by default (Stage 1 stub)", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId);
    const result = cap.process(req(), ctx());
    expect(result.outcome.kind).toBe("PASS");
    expect(result.sideEffects).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("can be constructed with a test-only outcome override", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId, {
      outcomeKind: "RESPOND",
    });
    const result = cap.process(req(), ctx());
    expect(result.outcome.kind).toBe("RESPOND");
  });

  it("getUpkeepCost returns tier * 1 (stub formula)", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId);
    expect(cap.getUpkeepCost(0)).toBe(0);
    expect(cap.getUpkeepCost(3)).toBe(3);
  });
});

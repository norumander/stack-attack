import { describe, it, expect } from "vitest";
import { FilterCapability } from "@capabilities/filter/filter-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(type: string): Request {
  return { id: "r-1" as RequestId, parentId: null, type, payload: null, origin: "c-a" as ComponentId, createdAt: 0, ttl: 10, originZone: null, streamDuration: null, streamBandwidth: null };
}

function ctx(): ProcessContext {
  return { state: { currentTick: 0 } as any, componentId: "c-a" as ComponentId, effectiveTier: 1, effectiveTiers: new Map(), activeCapabilityIds: new Set(), currentTick: 0, rng: createRng("t"), directories: [], childResponses: new Map() };
}

describe("FilterCapability", () => {
  it("has INTERCEPT phase", () => {
    expect(new FilterCapability("f" as CapabilityId).phase).toBe("INTERCEPT");
  });

  it("passes everything when no filter configured", () => {
    const cap = new FilterCapability("f" as CapabilityId);
    expect(cap.process(req("api_read"), ctx()).outcome.kind).toBe("PASS");
    expect(cap.process(req("stream"), ctx()).outcome.kind).toBe("PASS");
  });

  it("passes allowed types", () => {
    const cap = new FilterCapability("f" as CapabilityId, ["api_read", "static_asset"]);
    expect(cap.process(req("api_read"), ctx()).outcome.kind).toBe("PASS");
    expect(cap.process(req("static_asset"), ctx()).outcome.kind).toBe("PASS");
  });

  it("drops disallowed types", () => {
    const cap = new FilterCapability("f" as CapabilityId, ["api_read"]);
    const result = cap.process(req("stream"), ctx());
    expect(result.outcome.kind).toBe("DROP");
    if (result.outcome.kind === "DROP") expect(result.outcome.reason).toBe("filtered");
  });

  it("configure updates allowed types", () => {
    const cap = new FilterCapability("f" as CapabilityId, ["api_read"]);
    cap.configure(["stream"]);
    expect(cap.process(req("api_read"), ctx()).outcome.kind).toBe("DROP");
    expect(cap.process(req("stream"), ctx()).outcome.kind).toBe("PASS");
  });

  it("tracks dropped count in stats", () => {
    const cap = new FilterCapability("f" as CapabilityId, ["api_read"]);
    cap.process(req("stream"), ctx());
    cap.process(req("batch"), ctx());
    expect(cap.getStats().droppedByFilter).toBe(2);
  });
});

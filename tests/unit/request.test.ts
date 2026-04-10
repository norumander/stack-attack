import { describe, it, expect } from "vitest";
import type { Request, RequestEvent, Phase } from "@core/types/request";
import type { RequestId, ComponentId } from "@core/types/ids";

describe("Request type", () => {
  it("constructs an immutable Request", () => {
    const r: Request = {
      id: "r-1" as RequestId,
      parentId: null,
      type: "api_read",
      payload: { foo: 1 },
      origin: "c-client" as ComponentId,
      createdAt: 0,
      ttl: 10,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
    expect(r.type).toBe("api_read");
  });

  it("constructs a RequestEvent", () => {
    const e: RequestEvent = {
      tick: 0,
      componentId: "c-1" as ComponentId,
      capabilityId: null,
      connectionId: null,
      type: "ENTERED",
      latencyAdded: 0,
    };
    expect(e.type).toBe("ENTERED");
  });

  it("narrows Phase union", () => {
    const p: Phase = "INTERCEPT";
    expect(p).toBe("INTERCEPT");
  });
});

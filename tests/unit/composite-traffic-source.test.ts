import { describe, it, expect } from "vitest";
import { CompositeTrafficSource } from "@core/mode/composite-traffic-source";
import type { TrafficSource } from "@core/mode/traffic-source";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

function mkRequest(id: string, origin: string): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin: origin as ComponentId,
    createdAt: 0,
    ttl: 10,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

function mockSource(id: string, origin: string): TrafficSource {
  return {
    targetEntryPointId: origin as ComponentId,
    generate: (_tick: number) => [mkRequest(`${id}-r`, origin)],
  };
}

describe("CompositeTrafficSource", () => {
  it("targetEntryPointId is null", () => {
    const c = new CompositeTrafficSource([]);
    expect(c.targetEntryPointId).toBeNull();
  });

  it("generate concatenates sub-source outputs", () => {
    const c = new CompositeTrafficSource([
      mockSource("a", "c-a"),
      mockSource("b", "c-b"),
    ]);
    const out = c.generate(0);
    expect(out.map((r) => r.id)).toEqual(["a-r", "b-r"]);
  });

  it("getSubSources returns the configured sources", () => {
    const a = mockSource("a", "c-a");
    const b = mockSource("b", "c-b");
    const c = new CompositeTrafficSource([a, b]);
    expect(c.getSubSources()).toEqual([a, b]);
  });
});

import { describe, it, expect } from "vitest";
import type { ChaosEvent, ActiveChaosEntry } from "@core/types/chaos";
import type { ActiveStream } from "@core/types/stream";
import type { Request } from "@core/types/request";
import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids";

describe("ChaosEvent and ActiveStream", () => {
  it("models each ChaosEvent kind", () => {
    const events: ChaosEvent[] = [
      { kind: "component_failure", componentId: "c-1" as ComponentId },
      { kind: "zone_outage", zone: "us-east", durationTicks: 5 },
      {
        kind: "connection_sever",
        connectionId: "cx-1" as ConnectionId,
        durationTicks: 3,
      },
      {
        kind: "latency_injection",
        connectionId: "cx-1" as ConnectionId,
        extraLatency: 10,
        durationTicks: 2,
      },
    ];
    expect(events).toHaveLength(4);
  });

  it("wraps a ChaosEvent in an ActiveChaosEntry", () => {
    const entry: ActiveChaosEntry = {
      event: { kind: "component_failure", componentId: "c-1" as ComponentId },
      expiresAtTick: 10,
    };
    expect(entry.expiresAtTick).toBe(10);
  });

  it("builds an ActiveStream with mutable duration and bandwidth", () => {
    const request: Request = {
      id: "r-1" as RequestId,
      parentId: null,
      type: "api_read",
      payload: null,
      origin: "c-1" as ComponentId,
      createdAt: 0,
      ttl: 100,
      originZone: null,
      streamDuration: 20,
      streamBandwidth: 5,
    };
    const stream: ActiveStream = {
      requestId: "r-1" as RequestId,
      connectionId: "cx-1" as ConnectionId,
      originComponentId: "c-1" as ComponentId,
      baseRevenue: 2,
      request,
      remainingDuration: 20,
      reservedBandwidth: 5,
    };
    stream.remainingDuration -= 1;
    expect(stream.remainingDuration).toBe(19);
  });
});

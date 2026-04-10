import { describe, it, expect } from "vitest";
import type { Port } from "@core/types/port";
import type { Connection } from "@core/types/connection";
import type { PortId, ComponentId, ConnectionId } from "@core/types/ids";

describe("Port and Connection", () => {
  it("constructs an ingress Port with mutable connections list", () => {
    const p: Port = {
      id: "p-1" as PortId,
      direction: "ingress",
      dataType: "any",
      capacity: 100,
      connections: [],
    };
    p.connections.push("cx-1" as ConnectionId);
    expect(p.connections).toHaveLength(1);
  });

  it("constructs a Connection with mutable currentLoad", () => {
    const c: Connection = {
      id: "cx-1" as ConnectionId,
      source: { componentId: "c-a" as ComponentId, portId: "p-a" as PortId },
      target: { componentId: "c-b" as ComponentId, portId: "p-b" as PortId },
      bandwidth: 10,
      latency: 1,
      currentLoad: 0,
    };
    c.currentLoad = 5;
    expect(c.currentLoad).toBe(5);
  });
});

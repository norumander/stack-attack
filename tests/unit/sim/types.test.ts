import { describe, it, expect } from "vitest";
import type {
  Packet,
  Request,
  Outcome,
  PacketId,
  ArrivalContext,
} from "@sim/types";

describe("sim types", () => {
  it("Packet and Outcome variants are well-formed", () => {
    const req: Request = {
      id: "r1" as unknown as Request["id"],
      key: "k1",
      isWrite: false,
      requiresAuth: false,
      isLarge: false,
      isAsync: false,
      originClientId: "c1" as unknown as Request["originClientId"],
      originZone: null,
      spawnedAt: 0,
    };
    const packet: Packet = {
      id: "p1" as PacketId,
      requests: [req],
      edgeId: "e1" as unknown as Packet["edgeId"],
      progress: 0,
      speed: 1,
      spawnedAt: 0,
      parentId: null,
      direction: "forward",
      route: [],
    };
    const outcomes: Outcome[] = [
      { kind: "forward", emit: [{ edgeId: packet.edgeId, packet }] },
      { kind: "terminate", revenue: 5 },
      { kind: "respond", responsePacket: { ...packet, direction: "back" }, revenueOnDelivery: 0 },
      { kind: "drop", reason: "overloaded", count: 1 },
    ];
    expect(outcomes.length).toBe(4);
    expect(packet.direction).toBe("forward");
  });
});

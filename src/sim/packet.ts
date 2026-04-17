import type { ConnectionId, RequestId } from "@core/types/ids";
import type { Packet, PacketDirection, PacketId, Request } from "./types";

let nextPacketIdCounter = 0;
let nextRequestIdCounter = 0;

/** Monotonic packet id. Reset only in tests that need cross-test isolation. */
export function mintPacketId(): PacketId {
  nextPacketIdCounter += 1;
  return `p${String(nextPacketIdCounter).padStart(10, "0")}` as PacketId;
}

export function mintRequestId(): RequestId {
  nextRequestIdCounter += 1;
  return `r${String(nextRequestIdCounter).padStart(10, "0")}` as RequestId;
}

export function resetIdCountersForTest(): void {
  nextPacketIdCounter = 0;
  nextRequestIdCounter = 0;
}

export type NewPacketInput = {
  readonly requests: readonly Request[];
  readonly edgeId: ConnectionId;
  readonly speed: number;
  readonly spawnedAt: number;
  readonly direction: PacketDirection;
  readonly parentId?: PacketId | null;
  readonly route?: ConnectionId[];
};

export function makePacket(input: NewPacketInput): Packet {
  return {
    id: mintPacketId(),
    requests: input.requests,
    edgeId: input.edgeId,
    progress: 0,
    speed: input.speed,
    spawnedAt: input.spawnedAt,
    parentId: input.parentId ?? null,
    direction: input.direction,
    route: input.route ? [...input.route] : [],
  };
}

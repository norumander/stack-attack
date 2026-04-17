import type {
  ComponentId,
  ConnectionId,
  RequestId,
} from "@core/types/ids";

export type PacketId = string & { readonly __brand: "PacketId" };

export type Zone = string;

export type StreamConfig = {
  readonly duration: number;
  readonly bandwidth: number;
};

export type Request = {
  readonly id: RequestId;
  readonly key: string;
  readonly isWrite: boolean;
  readonly requiresAuth: boolean;
  readonly isLarge: boolean;
  readonly stream?: StreamConfig;
  readonly originClientId: ComponentId;
  readonly originZone: Zone | null;
  readonly spawnedAt: number;
};

export type PacketDirection = "forward" | "back";

export type Packet = {
  readonly id: PacketId;
  readonly requests: readonly Request[];
  readonly edgeId: ConnectionId;
  progress: number;
  readonly speed: number;
  readonly spawnedAt: number;
  readonly parentId: PacketId | null;
  readonly direction: PacketDirection;
  route: ConnectionId[];
};

export type Outcome =
  | { readonly kind: "forward"; readonly emit: ReadonlyArray<{ edgeId: ConnectionId; packet: Packet }> }
  | { readonly kind: "terminate"; readonly revenue: number }
  | { readonly kind: "respond"; readonly responsePacket: Packet }
  | { readonly kind: "drop"; readonly reason: string; readonly count: number };

export type ArrivalContext = {
  readonly componentId: ComponentId;
  readonly ingressEdgeId: ConnectionId;
  readonly simTime: number;
  readonly rng: () => number;
  readonly mintPacketId: () => PacketId;
  readonly mintRequestId: () => RequestId;
};

export type SimCapability = {
  readonly id: string;
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome;
  onArriveResponse?(packet: Packet, ctx: ArrivalContext): void;
};

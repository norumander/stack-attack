import type {
  ComponentId,
  ConnectionId,
  RequestId,
} from "@core/types/ids";
import type { CapacityBucket } from "./capacity-bucket";

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
  readonly isAsync: boolean;
  readonly stream?: StreamConfig;
  readonly originClientId: ComponentId;
  readonly originZone: Zone | null;
  readonly spawnedAt: number;
};

export type PacketDirection = "forward" | "back";

export type Packet = {
  readonly id: PacketId;
  readonly requests: readonly Request[];
  edgeId: ConnectionId;
  progress: number;
  speed: number;
  readonly spawnedAt: number;
  readonly parentId: PacketId | null;
  readonly direction: PacketDirection;
  route: ConnectionId[];
};

export type Outcome =
  | { readonly kind: "forward"; readonly emit: ReadonlyArray<{ edgeId: ConnectionId; packet: Packet }> }
  | { readonly kind: "terminate"; readonly revenue: number; readonly count: number }
  | { readonly kind: "respond"; readonly responsePacket: Packet; readonly revenueOnDelivery: number; readonly count: number }
  | { readonly kind: "drop"; readonly reason: string; readonly count: number }
  | { readonly kind: "multi"; readonly outcomes: readonly Outcome[] }
  | { readonly kind: "split"; readonly emit: ReadonlyArray<{ edgeId: ConnectionId; packet: Packet }>; readonly mergeKey: PacketId; readonly expectedChildren: number; readonly ingressEdgeId: ConnectionId; readonly preSplitRoute: ReadonlyArray<ConnectionId> };

export type ArrivalContext = {
  readonly componentId: ComponentId;
  readonly ingressEdgeId: ConnectionId;
  readonly egressEdges: ReadonlyArray<{ id: ConnectionId; speed: number; targetZone: Zone | null }>;
  readonly simTime: number;
  readonly rng: () => number;
  readonly bucket: CapacityBucket | null;
  readonly mintPacketId: () => PacketId;
  readonly mintRequestId: () => RequestId;
  readonly reserveBandwidth?: (edgeId: ConnectionId, amount: number, durationSeconds: number) => boolean;
};

export type StepContext = {
  readonly dt: number;
  readonly simTime: number;
};

export type SimCapability = {
  readonly id: string;
  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome;
  onArriveResponse?(packet: Packet, ctx: ArrivalContext): void;
  /** Optional per-tick hook. Called once per sim step for every capability
   * attached to every component, before arrival dispatch. Used by AutoScale
   * to sample utilization. `parent` is the component the capability is
   * attached to — capabilities do not otherwise hold that reference. */
  onStep?(ctx: StepContext, parent: import("./component").SimComponent): void;
};

export type SimEvent =
  | { readonly kind: "drop"; readonly componentId: ComponentId; readonly reason: string; readonly count: number }
  | { readonly kind: "terminate"; readonly componentId: ComponentId; readonly revenue: number; readonly latencySeconds: number; readonly count: number }
  | { readonly kind: "respond-delivered"; readonly componentId: ComponentId; readonly revenue: number; readonly latencySeconds: number; readonly count: number };

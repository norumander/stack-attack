import type {
  RequestId,
  ComponentId,
  CapabilityId,
  ConnectionId,
} from "./ids.js";

export type { Phase } from "./phase.js";

export interface Request {
  readonly id: RequestId;
  readonly parentId: RequestId | null;
  readonly type: string;
  readonly payload: unknown;
  readonly origin: ComponentId;
  readonly createdAt: number;
  readonly ttl: number;
  readonly originZone: string | null;
  readonly streamDuration: number | null;
  readonly streamBandwidth: number | null;
}

export type RequestEventType =
  | "ENTERED"
  | "PROCESSED"
  | "FORWARDED"
  | "CACHED_HIT"
  | "CACHED_MISS"
  | "QUEUED"
  | "DEQUEUED"
  | "SPAWNED_SUB"
  | "RESPONDED"
  | "DROPPED"
  | "TIMED_OUT"
  | "BACKPRESSURED"
  | "OVERLOADED"
  | "TRAVERSED"
  | "CHILD_RESOLVED"
  | "CHILD_FAILED"
  | "SIBLING_CANCELLED"
  | "STREAM_STARTED"
  | "STREAM_COMPLETED";

export interface RequestEvent {
  readonly tick: number;
  readonly componentId: ComponentId;
  readonly capabilityId: CapabilityId | null;
  readonly connectionId: ConnectionId | null;
  readonly type: RequestEventType;
  readonly latencyAdded: number;
  readonly metadata?: Record<string, unknown>;
}

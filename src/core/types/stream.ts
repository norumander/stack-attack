import type { RequestId, ComponentId, ConnectionId } from "./ids.js";

export interface ActiveStream {
  readonly requestId: RequestId;
  readonly connectionId: ConnectionId;
  readonly originComponentId: ComponentId;
  readonly baseRevenue: number;
  remainingDuration: number;
  reservedBandwidth: number;
}

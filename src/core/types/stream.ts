import type { RequestId, ComponentId, ConnectionId } from "./ids.js";
import type { Request } from "./request.js";

export interface ActiveStream {
  readonly requestId: RequestId;
  readonly connectionId: ConnectionId;
  readonly originComponentId: ComponentId;
  readonly baseRevenue: number;
  readonly request: Request;
  remainingDuration: number;
  reservedBandwidth: number;
}

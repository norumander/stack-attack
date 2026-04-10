import type { ConnectionId, ComponentId, PortId } from "./ids.js";

export interface Connection {
  readonly id: ConnectionId;
  readonly source: { componentId: ComponentId; portId: PortId };
  readonly target: { componentId: ComponentId; portId: PortId };
  readonly bandwidth: number;
  readonly latency: number;
  currentLoad: number;
}

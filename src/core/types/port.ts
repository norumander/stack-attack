import type { PortId, ConnectionId } from "./ids.js";

export interface Port {
  readonly id: PortId;
  readonly direction: "ingress" | "egress";
  readonly dataType: string;
  readonly capacity: number;
  connections: ConnectionId[];
}

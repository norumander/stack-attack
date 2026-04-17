import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

export type ConnectionDirection = "forward" | "back";

export type SimConnectionOptions = {
  readonly id: ConnectionId;
  readonly from: { componentId: ComponentId; portId: PortId };
  readonly to: { componentId: ComponentId; portId: PortId };
  readonly bandwidth: number;
  readonly latencySeconds: number;
  readonly twinId: ConnectionId;
  readonly direction: ConnectionDirection;
};

export class SimConnection {
  readonly id: ConnectionId;
  readonly from: { componentId: ComponentId; portId: PortId };
  readonly to: { componentId: ComponentId; portId: PortId };
  readonly bandwidth: number;
  readonly latencySeconds: number;
  readonly twinId: ConnectionId;
  readonly direction: ConnectionDirection;

  constructor(opts: SimConnectionOptions) {
    this.id = opts.id;
    this.from = opts.from;
    this.to = opts.to;
    this.bandwidth = opts.bandwidth;
    this.latencySeconds = opts.latencySeconds;
    this.twinId = opts.twinId;
    this.direction = opts.direction;
  }

  /** Edge-units per second. `latencySeconds` = seconds to traverse once. */
  get speed(): number {
    return 1 / this.latencySeconds;
  }
}

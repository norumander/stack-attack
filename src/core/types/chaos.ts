import type { ComponentId, ConnectionId } from "./ids.js";

export type ChaosEvent =
  | { kind: "component_failure"; componentId: ComponentId }
  | { kind: "zone_outage"; zone: string; durationTicks: number }
  | { kind: "connection_sever"; connectionId: ConnectionId; durationTicks: number }
  | {
      kind: "latency_injection";
      connectionId: ConnectionId;
      extraLatency: number;
      durationTicks: number;
    };

export interface ActiveChaosEntry {
  readonly event: ChaosEvent;
  readonly expiresAtTick: number;
}

import type { ComponentId, ConnectionId, RequestId } from "../types/ids.js";
import type { Connection } from "../types/connection.js";
import type { ComponentReader } from "../component/component-reader.js";
import type { ZoneTopology } from "../types/zone.js";
import type { RequestEvent } from "../types/request.js";
import type { ActiveStream } from "../types/stream.js";
import type { ActiveChaosEntry } from "../types/chaos.js";
import type { PerComponentTickCounters } from "../engine/per-component-counters.js";

export interface SimulationStateReader {
  readonly components: ReadonlyMap<ComponentId, ComponentReader>;
  readonly connections: ReadonlyMap<ConnectionId, Readonly<Connection>>;
  readonly zoneTopology: ZoneTopology;
  readonly currentTick: number;
  readonly phase: "build" | "simulate" | "assess";
  readonly perComponentThisTick: ReadonlyMap<ComponentId, Readonly<PerComponentTickCounters>>;
  getEventsFor(requestId: RequestId): readonly RequestEvent[];
  getActiveStreamsOnConnection(connectionId: ConnectionId): readonly ActiveStream[];
  getActiveChaos(): readonly ActiveChaosEntry[];
}

import type { ComponentId, ConnectionId, RequestId } from "../types/ids.js";
import type { Connection } from "../types/connection.js";
import type { ComponentReader } from "../component/component-reader.js";
import type { ZoneTopology } from "../types/zone.js";
import type { RequestEvent } from "../types/request.js";
import type { ActiveStream } from "../types/stream.js";
import type { ActiveChaosEntry } from "../types/chaos.js";

export interface SimulationStateReader {
  readonly components: ReadonlyMap<ComponentId, ComponentReader>;
  readonly connections: ReadonlyMap<ConnectionId, Readonly<Connection>>;
  readonly zoneTopology: ZoneTopology;
  readonly currentTick: number;
  readonly phase: "build" | "simulate" | "assess";
  getEventsFor(requestId: RequestId): readonly RequestEvent[];
  getActiveStreamsOnConnection(connectionId: ConnectionId): readonly ActiveStream[];
  getActiveChaos(): readonly ActiveChaosEntry[];
}

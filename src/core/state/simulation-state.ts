import type { ComponentId, ConnectionId, RequestId } from "../types/ids.js";
import type { Connection } from "../types/connection.js";
import type { Request, RequestEvent, PerTickEventView } from "../types/request.js";
import type { ActiveStream } from "../types/stream.js";
import type { ActiveChaosEntry } from "../types/chaos.js";
import type { ZoneTopology } from "../types/zone.js";
import { Component } from "../component/component.js";
import type { ComponentReader } from "../component/component-reader.js";
import type { SimulationStateReader } from "./state-reader.js";
import type { PerComponentTickCounters } from "../engine/per-component-counters.js";
import type { StagedOutcome } from "../engine/staged-outcome.js";
import type { BlockedParentEntry, ChildResponseSnapshot } from "../engine/blocked-parent.js";
import type { TickMetrics } from "../types/metrics.js";
import { computeVisitOrder } from "../engine/visit-order.js";

export class SimulationState {
  readonly components: Map<ComponentId, Component> = new Map();
  readonly connections: Map<ConnectionId, Connection> = new Map();
  readonly pending: Map<ComponentId, Request[]> = new Map();
  readonly activeStreams: Map<RequestId, ActiveStream> = new Map();
  readonly requestLog: Map<RequestId, RequestEvent[]> = new Map();
  /**
   * Per-tick event view. Cleared at the start of `Engine.tick()`, filled via
   * `appendEvent`. Each entry carries the owning `requestId` so flat-list
   * consumers (the Stage 3c renderer adapter) can correlate FORWARDED dots
   * with their subsequent SERVED/DROPPED/OVERLOADED flashes without rescanning
   * `requestLog`. Consumers read between ticks.
   */
  readonly lastTickEvents: PerTickEventView[] = [];
  readonly activeChaos: Map<string, ActiveChaosEntry> = new Map();
  readonly zoneTopology: ZoneTopology;
  currentTick = 0;
  phase: "build" | "simulate" | "assess" = "build";
  revenueEarnedThisTick = 0;
  upkeepPaidThisTick = 0;
  readonly perComponentThisTick: Map<ComponentId, PerComponentTickCounters> = new Map();
  connectionLoadThisTick: Map<ConnectionId, number> = new Map();
  readonly visitOrder: ComponentId[] = [];
  readonly stagedOutcomes: StagedOutcome[] = [];
  readonly blockedParents: Map<RequestId, BlockedParentEntry> = new Map();
  readonly childToParent: Map<RequestId, RequestId> = new Map();
  readonly roundRobinCursor: Map<ComponentId, number> = new Map();
  readonly metricsHistory: TickMetrics[] = [];
  readonly pendingChildResponses: Map<RequestId, Map<RequestId, ChildResponseSnapshot>> = new Map();

  constructor(zoneTopology: ZoneTopology) {
    this.zoneTopology = zoneTopology;
  }

  placeComponent(c: Component): void {
    this.components.set(c.id, c);
    if (!this.pending.has(c.id)) this.pending.set(c.id, []);
  }

  removeComponent(id: ComponentId): void {
    this.components.delete(id);
    this.pending.delete(id);
  }

  addConnection(c: Connection): void {
    this.connections.set(c.id, c);
  }

  removeConnection(id: ConnectionId): void {
    this.connections.delete(id);
  }

  appendEvent(requestId: RequestId, event: RequestEvent): void {
    const arr = this.requestLog.get(requestId) ?? [];
    arr.push(event);
    this.requestLog.set(requestId, arr);
    // lastTickEvents stores a stamped copy so consumers see requestId inline.
    // requestLog still holds the unstamped RequestEvent per its existing
    // contract (the map key provides the requestId there).
    this.lastTickEvents.push({ ...event, requestId });
  }

  enqueuePending(componentId: ComponentId, request: Request): void {
    const arr = this.pending.get(componentId) ?? [];
    arr.push(request);
    this.pending.set(componentId, arr);
  }

  dequeuePending(componentId: ComponentId): Request | undefined {
    const arr = this.pending.get(componentId);
    if (!arr || arr.length === 0) return undefined;
    return arr.shift();
  }

  registerActiveStream(stream: ActiveStream): void {
    this.activeStreams.set(stream.requestId, stream);
  }

  releaseActiveStream(requestId: RequestId): void {
    this.activeStreams.delete(requestId);
  }

  incrementProcessedCount(componentId: ComponentId): void {
    const counters = this.perComponentThisTick.get(componentId) ?? {
      processed: 0,
      drops: 0,
      timeouts: 0,
      overloaded: 0,
      backpressured: 0,
    };
    counters.processed += 1;
    this.perComponentThisTick.set(componentId, counters);
  }

  incrementConnectionLoad(connectionId: ConnectionId, amount: number): void {
    const prev = this.connectionLoadThisTick.get(connectionId) ?? 0;
    this.connectionLoadThisTick.set(connectionId, prev + amount);
    const conn = this.connections.get(connectionId);
    if (conn) conn.currentLoad = prev + amount;
  }

  setCondition(componentId: ComponentId, value: number): void {
    const comp = this.components.get(componentId);
    if (!comp) return;
    comp.condition = Math.max(0, Math.min(1, value));
  }

  setInstanceCount(componentId: ComponentId, count: number): void {
    const comp = this.components.get(componentId);
    if (!comp) return;
    comp.instanceCount = Math.max(0, count);
  }

  advanceTick(): void {
    this.currentTick += 1;
  }

  /**
   * Rewrite `visitOrder` in place from the current `components` map using
   * the canonical `computeVisitOrder` ordering (zone → placementTick → id).
   *
   * The Engine constructor calls this once at boot. Dashboard / headless
   * code paths that add components between waves without reconstructing
   * the Engine call it again on the build→simulate transition so newly
   * placed components are visited on the next tick.
   */
  recomputeVisitOrder(): void {
    this.visitOrder.length = 0;
    this.visitOrder.push(...computeVisitOrder(this.components));
  }

  asReader(): SimulationStateReader {
    const self = this;
    return {
      // Component implements ComponentReader, so this narrows at the type level.
      components: self.components as unknown as ReadonlyMap<ComponentId, ComponentReader>,
      connections: self.connections,
      zoneTopology: self.zoneTopology,
      perComponentThisTick: self.perComponentThisTick,
      get currentTick() {
        return self.currentTick;
      },
      get phase() {
        return self.phase;
      },
      getEventsFor: (id) => self.requestLog.get(id) ?? [],
      getActiveStreamsOnConnection: (connId) => {
        const result: ActiveStream[] = [];
        for (const s of self.activeStreams.values()) {
          if (s.connectionId === connId) result.push(s);
        }
        return result;
      },
      getActiveChaos: () => [...self.activeChaos.values()],
    };
  }
}

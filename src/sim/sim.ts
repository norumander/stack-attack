import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { ArrivalContext, Outcome, Packet, PacketId, SimEvent, Zone } from "./types";
import type { SimComponent } from "./component";
import type { SimClient } from "./client";
import type { SimConnection } from "./connection";
import { makeSimRng } from "./rng";
import { mintPacketId, mintRequestId } from "./packet";
import { advancePackets, collectArrivals } from "./edge-physics";
import { launchDueSnakes, populateSnakes } from "./snake";
import { WorkerCapability } from "./capabilities/worker";
import { effectiveEdgeSpeed } from "./zone-latency";

export type SimOptions = {
  readonly seed: number;
};

export class Sim {
  readonly components: Map<ComponentId, SimComponent> = new Map();
  readonly clients: Map<ComponentId, SimClient> = new Map();
  readonly connections: Map<ConnectionId, SimConnection> = new Map();
  readonly activePackets: Packet[] = [];
  readonly lastStepEvents: SimEvent[] = [];
  readonly crashedComponents: Set<ComponentId> = new Set();
  simTime = 0;
  readonly rng: () => number;
  private readonly revenueByPacketId: Map<PacketId, { revenue: number; count: number }> = new Map();
  private readonly mergeByParent: Map<PacketId, {
    expectedChildren: number;
    receivedChildren: number;
    accumulatedRevenue: number;
    accumulatedCount: number;
    ingressEdgeId: ConnectionId;
    preSplitRoute: ConnectionId[];
    originalSpawnedAt: number;
  }> = new Map();
  private readonly parentOfChild: Map<PacketId, PacketId> = new Map();
  private readonly activeReservations: { connectionId: ConnectionId; amount: number; releaseAt: number }[] = [];
  private currentArrivalSpawnedAt: number = 0;

  private releaseExpiredReservations(): void {
    const keep: typeof this.activeReservations = [];
    for (const r of this.activeReservations) {
      if (r.releaseAt > this.simTime) { keep.push(r); continue; }
      const conn = this.connections.get(r.connectionId);
      if (conn) conn.reservedBandwidth -= r.amount;
    }
    this.activeReservations.length = 0;
    this.activeReservations.push(...keep);
  }

  constructor(opts: SimOptions) {
    this.rng = makeSimRng(opts.seed);
  }

  addComponent(c: SimComponent): void {
    this.components.set(c.id, c);
  }

  addClient(c: SimClient): void {
    this.clients.set(c.id, c);
    this.components.set(c.id, c);
  }

  addConnection(c: SimConnection): void {
    this.connections.set(c.id, c);
  }

  spawnPacket(p: Packet): void {
    this.activePackets.push(p);
  }

  step(dt: number): void {
    this.lastStepEvents.length = 0;
    this.releaseExpiredReservations();
    for (const c of this.components.values()) c.refillBucket(dt);
    populateSnakes(this.clients, this.simTime + dt);
    launchDueSnakes(this.clients, this.connections, this.activePackets, this.simTime + dt, this.rng, this.components);
    this.pullFromWorkers(dt);
    advancePackets(this.activePackets, dt);
    const { arriving, remaining } = collectArrivals(this.activePackets);
    this.activePackets.length = 0;
    this.activePackets.push(...remaining);
    for (const packet of arriving) {
      this.dispatchArrival(packet);
    }
    // Per-capability onStep hook — runs after arrivals so utilization samples
    // reflect this step's consumption. AutoScale uses this; most capabilities
    // do not implement it.
    const stepCtx = { dt, simTime: this.simTime };
    for (const comp of this.components.values()) {
      for (const cap of comp.capabilities) {
        cap.onStep?.(stepCtx, comp);
      }
    }
    this.simTime += dt;
  }

  /**
   * Chaos primitive: mark a component as crashed. Subsequent incoming packets
   * destined for it are dropped; any in-flight packets currently targeting it
   * are flushed immediately. Idempotent.
   */
  crashComponent(id: ComponentId): void {
    if (this.crashedComponents.has(id)) return;
    if (!this.components.has(id)) return;
    this.crashedComponents.add(id);
    let flushed = 0;
    const kept: Packet[] = [];
    for (const p of this.activePackets) {
      const edge = this.connections.get(p.edgeId);
      if (edge && edge.to.componentId === id) {
        flushed += 1;
        this.revenueByPacketId.delete(p.id);
        continue;
      }
      kept.push(p);
    }
    this.activePackets.length = 0;
    this.activePackets.push(...kept);
    this.lastStepEvents.push({ kind: "component-crashed", componentId: id, flushedPackets: flushed });
  }

  /**
   * Chaos primitive: sever a connection (and its twin). Both forward and back
   * edges are removed from the topology; any in-flight packets riding either
   * edge are flushed. Idempotent.
   */
  severConnection(id: ConnectionId): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    const twinId = conn.twinId;
    const twin = twinId ? this.connections.get(twinId) : undefined;
    this.connections.delete(id);
    if (twin) this.connections.delete(twin.id);
    let flushed = 0;
    const kept: Packet[] = [];
    for (const p of this.activePackets) {
      if (p.edgeId === id || (twin && p.edgeId === twin.id)) {
        flushed += 1;
        this.revenueByPacketId.delete(p.id);
        continue;
      }
      kept.push(p);
    }
    this.activePackets.length = 0;
    this.activePackets.push(...kept);
    this.lastStepEvents.push({
      kind: "connection-severed",
      connectionId: id,
      twinId: twin ? twin.id : null,
      flushedPackets: flushed,
    });
  }

  private dispatchArrival(packet: Packet): void {
    this.currentArrivalSpawnedAt = packet.spawnedAt;
    const edge = this.connections.get(packet.edgeId);
    if (!edge) return;
    const component = this.components.get(edge.to.componentId);
    if (!component) return;
    if (this.crashedComponents.has(component.id)) {
      this.lastStepEvents.push({
        kind: "drop",
        componentId: component.id,
        reason: "component_crashed",
        count: packet.requests.length,
      });
      this.revenueByPacketId.delete(packet.id);
      if (packet.direction === "forward") {
        this.notifyCircuitBreakersAlongPath(packet, component.id, "failure");
      }
      return;
    }
    const egressEdges: { id: ConnectionId; speed: number; targetZone: Zone | null }[] = [];
    for (const conn of this.connections.values()) {
      if (conn.from.componentId === component.id && conn.direction === "forward") {
        const target = this.components.get(conn.to.componentId);
        egressEdges.push({ id: conn.id, speed: effectiveEdgeSpeed(conn, this.components), targetZone: target?.zone ?? null });
      }
    }
    const ctx: ArrivalContext = {
      componentId: component.id,
      ingressEdgeId: edge.id,
      egressEdges,
      simTime: this.simTime,
      rng: this.rng,
      bucket: component.bucket,
      mintPacketId: () => this.mintPacketId(),
      mintRequestId: () => this.mintRequestId(),
      reserveBandwidth: (edgeId, amount, durationSeconds) => {
        const conn = this.connections.get(edgeId);
        if (!conn) return false;
        if (!conn.canReserve(amount)) return false;
        conn.reservedBandwidth += amount;
        this.activeReservations.push({ connectionId: edgeId, amount, releaseAt: this.simTime + durationSeconds });
        return true;
      },
    };
    if (packet.direction === "forward") {
      const cap = component.capabilities[0];
      if (!cap) {
        this.lastStepEvents.push({ kind: "drop", componentId: component.id, reason: "no_capability", count: packet.requests.length });
        return;
      }
      const outcome = cap.onArriveRequest(packet, ctx);
      this.applyOutcome(outcome, component.id, packet);
    } else {
      for (const cap of component.capabilities) {
        cap.onArriveResponse?.(packet, ctx);
      }
      // Check if this response is a child of a split — merge wait-all.
      const parentPacketId = packet.parentId != null ? this.parentOfChild.get(packet.parentId) : undefined;
      if (parentPacketId !== undefined) {
        const merge = this.mergeByParent.get(parentPacketId);
        if (merge !== undefined) {
          merge.receivedChildren += 1;
          const child = this.revenueByPacketId.get(packet.id) ?? { revenue: 0, count: 0 };
          merge.accumulatedRevenue += child.revenue;
          merge.accumulatedCount += child.count;
          this.revenueByPacketId.delete(packet.id);
          this.parentOfChild.delete(packet.parentId!);
          if (merge.receivedChildren >= merge.expectedChildren) {
            const twinId = this.connections.get(merge.ingressEdgeId)?.twinId;
            const twin = twinId ? this.connections.get(twinId) : undefined;
            this.mergeByParent.delete(parentPacketId);
            if (!twin) {
              this.lastStepEvents.push({
                kind: "respond-delivered",
                componentId: component.id,
                revenue: merge.accumulatedRevenue,
                latencySeconds: this.simTime - merge.originalSpawnedAt,
                count: merge.accumulatedCount,
              });
              return;
            }
            const merged: Packet = {
              id: this.mintPacketId(),
              requests: [],
              edgeId: twin.id,
              progress: 0,
              speed: effectiveEdgeSpeed(twin, this.components),
              spawnedAt: merge.originalSpawnedAt,
              parentId: parentPacketId,
              direction: "back",
              route: [...merge.preSplitRoute],
            };
            this.revenueByPacketId.set(merged.id, { revenue: merge.accumulatedRevenue, count: merge.accumulatedCount });
            this.activePackets.push(merged);
          }
          return; // child retires at LB — do not fall through to route-pop
        }
      }
      // Response just arrived at a component. Pop the route and retrace on next twin.
      const poppedEdgeId = packet.route.pop();
      if (poppedEdgeId === undefined) {
        // No upstream left — response has returned to origin.
        const rec = this.revenueByPacketId.get(packet.id) ?? { revenue: 0, count: 0 };
        this.revenueByPacketId.delete(packet.id);
        this.lastStepEvents.push({
          kind: "respond-delivered",
          componentId: component.id,
          revenue: rec.revenue,
          latencySeconds: this.simTime - packet.spawnedAt,
          count: rec.count,
        });
        return;
      }
      const nextRequestEdgeId = packet.route[packet.route.length - 1];
      if (nextRequestEdgeId === undefined) {
        // Reached origin — route is now empty; response delivered.
        const rec = this.revenueByPacketId.get(packet.id) ?? { revenue: 0, count: 0 };
        this.revenueByPacketId.delete(packet.id);
        this.lastStepEvents.push({
          kind: "respond-delivered",
          componentId: component.id,
          revenue: rec.revenue,
          latencySeconds: this.simTime - packet.spawnedAt,
          count: rec.count,
        });
        return;
      }
      const nextTwinId = this.connections.get(nextRequestEdgeId)?.twinId;
      const nextTwin = nextTwinId ? this.connections.get(nextTwinId) : undefined;
      if (!nextTwin) return;
      packet.edgeId = nextTwin.id;
      packet.progress = 0;
      packet.speed = effectiveEdgeSpeed(nextTwin, this.components);
      this.activePackets.push(packet);
    }
  }

  private applyOutcome(outcome: Outcome, componentId: ComponentId, sourcePacket: Packet): void {
    switch (outcome.kind) {
      case "forward":
        for (const emit of outcome.emit) {
          this.activePackets.push(emit.packet);
        }
        return;
      case "drop":
        this.lastStepEvents.push({ kind: "drop", componentId, reason: outcome.reason, count: outcome.count });
        this.notifyCircuitBreakersAlongPath(sourcePacket, componentId, "failure");
        return;
      case "terminate":
        this.lastStepEvents.push({
          kind: "terminate",
          componentId,
          revenue: outcome.revenue,
          latencySeconds: this.simTime - this.currentArrivalSpawnedAt,
          count: outcome.count,
        });
        this.notifyCircuitBreakersAlongPath(sourcePacket, componentId, "success");
        return;
      case "multi":
        for (const child of outcome.outcomes) this.applyOutcome(child, componentId, sourcePacket);
        return;
      case "split":
        this.mergeByParent.set(outcome.mergeKey, {
          expectedChildren: outcome.expectedChildren,
          receivedChildren: 0,
          accumulatedRevenue: 0,
          accumulatedCount: 0,
          ingressEdgeId: outcome.ingressEdgeId,
          preSplitRoute: [...outcome.preSplitRoute],
          originalSpawnedAt: this.currentArrivalSpawnedAt,
        });
        for (const emit of outcome.emit) {
          this.parentOfChild.set(emit.packet.id, outcome.mergeKey);
          this.activePackets.push(emit.packet);
        }
        return;
      case "respond": {
        const resp = outcome.responsePacket;
        // The response's initial edgeId is set by the responder to the request-leg
        // edge that just arrived. We retrace onto that edge's twin.
        const requestEdgeId = resp.edgeId;
        const twinId = this.connections.get(requestEdgeId)?.twinId;
        const twin = twinId ? this.connections.get(twinId) : undefined;
        if (!twin) {
          // Topology broken or origin already reached — fire delivery event at the responder.
          this.lastStepEvents.push({
            kind: "respond-delivered",
            componentId,
            revenue: outcome.revenueOnDelivery,
            latencySeconds: this.simTime - this.currentArrivalSpawnedAt,
            count: outcome.count,
          });
          return;
        }
        resp.edgeId = twin.id;
        resp.progress = 0;
        resp.speed = effectiveEdgeSpeed(twin, this.components);
        this.revenueByPacketId.set(resp.id, { revenue: outcome.revenueOnDelivery, count: outcome.count });
        this.activePackets.push(resp);
        this.notifyCircuitBreakersAlongPath(sourcePacket, componentId, "success");
        return;
      }
    }
  }

  /**
   * Walks the forward-direction packet's traversed path and notifies any
   * CircuitBreakerCapability along it. The path is derived from
   * `packet.route` (edges traversed before the current arrival) plus the
   * current ingress edge (`packet.edgeId`) — mapping each edge to its
   * upstream `from.componentId`. Deduplicates by component id and skips the
   * component where the outcome was produced (`selfComponentId`) to avoid
   * self-reporting when a CB itself drops a packet while OPEN.
   *
   * Duck-types via `reportFailure` + `reportSuccess` to keep this decoupled
   * from CircuitBreakerCapability's concrete type.
   */
  private notifyCircuitBreakersAlongPath(
    packet: Packet,
    selfComponentId: ComponentId,
    kind: "failure" | "success",
  ): void {
    const visited = new Set<ComponentId>();
    visited.add(selfComponentId);
    const edges: ConnectionId[] = [...packet.route, packet.edgeId];
    for (let i = edges.length - 1; i >= 0; i--) {
      const edgeId = edges[i]!;
      const conn = this.connections.get(edgeId);
      if (!conn) continue;
      const upstreamId = conn.from.componentId;
      if (visited.has(upstreamId)) continue;
      visited.add(upstreamId);
      const comp = this.components.get(upstreamId);
      if (!comp) continue;
      for (const cap of comp.capabilities) {
        const maybeCB = cap as unknown as {
          reportFailure?: (tick: number) => void;
          reportSuccess?: () => void;
        };
        if (typeof maybeCB.reportFailure !== "function") continue;
        if (typeof maybeCB.reportSuccess !== "function") continue;
        if (kind === "failure") {
          maybeCB.reportFailure(this.simTime);
        } else {
          maybeCB.reportSuccess();
        }
      }
    }
  }

  private pullFromWorkers(dt: number): void {
    for (const comp of this.components.values()) {
      for (const cap of comp.capabilities) {
        if (cap instanceof WorkerCapability) {
          cap.refillPull(dt);
          while (true) {
            const pulled = cap.tryPullOne();
            if (!pulled) break;
            this.lastStepEvents.push({
              kind: "terminate",
              componentId: comp.id,
              revenue: cap.opts.revenuePerItem * pulled.requests.length,
              latencySeconds: this.simTime - pulled.spawnedAt,
              count: pulled.requests.length,
            });
          }
        }
      }
    }
  }

  mintPacketId = mintPacketId;
  mintRequestId = mintRequestId;
}

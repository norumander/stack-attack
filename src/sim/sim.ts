import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { ArrivalContext, Outcome, Packet, PacketId, SimEvent } from "./types";
import type { SimComponent } from "./component";
import type { SimConnection } from "./connection";
import { makeSimRng } from "./rng";
import { mintPacketId, mintRequestId } from "./packet";
import { advancePackets, collectArrivals } from "./edge-physics";

export type SimOptions = {
  readonly seed: number;
};

export class Sim {
  readonly components: Map<ComponentId, SimComponent> = new Map();
  readonly connections: Map<ConnectionId, SimConnection> = new Map();
  readonly activePackets: Packet[] = [];
  readonly lastStepEvents: SimEvent[] = [];
  simTime = 0;
  readonly rng: () => number;
  private readonly revenueByPacketId: Map<PacketId, number> = new Map();

  constructor(opts: SimOptions) {
    this.rng = makeSimRng(opts.seed);
  }

  addComponent(c: SimComponent): void {
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
    for (const c of this.components.values()) c.refillBucket(dt);
    advancePackets(this.activePackets, dt);
    const { arriving, remaining } = collectArrivals(this.activePackets);
    this.activePackets.length = 0;
    this.activePackets.push(...remaining);
    for (const packet of arriving) {
      this.dispatchArrival(packet);
    }
    this.simTime += dt;
  }

  private dispatchArrival(packet: Packet): void {
    const edge = this.connections.get(packet.edgeId);
    if (!edge) return;
    const component = this.components.get(edge.to.componentId);
    if (!component) return;
    const ctx: ArrivalContext = {
      componentId: component.id,
      ingressEdgeId: edge.id,
      simTime: this.simTime,
      rng: this.rng,
      mintPacketId: () => this.mintPacketId(),
      mintRequestId: () => this.mintRequestId(),
    };
    if (packet.direction === "forward") {
      const cap = component.capabilities[0];
      if (!cap) return;
      const outcome = cap.onArriveRequest(packet, ctx);
      this.applyOutcome(outcome, component.id);
    } else {
      for (const cap of component.capabilities) {
        cap.onArriveResponse?.(packet, ctx);
      }
      // Response just arrived at a component. Pop the route and retrace on next twin.
      const poppedEdgeId = packet.route.pop();
      if (poppedEdgeId === undefined) {
        // No upstream left — response has returned to origin.
        const revenue = this.revenueByPacketId.get(packet.id) ?? 0;
        this.revenueByPacketId.delete(packet.id);
        this.lastStepEvents.push({ kind: "respond-delivered", componentId: component.id, revenue });
        return;
      }
      const nextRequestEdgeId = packet.route[packet.route.length - 1];
      if (nextRequestEdgeId === undefined) {
        // Reached origin — route is now empty; response delivered.
        const revenue = this.revenueByPacketId.get(packet.id) ?? 0;
        this.revenueByPacketId.delete(packet.id);
        this.lastStepEvents.push({ kind: "respond-delivered", componentId: component.id, revenue });
        return;
      }
      const nextTwinId = this.connections.get(nextRequestEdgeId)?.twinId;
      const nextTwin = nextTwinId ? this.connections.get(nextTwinId) : undefined;
      if (!nextTwin) return;
      packet.edgeId = nextTwin.id;
      packet.progress = 0;
      packet.speed = nextTwin.speed;
      this.activePackets.push(packet);
    }
  }

  private applyOutcome(outcome: Outcome, componentId: ComponentId): void {
    switch (outcome.kind) {
      case "forward":
        for (const emit of outcome.emit) {
          this.activePackets.push(emit.packet);
        }
        return;
      case "drop":
        this.lastStepEvents.push({ kind: "drop", componentId, reason: outcome.reason, count: outcome.count });
        return;
      case "terminate":
        this.lastStepEvents.push({ kind: "terminate", componentId, revenue: outcome.revenue });
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
          this.lastStepEvents.push({ kind: "respond-delivered", componentId, revenue: outcome.revenueOnDelivery });
          return;
        }
        resp.edgeId = twin.id;
        resp.progress = 0;
        resp.speed = twin.speed;
        this.revenueByPacketId.set(resp.id, outcome.revenueOnDelivery);
        this.activePackets.push(resp);
        return;
      }
    }
  }

  mintPacketId = mintPacketId;
  mintRequestId = mintRequestId;
}

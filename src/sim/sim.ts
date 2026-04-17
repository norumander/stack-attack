import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { ArrivalContext, Outcome, Packet, SimEvent } from "./types";
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
      // Response-leg dispatch lives in Task 10.
      for (const cap of component.capabilities) {
        cap.onArriveResponse?.(packet, ctx);
      }
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
      case "respond":
        return; // Task 10
    }
  }

  mintPacketId = mintPacketId;
  mintRequestId = mintRequestId;
}

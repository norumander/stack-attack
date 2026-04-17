import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type QueueCapabilityOptions = {
  readonly capacity: number;
};

export class QueueCapability implements SimCapability {
  readonly id = "queue";
  readonly held: Packet[] = [];
  constructor(private readonly opts: QueueCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allAsync = packet.requests.every((r) => r.isAsync);
    if (!allAsync) {
      const egress = ctx.egressEdges[0];
      if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
      const child: Packet = {
        id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
        spawnedAt: ctx.simTime, parentId: packet.id, direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
    }
    if (this.held.length >= this.opts.capacity) {
      return { kind: "drop", reason: "queue_full", count: packet.requests.length };
    }
    this.held.push(packet);
    return { kind: "drop", reason: "held_in_queue", count: 0 };
  }
}

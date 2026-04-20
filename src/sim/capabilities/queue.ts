import type { ConnectionId } from "@core/types/ids";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type QueueCapabilityOptions = {
  readonly capacity: number;
};

export class QueueCapability implements SimCapability {
  readonly id = "queue";
  readonly held: Packet[] = [];
  /**
   * Edge IDs that lead to Worker components. Set by wireWorkers so the
   * Queue skips these when forwarding non-async traffic downstream.
   * Workers pull from the queue directly; they don't receive forwarded packets.
   */
  readonly workerEgressIds = new Set<ConnectionId>();

  constructor(private readonly opts: QueueCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allAsync = packet.requests.every((r) => r.isAsync);
    if (!allAsync) {
      const egress = ctx.egressEdges.find((e) => !this.workerEgressIds.has(e.id));
      if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
      const child: Packet = {
        id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
        spawnedAt: packet.spawnedAt, parentId: packet.id, direction: "forward",
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

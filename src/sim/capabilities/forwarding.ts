import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

/**
 * Stage A: forwards a packet onto the first egress edge. Emits one child
 * with the route appended. Drops `no_egress` if the component has no
 * forward-direction egress edges.
 *
 * When the host component has a capacity bucket (e.g. rate-limited Server),
 * consumes credits equal to the packet's request count; overflow drops as
 * "overloaded". This is what makes the Server's `capacityPerSecond: 30`
 * actually bite on the forward leg — without it, scale-out (LB + 2 servers)
 * would be indistinguishable from a single Server in sim throughput.
 */
export class ForwardingCapability implements SimCapability {
  readonly id = "forwarding";

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const egress = ctx.egressEdges[0];
    if (!egress) {
      return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    }
    const count = packet.requests.length;
    if (ctx.bucket && !ctx.bucket.tryConsume(count)) {
      return { kind: "drop", reason: "overloaded", count };
    }
    const child: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: egress.id,
      progress: 0,
      speed: egress.speed,
      spawnedAt: packet.spawnedAt,
      parentId: packet.id,
      direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }
}

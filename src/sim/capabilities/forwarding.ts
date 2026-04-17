import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

/**
 * Stage A: forwards a packet onto the first egress edge. Emits one child
 * with the route appended. Drops `no_egress` if the component has no
 * forward-direction egress edges.
 */
export class ForwardingCapability implements SimCapability {
  readonly id = "forwarding";

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const egress = ctx.egressEdges[0];
    if (!egress) {
      return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    }
    const child: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: egress.id,
      progress: 0,
      speed: egress.speed,
      spawnedAt: ctx.simTime,
      parentId: packet.id,
      direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
  }
}

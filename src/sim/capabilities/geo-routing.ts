import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

/**
 * GeoRoutingCapability — picks egress whose target component is in the
 * packet's originZone. If no match, drops `no_zone_match`.
 */
export class GeoRoutingCapability implements SimCapability {
  readonly id = "geo-routing";

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const firstZone = packet.requests[0]?.originZone ?? null;
    if (firstZone === null) {
      return { kind: "drop", reason: "no_origin_zone", count: packet.requests.length };
    }
    const match = ctx.egressEdges.find((e) => e.targetZone === firstZone);
    if (!match) {
      return { kind: "drop", reason: "no_zone_match", count: packet.requests.length };
    }
    const child: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: match.id,
      progress: 0,
      speed: match.speed,
      spawnedAt: packet.spawnedAt,
      parentId: packet.id,
      direction: "forward",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return { kind: "forward", emit: [{ edgeId: match.id, packet: child }] };
  }
}

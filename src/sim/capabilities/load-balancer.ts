import type { ConnectionId } from "@core/types/ids";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

/**
 * LoadBalancerCapability — always splits the batch across all healthy
 * forward egresses. Children get Math.floor(N/K) requests each; leftover
 * remainder is round-robin'd to the first `N mod K` children.
 */
export class LoadBalancerCapability implements SimCapability {
  readonly id = "load-balancer";

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const egresses = ctx.egressEdges;
    if (egresses.length === 0) {
      return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    }
    const total = packet.requests.length;
    if (egresses.length === 1) {
      const egress = egresses[0]!;
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
    const base = Math.floor(total / egresses.length);
    const remainder = total % egresses.length;
    const children: { edgeId: ConnectionId; packet: Packet }[] = [];
    let offset = 0;
    for (let i = 0; i < egresses.length; i += 1) {
      const egress = egresses[i]!;
      const take = base + (i < remainder ? 1 : 0);
      if (take === 0) continue;
      const chunk = packet.requests.slice(offset, offset + take);
      offset += take;
      const child: Packet = {
        id: ctx.mintPacketId(),
        requests: chunk,
        edgeId: egress.id,
        progress: 0,
        speed: egress.speed,
        spawnedAt: packet.spawnedAt,
        parentId: packet.id,
        direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      children.push({ edgeId: egress.id, packet: child });
    }
    return {
      kind: "split",
      emit: children,
      mergeKey: packet.id,
      expectedChildren: children.length,
      ingressEdgeId: ctx.ingressEdgeId,
      preSplitRoute: [...packet.route],
    };
  }
}

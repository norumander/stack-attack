import type { ConnectionId } from "@core/types/ids";
import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

/**
 * LoadBalancerCapability — spreads incoming request batches across all
 * healthy forward egresses using L4-style round-robin.
 *
 * Semantics:
 * - Each arriving packet's `requests` array is chunked across all K egresses.
 *   Every egress receives `floor(N/K)` requests, and the first `N mod K`
 *   egresses each get one extra.
 * - The "first" egress rotates per arrival via a per-LB counter (`rrCursor`)
 *   so that when `N < K` (e.g. a 1-request packet into a 3-server cluster)
 *   successive packets visit different egresses. Without rotation, the
 *   remainder always landed on egresses[0..N%K) and the last egresses
 *   starved — breaking the scale-out / redundancy / autoscale lessons that
 *   rely on all cluster members taking load evenly.
 *
 * Chose round-robin over least-loaded because:
 * - it models a real L4 LB (HAProxy `roundrobin`, AWS NLB) which is the
 *   mental model the game teaches;
 * - it is deterministic under a fixed seed (important for playtest replay);
 * - it requires no cross-component health/util probing, keeping the
 *   capability local to the `onArriveRequest` path.
 */
export class LoadBalancerCapability implements SimCapability {
  readonly id = "load-balancer";
  private rrCursor = 0;

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
    const K = egresses.length;
    const base = Math.floor(total / K);
    const remainder = total % K;
    // Rotate the start offset so successive packets don't always pile the
    // remainder onto egresses[0..remainder). Advance by one per call.
    const startOffset = this.rrCursor % K;
    this.rrCursor = (this.rrCursor + 1) % K;

    const children: { edgeId: ConnectionId; packet: Packet }[] = [];
    let reqOffset = 0;
    for (let i = 0; i < K; i += 1) {
      const egressIdx = (startOffset + i) % K;
      const egress = egresses[egressIdx]!;
      // The first `remainder` egresses in rotated order get the extra request.
      const take = base + (i < remainder ? 1 : 0);
      if (take === 0) continue;
      const chunk = packet.requests.slice(reqOffset, reqOffset + take);
      reqOffset += take;
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
    if (children.length === 1) {
      // N < K and only one egress receives the (single) request this packet.
      // Emit as a plain forward so the sim doesn't install an unnecessary
      // merge barrier (splits expect ≥2 children in practice and the merge
      // path is heavier than forward).
      return { kind: "forward", emit: children };
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

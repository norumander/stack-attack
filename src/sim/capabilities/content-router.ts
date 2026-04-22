import type { ConnectionId } from "@core/types/ids";
import type { ArrivalContext, Outcome, Packet, Request, SimCapability } from "../types";

/**
 * ContentRouterCapability -- content-aware routing by request type.
 *
 * Inspects each request's attributes and routes to the appropriate
 * downstream egress:
 *   - `stream`       -> egress with role "streaming"
 *   - `isLarge`      -> egress with role "cdn"
 *   - `requiresAuth` -> egress with role "gateway"
 *   - everything else -> first egress with role "default"
 *
 * If no matching egress exists for a request type, it falls through to
 * the default egress.  If NO egress exists at all, drop with "no_egress".
 *
 * After sim wiring, call `wireContentRouters(sim, componentTypes)` to
 * populate `egressRoles` from the live connection graph.
 */
export class ContentRouterCapability implements SimCapability {
  readonly id = "content-router";

  /**
   * Map from egress ConnectionId -> role string.
   * Populated by `wireContentRouters` after connections are set up.
   * Roles: "streaming" | "cdn" | "gateway" | "default"
   */
  readonly egressRoles = new Map<ConnectionId, string>();

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    if (ctx.egressEdges.length === 0) {
      return { kind: "drop", reason: "no_egress", count: packet.requests.length };
    }

    // Classify each egress by role.
    const streamEgress = ctx.egressEdges.find(
      (e) => this.egressRoles.get(e.id) === "streaming",
    );
    const cdnEgress = ctx.egressEdges.find(
      (e) => this.egressRoles.get(e.id) === "cdn",
    );
    const gatewayEgress = ctx.egressEdges.find(
      (e) => this.egressRoles.get(e.id) === "gateway",
    );
    const defaultEgress =
      ctx.egressEdges.find(
        (e) => this.egressRoles.get(e.id) === "default" || !this.egressRoles.has(e.id),
      ) ?? ctx.egressEdges[0]!;

    // Bucket each request by target egress.
    type EgressEdge = (typeof ctx.egressEdges)[number];
    const buckets = new Map<EgressEdge, Request[]>();
    for (const r of packet.requests) {
      let target: EgressEdge = defaultEgress;
      if (r.stream !== undefined && streamEgress) target = streamEgress;
      else if (r.isLarge && cdnEgress) target = cdnEgress;
      else if (r.requiresAuth && gatewayEgress) target = gatewayEgress;

      let bucket = buckets.get(target);
      if (!bucket) {
        bucket = [];
        buckets.set(target, bucket);
      }
      bucket.push(r);
    }

    // Single egress used -- simple forward.
    if (buckets.size === 1) {
      const entry = [...buckets.entries()][0]!;
      const [egress, requests] = entry;
      const child: Packet = {
        id: ctx.mintPacketId(),
        requests,
        edgeId: egress!.id,
        progress: 0,
        speed: egress!.speed,
        spawnedAt: packet.spawnedAt,
        parentId: packet.id,
        direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: egress!.id, packet: child }] };
    }

    // Multiple egresses -- split.
    const children: Array<{ edgeId: ConnectionId; packet: Packet }> = [];
    for (const [egress, requests] of buckets) {
      children.push({
        edgeId: egress!.id,
        packet: {
          id: ctx.mintPacketId(),
          requests,
          edgeId: egress!.id,
          progress: 0,
          speed: egress!.speed,
          spawnedAt: packet.spawnedAt,
          parentId: packet.id,
          direction: "forward",
          route: [...packet.route, ctx.ingressEdgeId],
        },
      });
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

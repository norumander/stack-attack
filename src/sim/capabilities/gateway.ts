import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type GatewayCapabilityOptions = {
  readonly revenuePerAuth: number;
};

export class GatewayCapability implements SimCapability {
  readonly id = "gateway";
  constructor(private readonly opts: GatewayCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allAuth = packet.requests.every((r) => r.requiresAuth);
    const noneAuth = packet.requests.every((r) => !r.requiresAuth);
    if (allAuth) {
      return { kind: "terminate", revenue: this.opts.revenuePerAuth * packet.requests.length };
    }
    if (noneAuth) {
      const egress = ctx.egressEdges[0];
      if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
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
    throw new Error("GatewayCapability: mixed auth/non-auth packet");
  }
}

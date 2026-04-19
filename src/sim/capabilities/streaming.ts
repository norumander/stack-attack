import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type StreamingCapabilityOptions = {
  readonly revenuePerStream: number;
};

/**
 * StreamingCapability — terminates stream requests with revenue after
 * reserving bandwidth on the ingress edge for the stream duration. If
 * reservation fails, drops `bandwidth_saturated`. Non-stream packets pass
 * through to first egress.
 */
export class StreamingCapability implements SimCapability {
  readonly id = "streaming";
  constructor(private readonly opts: StreamingCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const allStream = packet.requests.every((r) => r.stream !== undefined);
    const noneStream = packet.requests.every((r) => r.stream === undefined);
    if (!allStream && !noneStream) throw new Error("StreamingCapability: mixed stream/non-stream");
    if (noneStream) {
      const egress = ctx.egressEdges[0];
      if (!egress) return { kind: "drop", reason: "no_egress", count: packet.requests.length };
      const child: Packet = {
        id: ctx.mintPacketId(), requests: packet.requests, edgeId: egress.id, progress: 0, speed: egress.speed,
        spawnedAt: packet.spawnedAt, parentId: packet.id, direction: "forward",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      return { kind: "forward", emit: [{ edgeId: egress.id, packet: child }] };
    }
    const totalBandwidth = packet.requests.reduce((acc, r) => acc + (r.stream?.bandwidth ?? 0), 0);
    const maxDuration = Math.max(...packet.requests.map((r) => r.stream?.duration ?? 0));
    const ok = ctx.reserveBandwidth?.(ctx.ingressEdgeId, totalBandwidth, maxDuration) ?? false;
    if (!ok) return { kind: "drop", reason: "bandwidth_saturated", count: packet.requests.length };
    return { kind: "terminate", revenue: this.opts.revenuePerStream * packet.requests.length, count: packet.requests.length };
  }
}

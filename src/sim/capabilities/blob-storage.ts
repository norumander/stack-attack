import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type BlobStorageCapabilityOptions = {
  readonly revenuePerWrite: number;
  readonly revenuePerRead: number;
  readonly revenuePerStream: number;
};

/**
 * Terminal object/blob store. Accepts large_payload requests (isLarge) and
 * stream_data requests (stream !== undefined). Rejects anything else with a
 * drop of reason "unsupported".
 *
 * Revenue model mirrors ProcessingCapability for large reads/writes and
 * StreamingCapability for streams:
 *  - Large writes → terminate with revenuePerWrite × count
 *  - Large reads  → respond with revenuePerRead × count (retrace via twin)
 *  - Streams      → reserve ingress bandwidth, then terminate with
 *                   revenuePerStream × count; drop bandwidth_saturated on fail
 *
 * Packets are assumed uniform (traffic-source guarantees this). Mixed
 * large/stream or mixed write/read packets throw to surface bugs early.
 * Capacity bucket is consumed by request count; overflow drops "overloaded".
 */
export class BlobStorageCapability implements SimCapability {
  readonly id = "blob_storage";
  constructor(private readonly opts: BlobStorageCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const count = packet.requests.length;
    const allStream = packet.requests.every((r) => r.stream !== undefined);
    const noneStream = packet.requests.every((r) => r.stream === undefined);
    if (!allStream && !noneStream) {
      throw new Error("BlobStorageCapability: mixed stream/non-stream packet");
    }

    if (allStream) {
      if (ctx.bucket && !ctx.bucket.tryConsume(count)) {
        return { kind: "drop", reason: "overloaded", count };
      }
      const totalBandwidth = packet.requests.reduce(
        (acc, r) => acc + (r.stream?.bandwidth ?? 0),
        0,
      );
      const maxDuration = Math.max(
        ...packet.requests.map((r) => r.stream?.duration ?? 0),
      );
      const ok =
        ctx.reserveBandwidth?.(ctx.ingressEdgeId, totalBandwidth, maxDuration) ??
        false;
      if (!ok) return { kind: "drop", reason: "bandwidth_saturated", count };
      return {
        kind: "terminate",
        revenue: this.opts.revenuePerStream * count,
        count,
      };
    }

    // Non-stream path: must be a large_payload packet to be accepted.
    const allLarge = packet.requests.every((r) => r.isLarge);
    if (!allLarge) {
      return { kind: "drop", reason: "unsupported", count };
    }
    const anyWrite = packet.requests.some((r) => r.isWrite);
    const anyRead = packet.requests.some((r) => !r.isWrite);
    if (anyWrite && anyRead) {
      throw new Error("BlobStorageCapability: mixed write/read packet");
    }
    if (ctx.bucket && !ctx.bucket.tryConsume(count)) {
      return { kind: "drop", reason: "overloaded", count };
    }
    if (anyWrite) {
      return {
        kind: "terminate",
        revenue: this.opts.revenuePerWrite * count,
        count,
      };
    }
    const response: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: packet.edgeId,
      progress: 0,
      speed: packet.speed,
      spawnedAt: packet.spawnedAt,
      parentId: packet.id,
      direction: "back",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return {
      kind: "respond",
      responsePacket: response,
      revenueOnDelivery: this.opts.revenuePerRead * count,
      count,
    };
  }
}

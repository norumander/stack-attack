import type { ArrivalContext, Outcome, Packet, SimCapability } from "../types";

export type ProcessingCapabilityOptions = {
  readonly revenuePerWrite: number;
  readonly revenuePerRead: number;
};

/**
 * Stage A: terminates writes, responds to reads. Consumes capacity equal
 * to the packet's request count. Packets must be uniform (all-writes or
 * all-reads); mixed packets throw — wave generation produces uniform packets.
 */
export class ProcessingCapability implements SimCapability {
  readonly id = "processing";
  constructor(private readonly opts: ProcessingCapabilityOptions) {}

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const anyWrite = packet.requests.some((r) => r.isWrite);
    const anyRead = packet.requests.some((r) => !r.isWrite);
    if (anyWrite && anyRead) {
      throw new Error("ProcessingCapability: mixed write/read packet");
    }
    const count = packet.requests.length;
    if (ctx.bucket && !ctx.bucket.tryConsume(count)) {
      return { kind: "drop", reason: "overloaded", count };
    }
    if (anyWrite) {
      return { kind: "terminate", revenue: this.opts.revenuePerWrite * count };
    }
    // Read: generate response that retraces via route.
    const response: Packet = {
      id: ctx.mintPacketId(),
      requests: packet.requests,
      edgeId: packet.edgeId, // sim's applyOutcome.respond uses this as the request-leg edge whose twin to take
      progress: 0,
      speed: packet.speed,   // overwritten by sim with twin.speed
      spawnedAt: ctx.simTime,
      parentId: packet.id,
      direction: "back",
      route: [...packet.route, ctx.ingressEdgeId],
    };
    return {
      kind: "respond",
      responsePacket: response,
      revenueOnDelivery: this.opts.revenuePerRead * count,
    };
  }
}

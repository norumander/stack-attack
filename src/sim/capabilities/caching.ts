import type { ArrivalContext, Outcome, Packet, SimCapability, Request } from "../types";

export type CachingCapabilityOptions = {
  readonly capacity: number;
  readonly revenuePerRead: number;
};

/**
 * Stage A cache: key-keyed LRU slots. On read arrival, partitions requests
 * into hits (respond locally) and misses (forward to first egress). Writes
 * forward to first egress (invalidation is Stage C).
 *
 * Response-leg: when a response traverses back through this cache, populate
 * its requests' keys into slots (LRU eviction if over capacity).
 */
export class CachingCapability implements SimCapability {
  readonly id = "caching";
  private readonly slots: string[] = []; // front (index 0) = most recent

  constructor(private readonly opts: CachingCapabilityOptions) {}

  hasKey(k: string): boolean {
    return this.slots.includes(k);
  }

  __preloadForTest(keys: readonly string[]): void {
    // Keys provided in insertion order (first = oldest). We unshift each so
    // the first key lands at the tail (LRU) and the last at the front (MRU).
    for (const k of keys) this.slots.unshift(k);
  }

  __touchForTest(key: string): void {
    this.lookupAndTouch(key);
  }

  __populateForTest(key: string): void {
    this.populate(key);
  }

  private lookupAndTouch(key: string): boolean {
    const idx = this.slots.indexOf(key);
    if (idx === -1) return false;
    this.slots.splice(idx, 1);
    this.slots.unshift(key);
    return true;
  }

  private populate(key: string): void {
    const idx = this.slots.indexOf(key);
    if (idx !== -1) {
      this.slots.splice(idx, 1);
      this.slots.unshift(key);
      return;
    }
    this.slots.unshift(key);
    if (this.slots.length > this.opts.capacity) {
      this.slots.pop();
    }
  }

  onArriveRequest(packet: Packet, ctx: ArrivalContext): Outcome {
    const hits: Request[] = [];
    const misses: Request[] = [];
    for (const r of packet.requests) {
      if (r.isWrite) {
        misses.push(r);
        continue;
      }
      if (this.lookupAndTouch(r.key)) hits.push(r);
      else misses.push(r);
    }
    const outcomes: Outcome[] = [];
    if (hits.length > 0) {
      const response: Packet = {
        id: ctx.mintPacketId(),
        requests: hits,
        edgeId: packet.edgeId,
        progress: 0,
        speed: packet.speed,
        spawnedAt: ctx.simTime,
        parentId: packet.id,
        direction: "back",
        route: [...packet.route, ctx.ingressEdgeId],
      };
      outcomes.push({
        kind: "respond",
        responsePacket: response,
        revenueOnDelivery: this.opts.revenuePerRead * hits.length,
      });
    }
    if (misses.length > 0) {
      const egress = ctx.egressEdges[0];
      if (!egress) {
        outcomes.push({ kind: "drop", reason: "no_egress", count: misses.length });
      } else {
        const child: Packet = {
          id: ctx.mintPacketId(),
          requests: misses,
          edgeId: egress.id,
          progress: 0,
          speed: egress.speed,
          spawnedAt: ctx.simTime,
          parentId: packet.id,
          direction: "forward",
          route: [...packet.route, ctx.ingressEdgeId],
        };
        outcomes.push({ kind: "forward", emit: [{ edgeId: egress.id, packet: child }] });
      }
    }
    if (outcomes.length === 1) return outcomes[0]!;
    if (outcomes.length === 0) return { kind: "drop", reason: "empty_request", count: 0 };
    return { kind: "multi", outcomes };
  }

  onArriveResponse(packet: Packet, _ctx: ArrivalContext): void {
    for (const r of packet.requests) {
      if (!r.isWrite) this.populate(r.key);
    }
  }
}

import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { Packet } from "./types";
import type { SimComponent } from "./component";
import type { SimConnection } from "./connection";
import { makeSimRng } from "./rng";
import { mintPacketId, mintRequestId } from "./packet";

export type SimOptions = {
  readonly seed: number;
};

export class Sim {
  readonly components: Map<ComponentId, SimComponent> = new Map();
  readonly connections: Map<ConnectionId, SimConnection> = new Map();
  readonly activePackets: Packet[] = [];
  simTime = 0;
  readonly rng: () => number;

  constructor(opts: SimOptions) {
    this.rng = makeSimRng(opts.seed);
  }

  addComponent(c: SimComponent): void {
    this.components.set(c.id, c);
  }

  addConnection(c: SimConnection): void {
    this.connections.set(c.id, c);
  }

  spawnPacket(p: Packet): void {
    this.activePackets.push(p);
  }

  step(dt: number): void {
    // Stage A wiring: refill buckets, advance packets, fire arrivals.
    // Filled in across Tasks 6–10. Stub for empty test.
    for (const c of this.components.values()) c.refillBucket(dt);
    this.simTime += dt;
  }

  mintPacketId = mintPacketId;
  mintRequestId = mintRequestId;
}

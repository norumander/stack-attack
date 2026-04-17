import type { ArrivalContext, Outcome, Packet } from "./types";
import type { SimComponent } from "./component";
import type { SimConnection } from "./connection";

/**
 * Advance all in-flight packets by speed × dt. Packets with progress ≥ 1
 * are eligible for arrival processing in the next phase.
 */
export function advancePackets(packets: readonly Packet[], dt: number): void {
  for (const p of packets) {
    p.progress += p.speed * dt;
  }
}

export type ArrivalHandler = (
  packet: Packet,
  ctx: ArrivalContext,
  component: SimComponent,
  edge: SimConnection,
) => Outcome;

/**
 * Partition activePackets into (arriving, stillInFlight) deterministically.
 * Arriving packets are those with progress ≥ 1, sorted by packet.id
 * to make capacity competition deterministic.
 */
export function collectArrivals(
  packets: readonly Packet[],
): { arriving: Packet[]; remaining: Packet[] } {
  const arriving: Packet[] = [];
  const remaining: Packet[] = [];
  for (const p of packets) {
    if (p.progress >= 1) arriving.push(p);
    else remaining.push(p);
  }
  arriving.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { arriving, remaining };
}

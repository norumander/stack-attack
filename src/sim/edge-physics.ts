import type { Packet } from "./types";

/**
 * Advance all in-flight packets by speed × dt. Packets with progress ≥ 1
 * are eligible for arrival processing in the next phase.
 */
export function advancePackets(packets: readonly Packet[], dt: number): void {
  for (const p of packets) {
    p.progress += p.speed * dt;
  }
}

export interface ZoneTopology {
  readonly zones: readonly string[];
  readonly pairLatency: ReadonlyMap<string, number>;
}

export function zonePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function getZonePairLatency(
  topology: ZoneTopology,
  a: string | null,
  b: string | null,
): number {
  if (a === null || b === null || a === b) return 0;
  return topology.pairLatency.get(zonePairKey(a, b)) ?? 0;
}

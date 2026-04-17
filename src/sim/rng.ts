/**
 * Deterministic LCG matching the existing tests/harness/td-fixtures.ts
 * algorithm. Any two calls with the same seed produce identical sequences.
 * All sim randomness (attribute rolls, key rolls, random-pick, LRU ties)
 * must draw from this single source per sim instance.
 */
export function makeSimRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

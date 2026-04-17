export type ZipfOptions = {
  readonly alpha: number;
  readonly spaceSize: number;
};

/**
 * Returns a function that, given a uniform sample u ∈ [0, 1), returns an
 * integer key in [0, spaceSize) drawn from a Zipfian distribution with
 * parameter alpha. Implementation: precompute the CDF and binary-search
 * the uniform sample.
 */
export function makeZipfSampler(opts: ZipfOptions): (uniform: number) => number {
  const { alpha, spaceSize } = opts;
  const weights: number[] = new Array(spaceSize);
  let totalWeight = 0;
  for (let i = 0; i < spaceSize; i += 1) {
    const w = 1 / Math.pow(i + 1, alpha);
    weights[i] = w;
    totalWeight += w;
  }
  const cdf: number[] = new Array(spaceSize);
  let acc = 0;
  for (let i = 0; i < spaceSize; i += 1) {
    acc += weights[i]! / totalWeight;
    cdf[i] = acc;
  }
  return (uniform: number): number => {
    let lo = 0;
    let hi = spaceSize - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (uniform < cdf[mid]!) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
}

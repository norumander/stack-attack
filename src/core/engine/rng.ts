export interface DeterministicRng {
  next(): number;
  nextInt(maxExclusive: number): number;
  fork(purposeTag: string): DeterministicRng;
}

function hashSeed(s: string): bigint {
  // FNV-1a 64-bit
  let h = 0xcbf29ce484222325n;
  const P = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * P) & 0xffffffffffffffffn;
  }
  return h === 0n ? 0x9e3779b97f4a7c15n : h;
}

function splitmix64Next(stateRef: { s: bigint }): number {
  stateRef.s = (stateRef.s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  let z = stateRef.s;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
  z = z ^ (z >> 31n);
  const top53 = Number(z >> 11n);
  return top53 / 2 ** 53;
}

class SplitMixRng implements DeterministicRng {
  private state: { s: bigint };
  constructor(private readonly seedString: string) {
    this.state = { s: hashSeed(seedString) };
  }
  next(): number {
    return splitmix64Next(this.state);
  }
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new Error("nextInt requires maxExclusive > 0");
    return Math.floor(this.next() * maxExclusive);
  }
  fork(purposeTag: string): DeterministicRng {
    return new SplitMixRng(`${this.seedString}|${purposeTag}`);
  }
}

export function createRng(seedString: string): DeterministicRng {
  return new SplitMixRng(seedString);
}

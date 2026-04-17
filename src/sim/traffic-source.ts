import type { ComponentId } from "@core/types/ids";
import type { Packet, Request } from "./types";
import type { WaveDef, WaveKeyDistribution } from "./wave";
import { makeZipfSampler } from "./zipf";
import { mintPacketId, mintRequestId } from "./packet";

export class TrafficSource {
  private readonly perPacketCount: number;
  private readonly sampleKey: (uniform: number) => number;

  constructor(
    private readonly wave: WaveDef,
    private readonly rng: () => number,
  ) {
    this.perPacketCount = Math.max(1, Math.round(wave.intensity / wave.packetRate));
    this.sampleKey = buildKeySampler(wave.keyDistribution);
  }

  generatePacketForTest(originClientId: ComponentId, simTime: number): Packet {
    const isWrite = this.rng() < this.wave.composition.writeRatio;
    const requiresAuth = this.rng() < this.wave.composition.authRatio;
    const isLarge = this.rng() < this.wave.composition.largeRatio;
    const isStream = this.rng() < this.wave.composition.streamRatio;
    const requests: Request[] = [];
    for (let i = 0; i < this.perPacketCount; i += 1) {
      const keyIdx = this.sampleKey(this.rng());
      requests.push({
        id: mintRequestId(),
        key: `k${keyIdx}`,
        isWrite,
        requiresAuth,
        isLarge,
        ...(isStream && this.wave.streamConfig ? { stream: this.wave.streamConfig } : {}),
        originClientId,
        originZone: null,
        spawnedAt: simTime,
      });
    }
    return {
      id: mintPacketId(),
      requests,
      edgeId: "" as Packet["edgeId"],
      progress: 0,
      speed: 0,
      spawnedAt: simTime,
      parentId: null,
      direction: "forward",
      route: [],
    };
  }
}

function buildKeySampler(kd: WaveKeyDistribution): (u: number) => number {
  if (kd.kind === "zipf") {
    return makeZipfSampler({ alpha: kd.alpha, spaceSize: kd.spaceSize });
  }
  return (u: number) => Math.floor(u * kd.spaceSize);
}

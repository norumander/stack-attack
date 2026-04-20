import type { ComponentId } from "@core/types/ids";
import type { Zone, StreamConfig } from "./types";

export type WaveComposition = {
  readonly writeRatio: number;
  readonly authRatio: number;
  readonly streamRatio: number;
  readonly largeRatio: number;
  readonly asyncRatio: number;
};

export type WaveKeyDistribution =
  | { readonly kind: "zipf"; readonly alpha: number; readonly spaceSize: number }
  | { readonly kind: "uniform"; readonly spaceSize: number };

export type WaveRevenue = {
  readonly perRead: number;
  readonly perWrite: number;
  readonly perAuth: number;
  readonly perStream: number;
  readonly perAsync: number;
};

export type WaveDef = {
  readonly intensity: number;
  readonly packetRate: number;
  readonly duration: number;
  readonly composition: WaveComposition;
  readonly keyDistribution: WaveKeyDistribution;
  readonly revenue: WaveRevenue;
  readonly streamConfig?: StreamConfig;
  readonly zoneDistribution?: ReadonlyMap<Zone, number>;
  readonly entryClients: ReadonlyArray<ComponentId>;
  /**
   * Seconds over which traffic ramps from 0 to full `packetRate`.
   * Gives caches and downstream components time to warm before peak load.
   * Defaults to 0 (instant full intensity).
   */
  readonly rampSeconds?: number;
};

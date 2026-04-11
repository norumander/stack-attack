import type { SandboxTrafficConfig } from "./sandbox-traffic-source.js";
import type { ComponentId } from "../../core/types/ids.js";

/**
 * Preset traffic configurations for common sandbox scenarios.
 *
 * Presets omit `targetEntryPointId` since that depends on the player's topology.
 * Use `SandboxModeController.addTrafficSourceFromPreset()` to create a source
 * from a preset with the target filled in.
 */

export type TrafficPresetName =
  | "steady-load"
  | "black-friday"
  | "gradual-ramp"
  | "flash-crowd"
  | "async-heavy"
  | "media-launch";

type PresetConfig = Omit<SandboxTrafficConfig, "targetEntryPointId">;

export const TRAFFIC_PRESETS: ReadonlyMap<TrafficPresetName, PresetConfig> = new Map<
  TrafficPresetName,
  PresetConfig
>([
  [
    "steady-load",
    {
      requestType: "api_read",
      intensity: 50,
      pattern: "steady",
      requestTypeDistribution: [
        { type: "api_read", weight: 60 },
        { type: "api_write", weight: 25 },
        { type: "static_asset", weight: 15 },
      ],
    },
  ],
  [
    "black-friday",
    {
      requestType: "api_read",
      intensity: 100,
      pattern: "spike",
      requestTypeDistribution: [
        { type: "api_read", weight: 40 },
        { type: "api_write", weight: 30 },
        { type: "static_asset", weight: 20 },
        { type: "auth_required", weight: 10 },
      ],
    },
  ],
  [
    "gradual-ramp",
    {
      requestType: "api_read",
      intensity: 200,
      pattern: "ramp",
      rampDuration: 100,
      requestTypeDistribution: [
        { type: "api_read", weight: 50 },
        { type: "api_write", weight: 30 },
        { type: "static_asset", weight: 20 },
      ],
    },
  ],
  [
    "flash-crowd",
    {
      requestType: "api_read",
      intensity: 80,
      pattern: "burst",
      requestTypeDistribution: [
        { type: "api_read", weight: 70 },
        { type: "static_asset", weight: 20 },
        { type: "stream", weight: 10 },
      ],
    },
  ],
  [
    "async-heavy",
    {
      requestType: "api_read",
      intensity: 60,
      pattern: "steady",
      requestTypeDistribution: [
        { type: "api_read", weight: 30 },
        { type: "api_write", weight: 20 },
        { type: "batch", weight: 30 },
        { type: "event", weight: 20 },
      ],
    },
  ],
  [
    "media-launch",
    {
      requestType: "stream",
      intensity: 120,
      pattern: "burst",
      requestTypeDistribution: [
        { type: "stream", weight: 50 },
        { type: "static_asset", weight: 30 },
        { type: "api_read", weight: 20 },
      ],
    },
  ],
]);

export function resolvePreset(
  presetName: TrafficPresetName,
  targetEntryPointId: ComponentId,
): SandboxTrafficConfig {
  const preset = TRAFFIC_PRESETS.get(presetName);
  if (!preset) {
    throw new Error(`Unknown traffic preset: "${presetName}"`);
  }
  return { ...preset, targetEntryPointId };
}

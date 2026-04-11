import type { ModeDefinition } from "../../core/mode/mode-definition.js";
import { SandboxModeController } from "./sandbox-mode-controller.js";

export { SandboxEconomy } from "./sandbox-economy.js";
export {
  SandboxTrafficSource,
  type SandboxTrafficConfig,
  type TrafficPattern,
  type RequestTypeWeight,
} from "./sandbox-traffic-source.js";
export {
  TRAFFIC_PRESETS,
  resolvePreset,
  type TrafficPresetName,
} from "./sandbox-traffic-presets.js";
export { SandboxModeController } from "./sandbox-mode-controller.js";

export const sandboxMode: ModeDefinition = {
  id: "sandbox",
  name: "Sandbox",
  description:
    "Full capability set unlocked. Configure traffic, trigger chaos, explore tradeoffs.",
  createController: () => new SandboxModeController(),
  hudSlot: null,
};

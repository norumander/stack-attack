import type { CapabilityId } from "../types/ids.js";
import type { ComponentReader } from "./component-reader.js";
import type { ModeController } from "../mode/mode-controller.js";

export function getEffectiveTier(
  component: ComponentReader,
  capabilityId: CapabilityId,
  modeController: ModeController,
): number {
  const playerTier = component.getPlayerTier(capabilityId);
  const modeCap = modeController.getTierCap(component, capabilityId);
  return Math.min(playerTier, modeCap);
}

export function computeEffectiveTiers(
  component: ComponentReader,
  modeController: ModeController,
): ReadonlyMap<CapabilityId, number> {
  const result = new Map<CapabilityId, number>();
  for (const capId of component.getCapabilityIds()) {
    result.set(capId, getEffectiveTier(component, capId, modeController));
  }
  return result;
}

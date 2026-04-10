// Stub — replaced in the mode-interfaces task with the full abstract interface.
import type { ComponentReader } from "../component/component-reader.js";
import type { CapabilityId } from "../types/ids.js";

export interface ModeController {
  getTierCap(component: ComponentReader, capabilityId: CapabilityId): number;
}

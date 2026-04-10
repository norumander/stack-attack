import type { ModeController } from "./mode-controller.js";

export interface ModeDefinition {
  id: string;
  name: string;
  description: string;
  createController: () => ModeController;
  // React.ComponentType pulled in from UI layer in a later stage — Phase 1 uses unknown.
  hudSlot: unknown;
}

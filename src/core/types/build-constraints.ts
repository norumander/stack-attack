import type { ComponentId } from "./ids.js";

export interface BuildConstraints {
  readonly availableComponentTypes: readonly string[];
  readonly maxPlacements?: number;
  readonly zoneAllowlist?: readonly string[];
}

export type PlacementResult =
  | { ok: true; componentId: ComponentId }
  | {
      ok: false;
      reason:
        | "insufficient_budget"
        | "invalid_position"
        | "invalid_zone"
        | "disallowed_by_mode"
        | "registry_unknown_type";
      detail?: string;
    };

export type UpgradeResult =
  | { ok: true; newPlayerTier: number }
  | {
      ok: false;
      reason:
        | "insufficient_budget"
        | "max_tier_reached"
        | "disallowed_by_mode"
        | "capability_not_found";
      detail?: string;
    };

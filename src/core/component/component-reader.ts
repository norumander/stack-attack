import type { CapabilityId, ComponentId } from "../types/ids.js";
import type { Port } from "../types/port.js";
import type { Position } from "../types/position.js";
import type { ConditionProfile } from "../types/condition.js";
import type { Capability } from "../capability/capability.js";

export interface ComponentReader {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly placementTick: number;
  readonly position: Readonly<Position>;
  readonly zone: string | null;
  readonly instanceCount: number;
  readonly condition: number;
  readonly conditionProfile: ConditionProfile;
  readonly minInstances: number;
  readonly maxInstances: number;

  getPlayerTier(capabilityId: CapabilityId): number;
  getCapabilityIds(): readonly CapabilityId[];
  getCapabilityByInterface<T>(
    predicate: (c: Capability) => c is Capability & T,
  ): (Capability & T) | null;
}

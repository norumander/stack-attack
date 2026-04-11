import type { CapabilityId, ComponentId, RequestId } from "../types/ids.js";
import type { DeterministicRng } from "../engine/rng.js";
import type { InstanceDirectory } from "./engine-interfaces.js";
import type { SimulationStateReader } from "../state/state-reader.js";
import type { ChildResponseSnapshot } from "../engine/blocked-parent.js";

export interface ProcessContext {
  readonly state: SimulationStateReader;
  readonly componentId: ComponentId;
  readonly effectiveTier: number;
  readonly effectiveTiers: ReadonlyMap<CapabilityId, number>;
  readonly activeCapabilityIds: ReadonlySet<CapabilityId>;
  readonly currentTick: number;
  readonly rng: DeterministicRng;
  readonly directories: readonly InstanceDirectory[];
  readonly childResponses: ReadonlyMap<RequestId, ChildResponseSnapshot>;
}

export interface PullContext {
  readonly state: SimulationStateReader;
  readonly componentId: ComponentId;
  readonly currentTick: number;
}

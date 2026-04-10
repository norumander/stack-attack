import type { ComponentReader } from "../component/component-reader.js";
import type { CapabilityId, ComponentId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { SimulationStateReader } from "../state/state-reader.js";

export interface EconomyStrategy {
  getBudget(): number;
  canAfford(cost: number): boolean;
  creditRevenue(request: Request): number;
  debitUpkeep(totalUpkeep: number): void;
  debitPlacement(component: ComponentReader): void;
  debitUpgrade(component: ComponentReader, capabilityId: CapabilityId): void;
  resolveInsolvency(state: SimulationStateReader): ComponentId[];
}

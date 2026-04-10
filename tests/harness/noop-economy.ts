import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { ComponentReader } from "@core/component/component-reader";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { SimulationStateReader } from "@core/state/state-reader";

export class NoOpEconomy implements EconomyStrategy {
  getBudget(): number {
    return Infinity;
  }
  canAfford(_cost: number): boolean {
    return true;
  }
  creditRevenue(_request: Request): number {
    return 0;
  }
  debitUpkeep(_totalUpkeep: number): void {
    /* noop */
  }
  debitPlacement(_component: ComponentReader): void {
    /* noop */
  }
  debitUpgrade(_component: ComponentReader, _capabilityId: CapabilityId): void {
    /* noop */
  }
  resolveInsolvency(_state: SimulationStateReader): ComponentId[] {
    return [];
  }
}

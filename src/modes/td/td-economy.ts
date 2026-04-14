import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { ComponentReader } from "@core/component/component-reader";
import type { Request } from "@core/types/request";
import type { SimulationStateReader } from "@core/state/state-reader";
import type { CapabilityId, ComponentId } from "@core/types/ids";

export interface TDEconomyOptions {
  readonly startingBudget: number;
  readonly revenuePerRequestType: ReadonlyMap<string, number>;
}

/**
 * TD-mode economy strategy. Stage 3a uses it mostly for ceremony — the
 * integration tests pass on drop rate, not budget. Ships the full
 * EconomyStrategy surface so later stages can add real budget pressure.
 */
export class TDEconomy implements EconomyStrategy {
  private budget: number;
  private readonly revenueTable: ReadonlyMap<string, number>;

  constructor(options: TDEconomyOptions) {
    this.budget = options.startingBudget;
    this.revenueTable = options.revenuePerRequestType;
  }

  getBudget(): number {
    return this.budget;
  }

  canAfford(cost: number): boolean {
    return this.budget >= cost;
  }

  creditRevenue(request: Request): number {
    const revenue = this.revenueTable.get(request.type) ?? 0;
    this.budget += revenue;
    return revenue;
  }

  debitUpkeep(totalUpkeep: number): void {
    this.budget -= totalUpkeep;
  }

  debitPlacement(component: ComponentReader): void {
    this.budget -= component.placementCost;
  }

  debitUpgrade(_component: ComponentReader, _capabilityId: CapabilityId): void {
    // No-op in Stage 3a. Upgrades are not exercised.
  }

  /**
   * Refund a placement cost when a component is removed during the build phase.
   * Additive: budget += amount.
   */
  creditRefund(amount: number): void {
    this.budget += amount;
  }

  resolveInsolvency(_state: SimulationStateReader): ComponentId[] {
    // Stage 3a does not kill components mid-wave. The wave-end assertion
    // checks final budget. Later stages will return components to kill.
    return [];
  }
}

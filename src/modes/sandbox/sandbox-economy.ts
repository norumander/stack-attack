import type { EconomyStrategy } from "../../core/mode/economy-strategy.js";
import type { ComponentReader } from "../../core/component/component-reader.js";
import type { CapabilityId, ComponentId } from "../../core/types/ids.js";
import type { Request } from "../../core/types/request.js";
import type { SimulationStateReader } from "../../core/state/state-reader.js";

const REVENUE_PER_REQUEST: Record<string, number> = {
  api_read: 1,
  api_write: 2,
  static_asset: 0.5,
  auth_required: 1.5,
  batch: 5,
  stream: 3,
  event: 1,
};
const DEFAULT_REVENUE = 1;

/**
 * Observation-only economy for Sandbox mode.
 *
 * Tracks all financial activity (revenue, upkeep, placement, upgrades)
 * for HUD display, but never constrains the player. Budget is always
 * Infinity; nothing is ever unaffordable; insolvency never triggers.
 */
export class SandboxEconomy implements EconomyStrategy {
  private _totalRevenue = 0;
  private _totalUpkeep = 0;
  private _totalPlacement = 0;
  private _totalUpgrade = 0;

  get totalRevenue(): number {
    return this._totalRevenue;
  }
  get totalUpkeep(): number {
    return this._totalUpkeep;
  }
  get totalPlacement(): number {
    return this._totalPlacement;
  }
  get totalUpgrade(): number {
    return this._totalUpgrade;
  }

  getBudget(): number {
    return Infinity;
  }

  canAfford(_cost: number): boolean {
    return true;
  }

  creditRevenue(request: Request): number {
    const amount = REVENUE_PER_REQUEST[request.type] ?? DEFAULT_REVENUE;
    this._totalRevenue += amount;
    return amount;
  }

  debitUpkeep(totalUpkeep: number): void {
    this._totalUpkeep += totalUpkeep;
  }

  debitPlacement(component: ComponentReader): void {
    this._totalPlacement += component.placementCost;
  }

  debitUpgrade(_component: ComponentReader, _capabilityId: CapabilityId): void {
    this._totalUpgrade += 1;
  }

  resolveInsolvency(_state: SimulationStateReader): ComponentId[] {
    return [];
  }
}

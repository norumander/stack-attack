import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { ComponentReader } from "@core/component/component-reader";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { SimulationStateReader } from "@core/state/state-reader";

export interface TestEconomyOpts {
  budget?: number;
  revenuePerRequest?: number | ((r: Request) => number);
  insolvencyRule?: (state: SimulationStateReader) => ComponentId[];
}

export class TestEconomyStrategy implements EconomyStrategy {
  budget: number;
  readonly creditLog: Array<{ requestId: RequestId; amount: number }> = [];
  readonly debitLog: number[] = [];
  private readonly revenueFn: (r: Request) => number;
  private readonly insolvencyFn: (state: SimulationStateReader) => ComponentId[];

  constructor(opts: TestEconomyOpts = {}) {
    this.budget = opts.budget ?? Infinity;
    const rev = opts.revenuePerRequest ?? 0;
    this.revenueFn = typeof rev === "function" ? rev : () => rev;
    this.insolvencyFn = opts.insolvencyRule ?? (() => []);
  }

  getBudget(): number {
    return this.budget;
  }

  canAfford(cost: number): boolean {
    return this.budget >= cost;
  }

  creditRevenue(request: Request): number {
    const amount = this.revenueFn(request);
    this.budget += amount;
    this.creditLog.push({ requestId: request.id, amount });
    return amount;
  }

  debitUpkeep(totalUpkeep: number): void {
    this.budget -= totalUpkeep;
    this.debitLog.push(totalUpkeep);
  }

  debitPlacement(_component: ComponentReader): void {
    /* noop in tests */
  }

  debitUpgrade(_component: ComponentReader, _capabilityId: CapabilityId): void {
    /* noop in tests */
  }

  resolveInsolvency(state: SimulationStateReader): ComponentId[] {
    return this.insolvencyFn(state);
  }
}

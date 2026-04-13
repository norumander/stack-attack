import { SimulationState } from "@core/state/simulation-state";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { ComponentRegistry } from "@core/registry/component-registry";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

/**
 * Deterministic LCG for test determinism. Seeded so two calls with the
 * same seed produce identical sequences across runs.
 */
export function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Fresh CapabilityRegistry + ComponentRegistry pair with TD defaults wired.
 * Used by every TD controller test that needs a real registry.
 */
export function bootTDRegistry(): ComponentRegistry {
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);
  return compRegistry;
}

export interface MakeTDControllerOptions {
  readonly waves?: readonly TDWaveDefinition[];
  readonly startingBudget?: number;
  readonly entryPointId?: ComponentId;
  readonly seed?: number;
  /** Pre-built registry. If omitted, bootTDRegistry() is called. */
  readonly compRegistry?: ComponentRegistry;
}

export interface TDControllerFixture {
  readonly state: SimulationState;
  readonly tdc: TDModeController;
  readonly economy: TDEconomy;
  readonly compRegistry: ComponentRegistry;
}

/**
 * Standard TD controller setup: fresh state, registry, economy, and
 * multi-wave controller. Call sites override pieces as needed.
 *
 * Defaults: waves=[WAVE_1,WAVE_2,WAVE_3], startingBudget=WAVE_1.startingBudget,
 * entryPointId="entry-stub", seed=1.
 */
export function makeTDController(
  opts: MakeTDControllerOptions = {},
): TDControllerFixture {
  const state = new SimulationState({
    zones: ["default"],
    pairLatency: new Map(),
  });
  const compRegistry = opts.compRegistry ?? bootTDRegistry();
  const waves = opts.waves ?? [WAVE_1, WAVE_2, WAVE_3];
  const economy = new TDEconomy({
    startingBudget: opts.startingBudget ?? WAVE_1.startingBudget,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  const tdc = new TDModeController({
    waves,
    economy,
    entryPointId: opts.entryPointId ?? ("entry-stub" as ComponentId),
    rng: makeRng(opts.seed ?? 1),
    componentRegistry: compRegistry,
  });
  return { state, tdc, economy, compRegistry };
}

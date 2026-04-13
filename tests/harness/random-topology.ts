import { SimulationState } from "@core/state/simulation-state";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import { TestForwardingCapability, RespondingCapability } from "@harness/test-capabilities";
import type { DeterministicRng } from "@core/engine/rng";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

export interface RandomTopology {
  readonly state: SimulationState;
  readonly entryComponentId: ComponentId;
  readonly componentIds: readonly ComponentId[];
  readonly chainLength: number;
}

/**
 * Build a deterministic random linear chain topology:
 *   entry (TestForwardingCapability)
 *   → mid1 (TestForwardingCapability)
 *   → ... → midN-1 (TestForwardingCapability)
 *   → tail (RespondingCapability)
 *
 * Chain length is drawn from rng.nextInt(maxChain - minChain + 1) + minChain.
 * All connections have bandwidth=100, latency=1.
 */
export function makeRandomTopology(
  rng: DeterministicRng,
  opts: { minChain?: number; maxChain?: number } = {},
): RandomTopology {
  const minChain = opts.minChain ?? 3;
  const maxChain = opts.maxChain ?? 6;
  const chainLength = minChain + rng.nextInt(maxChain - minChain + 1);

  const state = new SimulationState({ zones: [], pairLatency: new Map() });
  const ids: ComponentId[] = [];

  for (let i = 0; i < chainLength; i++) {
    const id = `c-${String(i).padStart(2, "0")}` as ComponentId;
    const isTail = i === chainLength - 1;
    const ports = [];
    if (i > 0) ports.push(makePort(`p-${i}-in`, "ingress"));
    if (!isTail) ports.push(makePort(`p-${i}-out`, "egress"));

    const capId = `cap-${i}` as CapabilityId;
    const cap: Capability = isTail
      ? new RespondingCapability(capId)
      : new TestForwardingCapability(capId);
    const caps = new Map<CapabilityId, Capability>([[capId, cap]]);
    const tiers = new Map<CapabilityId, number>([[capId, 1]]);

    const component = makeComponent({ id, ports, capabilities: caps, tiers });
    state.placeComponent(component);
    ids.push(id);
  }

  // Wire connections in order: 0→1, 1→2, ..., N-2→N-1.
  for (let i = 0; i < chainLength - 1; i++) {
    state.addConnection(
      makeConnection(
        `cx-${i}`,
        { componentId: ids[i]!, portId: `p-${i}-out` },
        { componentId: ids[i + 1]!, portId: `p-${i + 1}-in` },
        { bandwidth: 100, latency: 1 },
      ),
    );
  }

  return {
    state,
    entryComponentId: ids[0]!,
    componentIds: ids,
    chainLength,
  };
}

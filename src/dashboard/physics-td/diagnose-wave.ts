import type { Sim } from "@sim/sim";
import type { ComponentId } from "@core/types/ids";
import { ProcessingCapability } from "@sim/capabilities/processing";

export type Diagnosis = {
  readonly headline: string;
  readonly symptom: string;
  readonly hint: string | null;
};

export type DropTallyByComponent = Map<ComponentId, { total: number; byReason: Map<string, number> }>;

export type DiagnosisInput = {
  readonly sim: Sim;
  readonly wave: {
    readonly writeRatio: number;
    readonly hasReads: boolean;
    readonly hasStreams: boolean;
  };
  readonly perComponentDrops: DropTallyByComponent;
  readonly totalDrops: number;
  readonly totalProcessed: number;
};

function titleOf(componentId: ComponentId, sim: Sim): string {
  const comp = sim.components.get(componentId);
  if (!comp) return "Component";
  // Fall back to id when no displayable kind hint is available.
  return String(componentId);
}

function hasDownstreamProcessor(startId: ComponentId, sim: Sim): boolean {
  const visited = new Set<ComponentId>([startId]);
  const queue: ComponentId[] = [startId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const conn of sim.connections.values()) {
      if (conn.direction !== "forward") continue;
      if (conn.from.componentId !== cur) continue;
      const next = conn.to.componentId;
      if (visited.has(next)) continue;
      visited.add(next);
      const comp = sim.components.get(next);
      if (comp && comp.capabilities.some((c) => c instanceof ProcessingCapability)) {
        return true;
      }
      queue.push(next);
    }
  }
  return false;
}

function pickBottleneck(drops: DropTallyByComponent): { id: ComponentId; total: number; byReason: Map<string, number> } | null {
  let bestId: ComponentId | null = null;
  let bestTotal = 0;
  let bestByReason: Map<string, number> | null = null;
  for (const [id, tally] of drops) {
    if (tally.total > bestTotal) {
      bestId = id;
      bestTotal = tally.total;
      bestByReason = tally.byReason;
    }
  }
  if (!bestId || !bestByReason) return null;
  return { id: bestId, total: bestTotal, byReason: bestByReason };
}

export function diagnoseWave(input: DiagnosisInput): Diagnosis {
  const { sim, wave, perComponentDrops, totalDrops, totalProcessed } = input;
  const totalRequests = totalDrops + totalProcessed;
  const overallDropRate = totalRequests > 0 ? totalDrops / totalRequests : 0;

  const bottleneck = pickBottleneck(perComponentDrops);

  // ─── Branch 1: write routing gap ───────────────────────────────────
  if (wave.writeRatio > 0 && bottleneck) {
    const noEgressDrops = bottleneck.byReason.get("no_egress") ?? 0;
    const reasonShare = noEgressDrops / Math.max(1, bottleneck.total);
    if (reasonShare > 0.5 && !hasDownstreamProcessor(bottleneck.id, sim)) {
      const name = titleOf(bottleneck.id, sim);
      return {
        headline: `${name} has nowhere to write.`,
        symptom: `Writes arrived at ${name} but no downstream component accepts them. Writes dropped until the wave failed.`,
        hint: "Connect a Database (or another processor) downstream of the dropping component.",
      };
    }
  }

  // ─── Branch 2: component overload ──────────────────────────────────
  if (bottleneck) {
    const overloadDrops = bottleneck.byReason.get("overloaded") ?? 0;
    const reasonShare = overloadDrops / Math.max(1, bottleneck.total);
    if (reasonShare > 0.5) {
      const name = titleOf(bottleneck.id, sim);
      return {
        headline: `${name} is overwhelmed.`,
        symptom: `${name} processed at its capacity ceiling and shed ${Math.round(overallDropRate * 100)}% of wave traffic.`,
        hint: "Add a Data Cache upstream to absorb hot reads, scale horizontally with a Load Balancer, or reduce traffic before it reaches the bottleneck.",
      };
    }
  }

  // ─── Branch 3: default ─────────────────────────────────────────────
  return {
    headline: "Too many requests were dropped.",
    symptom: `This wave dropped ${Math.round(overallDropRate * 100)}% of requests. Inspect which component was under the most pressure.`,
    hint: null,
  };
}

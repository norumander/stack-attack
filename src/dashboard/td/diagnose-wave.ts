import type { TDWaveDefinition } from "@modes/td/td-waves.js";
import type { TickMetrics } from "@core/types/metrics.js";
import type { Component } from "@core/component/component.js";
import type { Connection } from "@core/types/connection.js";
import type { ComponentId, ConnectionId } from "@core/types/ids.js";
import { componentThroughputPerTick } from "@core/engine/throughput.js";

export interface Diagnosis {
  headline: string;
  symptom: string;
  hint: string | null;
}

export interface DiagnoseWaveArgs {
  wave: TDWaveDefinition;
  metrics: readonly TickMetrics[];
  components: ReadonlyMap<ComponentId, Component>;
  connections: ReadonlyMap<ConnectionId, Connection>;
}

function titleOf(type: string): string {
  if (!type) return "component";
  const spaced = type.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Walks the connection graph forward from `startId`, BFS, and reports
 * whether any reachable component has a capability that accepts
 * `requestType`. `startId` itself is excluded.
 */
function hasDownstreamAcceptor(
  startId: ComponentId,
  requestType: string,
  components: ReadonlyMap<ComponentId, Component>,
  connections: ReadonlyMap<ConnectionId, Connection>,
): boolean {
  const visited = new Set<ComponentId>([startId]);
  const queue: ComponentId[] = [startId];

  const outgoingByComponent = new Map<ComponentId, ComponentId[]>();
  for (const conn of connections.values()) {
    const src = conn.source.componentId;
    const tgt = conn.target.componentId;
    const list = outgoingByComponent.get(src) ?? [];
    list.push(tgt);
    outgoingByComponent.set(src, list);
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const outgoing = outgoingByComponent.get(cur) ?? [];
    for (const nxt of outgoing) {
      if (visited.has(nxt)) continue;
      visited.add(nxt);
      const comp = components.get(nxt);
      if (comp) {
        for (const cap of comp.capabilities.values()) {
          try {
            if (cap.canHandle(requestType)) return true;
          } catch {
            // Defensive: if a capability's canHandle throws (needs context),
            // treat it as "does not accept".
          }
        }
      }
      queue.push(nxt);
    }
  }
  return false;
}

export function diagnoseWave(args: DiagnoseWaveArgs): Diagnosis {
  const { wave, metrics, components, connections } = args;

  // Aggregate wave totals.
  let totalDropped = 0;
  let totalProcessed = 0;
  let totalTimedOut = 0;
  const cumulativeDropsByComponent = new Map<ComponentId, number>();

  for (const m of metrics) {
    totalDropped += m.requestsDropped;
    totalProcessed += m.requestsProcessed;
    totalTimedOut += m.requestsTimedOut;
    for (const [id, comp] of m.perComponent) {
      const prev = cumulativeDropsByComponent.get(id) ?? 0;
      cumulativeDropsByComponent.set(id, prev + comp.dropped);
    }
  }
  const totalRequests = totalProcessed + totalDropped + totalTimedOut;
  const overallDropRate = totalRequests > 0 ? totalDropped / totalRequests : 0;

  // Pick the bottleneck: component with the highest cumulative drops.
  let bottleneckId: ComponentId | null = null;
  let maxDrops = 0;
  for (const [id, drops] of cumulativeDropsByComponent) {
    if (drops > maxDrops) {
      maxDrops = drops;
      bottleneckId = id;
    }
  }
  const bottleneck = bottleneckId ? components.get(bottleneckId) ?? null : null;
  const bottleneckProcessed = bottleneckId
    ? metrics.reduce(
        (s, m) => s + (m.perComponent.get(bottleneckId)! ?? { processed: 0 }).processed,
        0,
      )
    : 0;
  const bottleneckTotal = maxDrops + bottleneckProcessed;
  const bottleneckDropRate = bottleneckTotal > 0 ? maxDrops / bottleneckTotal : 0;

  // ─── Branch 1: write routing gap ───────────────────────────────────
  const writeWeight = wave.composition.get("api_write") ?? 0;
  if (
    writeWeight > 0 &&
    bottleneck &&
    bottleneckId &&
    bottleneckDropRate > 0.10 &&
    !hasDownstreamAcceptor(bottleneckId, "api_write", components, connections)
  ) {
    const bname = titleOf(bottleneck.type);
    return {
      headline: `${bname} has nowhere to write.`,
      symptom:
        `Your ${bname.toLowerCase()} received write requests but no downstream component accepts them. ` +
        `Writes dropped until the bottleneck broke.`,
      hint:
        "Check which component in your palette persists data durably.",
    };
  }

  // ─── Branch 2: process throughput bottleneck ──────────────────────
  if (bottleneck && bottleneckId) {
    const cap = componentThroughputPerTick(bottleneck);
    if (cap > 0) {
      let saturatedStreak = 0;
      let maxStreak = 0;
      for (const m of metrics) {
        const comp = m.perComponent.get(bottleneckId);
        if (comp && comp.processed >= cap * 0.95) {
          saturatedStreak += 1;
          if (saturatedStreak > maxStreak) maxStreak = saturatedStreak;
        } else {
          saturatedStreak = 0;
        }
      }
      if (maxStreak >= 5 && overallDropRate > 0.05) {
        const bname = titleOf(bottleneck.type);
        const readWeight = wave.composition.get("api_read") ?? 0;
        const hint =
          bottleneck.type === "database" && readWeight > 0
            ? "Your Database is saturated on read traffic. Add a Data Cache between your Server and Database to absorb repeated reads, or scale horizontally."
            : "A single component can only do so much. Split the load or absorb reads before they reach it.";
        return {
          headline: `${bname} is overwhelmed.`,
          symptom:
            `Your ${bname.toLowerCase()} was processing at its throughput cap for ${maxStreak} consecutive ticks. ` +
            `Requests beyond the cap were shed — ${Math.round(overallDropRate * 100)}% of wave traffic dropped.`,
          hint,
        };
      }
    }
  }

  // ─── Branch 3: TTL timeouts ────────────────────────────────────────
  if (totalRequests > 0 && totalTimedOut / totalRequests > 0.10) {
    return {
      headline: "Requests are piling up faster than they can be served.",
      symptom:
        `${Math.round((totalTimedOut / totalRequests) * 100)}% of this wave's requests timed out while waiting. ` +
        `The queue built up faster than downstream could drain it.`,
      hint:
        "Time-to-live is ticking on every pending request. Widen the pipe or shed earlier.",
    };
  }

  // ─── Branch 4: default ─────────────────────────────────────────────
  return {
    headline: "Too many requests were dropped.",
    symptom: `This wave dropped ${Math.round(overallDropRate * 100)}% of requests. Check which component was under the most pressure.`,
    hint: null,
  };
}

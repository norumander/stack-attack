/**
 * Serializes live game state into the ChatRequest shape expected by the
 * `stack-attack-chat` edge function. Pure function — no side effects, no DOM,
 * no network — so it can be unit-tested against a small fixture Sim.
 */
import type { Sim } from "@sim/sim";
import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { ComponentId } from "@core/types/ids";
import type { ComponentMetricsAggregator } from "../physics-td/component-metrics";
import type {
  ChatHistoryMessage,
  ChatMode,
  ChatRecentEvent,
  ChatRequest,
  ChatTopology,
  ChatTopologyComponent,
  ChatWave,
  HintLevel,
} from "./chat-client";

export interface SerializeContextArgs {
  sim: Sim;
  wave: WaveDef;
  waveId: string;
  waveTitle: string;
  sla: SLAThresholds;
  /** Optional — if missing (pre-wave) utilization/drops will be omitted. */
  metricsAggregator: ComponentMetricsAggregator | null;
  componentTypes: Map<ComponentId, string>;
  componentLabels: Map<ComponentId, string | undefined>;
  mode: ChatMode;
  hintLevel: HintLevel;
  levelId: string | undefined;
  /** Current live metrics — caller passes the same numbers rendered in the HUD. */
  liveMetrics: {
    availability: number;
    avgLatencySeconds: number;
    dropRate: number;
    currentTickSeconds: number;
  };
  recentEvents: ChatRecentEvent[];
  conversationHistory: ChatHistoryMessage[];
  userMessage: string;
}

export function serializeContextForChat(args: SerializeContextArgs): ChatRequest {
  const chatWave: ChatWave = {
    id: args.waveId,
    title: args.waveTitle,
    intensity: args.wave.intensity,
    composition: {
      writeRatio: args.wave.composition.writeRatio,
      authRatio: args.wave.composition.authRatio,
      streamRatio: args.wave.composition.streamRatio,
      largeRatio: args.wave.composition.largeRatio,
      asyncRatio: args.wave.composition.asyncRatio,
    },
    duration: args.wave.duration,
    sla: {
      availability: args.sla.availability,
      maxAvgLatencySeconds: args.sla.maxAvgLatencySeconds,
      maxDropRate: args.sla.maxDropRate,
    },
  };

  const components: ChatTopologyComponent[] = [];
  for (const [id, comp] of args.sim.components) {
    const idStr = id as unknown as string;
    const type = args.componentTypes.get(id) ?? "unknown";
    const label = args.componentLabels.get(id);
    const base: ChatTopologyComponent = { id: idStr, type };
    if (label !== undefined) base.label = label;
    if (comp.zone) base.zone = comp.zone;
    if (args.metricsAggregator) {
      const m = args.metricsAggregator.getMetricsFor(id);
      base.utilization = m.utilization;
      base.dropsThisWave = m.dropsTotal;
    }
    components.push(base);
  }

  const connections: Array<{ from: string; to: string }> = [];
  for (const conn of args.sim.connections.values()) {
    if (conn.direction !== "forward") continue;
    connections.push({
      from: conn.from.componentId as unknown as string,
      to: conn.to.componentId as unknown as string,
    });
  }

  const topology: ChatTopology = { components, connections };

  const req: ChatRequest = {
    mode: args.mode,
    hintLevel: args.hintLevel,
    wave: chatWave,
    topology,
    liveMetrics: args.liveMetrics,
    recentEvents: args.recentEvents,
    conversationHistory: args.conversationHistory,
    userMessage: args.userMessage,
  };
  if (args.levelId !== undefined) req.levelId = args.levelId;
  return req;
}

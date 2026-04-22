import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { runWave } from "@sim/test-harness";
import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import { buildSimComponent, COMPONENT_COSTS } from "../physics-td/component-factory";
import { wireWorkers } from "../physics-td/wire-workers";
import { wireContentRouters } from "../physics-td/wire-content-routers";
import { validateTopology, type TopologyError } from "../physics-td/validate-topology";
import { applyChaosEvent, type ChaosEvent } from "../physics-td/chaos";
import { enableAutoScale } from "@sim/capabilities/auto-scale";
import { scoreResult, type Verdict } from "./scoring";
import type { TopologyDef } from "./topology-builder";
import type { WaveMetrics } from "@sim/sla";

export type { TopologyDef } from "./topology-builder";

export interface PlaytestResult {
  architecture: string;
  totalCost: number;
  budgetSlack: number;
  topologyErrors: TopologyError[];
  slaPass: boolean;
  metrics: {
    availability: number;
    avgLatencySeconds: number;
    dropRate: number;
    revenue: number;
  };
  score: number;
  verdict: Verdict;
}

const CLIENT_ID = "client" as ComponentId;
const DEFAULT_DRAIN_SECONDS = 4;

/**
 * Compute a rough expected baseline revenue for a wave, used as the
 * denominator in scoring's revenue term. Derived purely from the wave
 * definition (composition × revenue × duration × packetRate × intensity).
 *
 * This is *not* a tight upper bound — it's an order-of-magnitude reference
 * against which actual revenue can be compared. An architecture earning
 * near-baseline is considered excellent; below-baseline means requests
 * were dropped, timed out, or never reached a revenue-producing terminal.
 */
export function expectedBaselineRevenue(wave: WaveDef): number {
  const c = wave.composition;
  const r = wave.revenue;
  const nonAsync = 1 - c.asyncRatio;
  const readRatio = Math.max(0, nonAsync - c.writeRatio - c.authRatio - c.streamRatio);
  const perRequest =
    readRatio * r.perRead +
    c.writeRatio * r.perWrite +
    c.authRatio * r.perAuth +
    c.streamRatio * r.perStream +
    c.asyncRatio * r.perAsync;
  // Total requests over wave duration ~= intensity × duration (requests/sec × seconds).
  const totalRequests = wave.intensity * wave.duration;
  return perRequest * totalRequests;
}

/**
 * Build a Sim from a TopologyDef. Auto-wires the Client to `entryTargetId`,
 * materializes every declared component via buildSimComponent, and creates
 * both forward and back twin connections for each declared connection.
 */
function buildSimFromTopology(
  topology: TopologyDef,
  wave: WaveDef,
  seed: number,
): { sim: Sim; totalCost: number; componentTypes: Map<ComponentId, string> } {
  const sim = new Sim({ seed });
  const componentTypes = new Map<ComponentId, string>();

  const ts = new TrafficSource(wave, makeSimRng(seed));
  const client = new SimClient({
    id: CLIENT_ID,
    capabilities: [],
    packetRate: wave.packetRate,
    trafficSource: ts,
    waveStartTime: 0,
    waveEndTime: wave.duration,
  });
  sim.addClient(client);

  let totalCost = 0;
  const autoScaleSet = new Set(topology.autoScaleIds);
  for (const def of topology.components) {
    const id = def.id as ComponentId;
    const comp = buildSimComponent(def.type, id, wave.revenue, def.zone, def.label);
    if (!comp) {
      throw new Error(`Unknown component type: ${def.type}`);
    }
    if (autoScaleSet.has(def.id)) {
      enableAutoScale(comp);
      if (process.env.PLAYTEST_DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`[playtest] autoscale enabled on ${def.id}`);
      }
    }
    sim.addComponent(comp);
    componentTypes.set(id, def.type);
    totalCost += COMPONENT_COSTS.get(def.type) ?? 0;
  }

  // All explicit connections.
  let connCounter = 0;
  const mkConn = (from: ComponentId, to: ComponentId): void => {
    const fid = `c${connCounter++}f` as ConnectionId;
    const bid = `c${connCounter++}b` as ConnectionId;
    sim.addConnection(
      new SimConnection({
        id: fid,
        from: { componentId: from, portId: "p" as PortId },
        to: { componentId: to, portId: "p" as PortId },
        bandwidth: 100,
        latencySeconds: 0.05,
        twinId: bid,
        direction: "forward",
      }),
    );
    sim.addConnection(
      new SimConnection({
        id: bid,
        from: { componentId: to, portId: "p" as PortId },
        to: { componentId: from, portId: "p" as PortId },
        bandwidth: 100,
        latencySeconds: 0.05,
        twinId: fid,
        direction: "back",
      }),
    );
  };

  // Auto-wire: client -> entry target.
  mkConn(CLIENT_ID, topology.entryTargetId as ComponentId);

  for (const c of topology.connections) {
    mkConn(c.from as ComponentId, c.to as ComponentId);
  }

  wireWorkers(sim);
  wireContentRouters(sim, componentTypes);
  return { sim, totalCost, componentTypes };
}

export function simulatePlaytest(
  wave: WaveDef,
  sla: SLAThresholds,
  startBudget: number,
  topology: TopologyDef,
  opts?: { seed?: number; durationOverride?: number; chaosSchedule?: ReadonlyArray<ChaosEvent> },
): PlaytestResult {
  const seed = opts?.seed ?? 42;
  const duration = opts?.durationOverride ?? wave.duration;

  // First pass: build the sim purely for validateTopology. (Components have
  // no state that would survive; we rebuild for the actual run.)
  let totalCost = 0;
  let topologyErrors: TopologyError[] = [];
  try {
    const built = buildSimFromTopology(topology, wave, seed);
    totalCost = built.totalCost;
    topologyErrors = validateTopology(built.sim, wave, CLIENT_ID, built.componentTypes);
  } catch (e) {
    // Unknown component type, bad wiring — treat as a single invalid error.
    topologyErrors = [
      {
        requestType: "build_error",
        componentId: CLIENT_ID,
        componentType: "unknown",
        reason: "no_handler",
      },
    ];
  }

  const budgetSlack = startBudget - totalCost;

  if (topologyErrors.length > 0) {
    const zeroMetrics = { availability: 0, avgLatencySeconds: 0, dropRate: 0, revenue: 0 };
    const scoring = scoreResult({
      totalCost,
      startBudget,
      topologyErrors,
      ...zeroMetrics,
      expectedBaselineRevenue: expectedBaselineRevenue(wave),
      sla,
    });
    return {
      architecture: topology.label,
      totalCost,
      budgetSlack,
      topologyErrors,
      slaPass: scoring.slaPass,
      metrics: zeroMetrics,
      score: scoring.score,
      verdict: scoring.verdict,
    };
  }

  // Fresh sim for the actual run.
  const { sim } = buildSimFromTopology(topology, wave, seed);
  const metrics = opts?.chaosSchedule && opts.chaosSchedule.length > 0
    ? runWaveWithChaos(sim, {
        durationSeconds: duration,
        drainSeconds: DEFAULT_DRAIN_SECONDS,
        chaosSchedule: opts.chaosSchedule,
      })
    : runWave(sim, {
        durationSeconds: duration,
        drainSeconds: DEFAULT_DRAIN_SECONDS,
      });
  if (process.env.PLAYTEST_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[playtest] tiers for ${topology.label}:`, [...sim.components.values()].map((c) => `${c.id}=t${c.tier}`).join(" "));
  }

  const denom = Math.max(1, metrics.totalRequests);
  const resolved = metrics.responded + metrics.terminated;
  const availability = resolved / denom;
  const dropRate = metrics.drops / denom;
  const metricsOut = {
    availability,
    avgLatencySeconds: metrics.avgLatencySeconds,
    dropRate,
    revenue: metrics.totalRevenue,
  };

  const scoring = scoreResult({
    totalCost,
    startBudget,
    topologyErrors,
    availability,
    avgLatencySeconds: metrics.avgLatencySeconds,
    dropRate,
    revenue: metrics.totalRevenue,
    expectedBaselineRevenue: expectedBaselineRevenue(wave),
    sla,
  });

  return {
    architecture: topology.label,
    totalCost,
    budgetSlack,
    topologyErrors,
    slaPass: scoring.slaPass,
    metrics: metricsOut,
    score: scoring.score,
    verdict: scoring.verdict,
  };
}

/**
 * runWave variant that fires a chaos schedule at each event's `atSeconds`
 * mark. Mirrors `runWave` in sim/test-harness.ts. Chaos events are applied
 * once each when elapsed sim time crosses their `atSeconds` threshold.
 */
function runWaveWithChaos(
  sim: Sim,
  opts: { durationSeconds: number; drainSeconds: number; chaosSchedule: ReadonlyArray<ChaosEvent> },
): WaveMetrics {
  const step = 1 / 60;
  const totalSimTime = opts.durationSeconds + opts.drainSeconds;
  const totalSteps = Math.ceil(totalSimTime / step);
  let responded = 0;
  let terminated = 0;
  let drops = 0;
  let totalRevenue = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let totalRequests = 0;
  const seenIds = new Set<string>();
  const fired = new Set<number>();
  let elapsed = 0;
  for (let i = 0; i < totalSteps; i += 1) {
    for (let k = 0; k < opts.chaosSchedule.length; k += 1) {
      if (fired.has(k)) continue;
      const ev = opts.chaosSchedule[k]!;
      if (ev.atSeconds <= elapsed) {
        applyChaosEvent(ev, sim);
        fired.add(k);
      }
    }
    sim.step(step);
    elapsed += step;
    for (const p of sim.activePackets) {
      if (p.direction !== "forward") continue;
      if (p.parentId !== null) continue;
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        totalRequests += p.requests.length;
      }
    }
    for (const ev of sim.lastStepEvents) {
      if (ev.kind === "drop") drops += ev.count;
      if (ev.kind === "terminate") {
        terminated += ev.count;
        totalRevenue += ev.revenue;
        latencySum += ev.latencySeconds;
        latencyCount += 1;
      }
      if (ev.kind === "respond-delivered") {
        responded += ev.count;
        totalRevenue += ev.revenue;
        latencySum += ev.latencySeconds;
        latencyCount += 1;
      }
    }
  }
  const avgLatencySeconds = latencyCount > 0 ? latencySum / latencyCount : 0;
  return { totalRequests, responded, terminated, drops, avgLatencySeconds, totalRevenue };
}

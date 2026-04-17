import type { Sim } from "./sim";
import type { WaveMetrics } from "./sla";

export type RunWaveOptions = {
  readonly durationSeconds: number;
  readonly drainSeconds?: number;
  readonly stepSeconds?: number;
};

export function runWave(sim: Sim, opts: RunWaveOptions): WaveMetrics {
  const step = opts.stepSeconds ?? 1 / 60;
  const totalSimTime = opts.durationSeconds + (opts.drainSeconds ?? 2);
  const totalSteps = Math.ceil(totalSimTime / step);
  let responded = 0;
  let terminated = 0;
  let drops = 0;
  let totalRevenue = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let totalPackets = 0;
  const seenIds = new Set<string>();
  for (let i = 0; i < totalSteps; i += 1) {
    sim.step(step);
    for (const p of sim.activePackets) {
      if (p.direction !== "forward") continue;
      if (p.parentId !== null) continue;
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        totalPackets += 1;
      }
    }
    for (const ev of sim.lastStepEvents) {
      if (ev.kind === "drop") drops += ev.count;
      if (ev.kind === "terminate") {
        terminated += 1;
        totalRevenue += ev.revenue;
        latencySum += ev.latencySeconds;
        latencyCount += 1;
      }
      if (ev.kind === "respond-delivered") {
        responded += 1;
        totalRevenue += ev.revenue;
        latencySum += ev.latencySeconds;
        latencyCount += 1;
      }
    }
  }
  const avgLatencySeconds = latencyCount > 0 ? latencySum / latencyCount : 0;
  return { totalPackets, responded, terminated, drops, avgLatencySeconds, totalRevenue };
}

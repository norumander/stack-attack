import type { SLAThresholds, WaveMetrics } from "@sim/sla";

export const SLA_PENALTY_PER_PERCENT = 10;
export const SLA_PENALTY_CAP = 500;

export type SlaPenalty = {
  readonly dollars: number;
  readonly availabilityShortfallPct: number;
  readonly latencyOvershootPct: number;
  readonly actualAvailability: number;
};

/**
 * Dollar penalty for falling short of SLA targets. $10 per percentage point
 * of availability shortfall, plus $10 per percent of latency overshoot
 * (ratio-based so units cancel). Capped so one brutal wave can't wipe a
 * campaign's bank.
 */
export function computeSlaPenalty(
  metrics: WaveMetrics,
  thresholds: SLAThresholds,
): SlaPenalty {
  const denom = Math.max(1, metrics.totalPackets);
  const actualAvailability = (metrics.responded + metrics.terminated) / denom;
  const availabilityShortfallPct = Math.max(
    0,
    (thresholds.availability - actualAvailability) * 100,
  );
  const latencyTarget = Math.max(0.0001, thresholds.maxAvgLatencySeconds);
  const latencyOvershootPct = Math.max(
    0,
    (metrics.avgLatencySeconds / latencyTarget - 1) * 100,
  );
  const raw =
    (availabilityShortfallPct + latencyOvershootPct) * SLA_PENALTY_PER_PERCENT;
  const dollars = Math.min(SLA_PENALTY_CAP, Math.round(raw));
  return { dollars, availabilityShortfallPct, latencyOvershootPct, actualAvailability };
}

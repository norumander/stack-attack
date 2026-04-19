export type SLAThresholds = {
  readonly availability: number;
  readonly maxAvgLatencySeconds: number;
  readonly maxDropRate: number;
};

export type WaveMetrics = {
  readonly totalRequests: number;
  readonly responded: number;
  readonly terminated: number;
  readonly drops: number;
  readonly avgLatencySeconds: number;
  readonly totalRevenue: number;
};

export type SLAResult = {
  readonly passed: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly metrics: WaveMetrics;
};

export function evaluateSLA(metrics: WaveMetrics, sla: SLAThresholds): SLAResult {
  const reasons: string[] = [];
  const totalResolved = metrics.responded + metrics.terminated;
  const denom = Math.max(1, metrics.totalRequests);
  const availability = totalResolved / denom;
  const dropRate = metrics.drops / denom;
  if (availability < sla.availability) {
    reasons.push(`availability ${availability.toFixed(3)} < ${sla.availability}`);
  }
  if (metrics.avgLatencySeconds > sla.maxAvgLatencySeconds) {
    reasons.push(`avgLatency ${metrics.avgLatencySeconds.toFixed(3)}s > ${sla.maxAvgLatencySeconds}s`);
  }
  if (dropRate > sla.maxDropRate) {
    reasons.push(`dropRate ${dropRate.toFixed(3)} > ${sla.maxDropRate}`);
  }
  return { passed: reasons.length === 0, reasons, metrics };
}

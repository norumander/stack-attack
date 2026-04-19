import type { SLAThresholds } from "@sim/sla";
import type { TopologyError } from "../physics-td/validate-topology";

export type Verdict = "pass" | "marginal" | "fail" | "invalid";

export interface ScoringInputs {
  readonly totalCost: number;
  readonly startBudget: number;
  readonly topologyErrors: ReadonlyArray<TopologyError>;
  readonly availability: number;
  readonly avgLatencySeconds: number;
  readonly dropRate: number;
  readonly revenue: number;
  readonly expectedBaselineRevenue: number;
  readonly sla: SLAThresholds;
}

export interface ScoringOutput {
  readonly verdict: Verdict;
  readonly slaPass: boolean;
  readonly score: number;
}

/**
 * Classify a run's verdict and produce a composite score.
 *
 * Verdict rules:
 *   - invalid: topology validation produced any errors (sim was never run)
 *   - fail:    SLA thresholds (availability / avgLatency / dropRate) not met
 *   - marginal: SLA passes but close to a cliff (drop > 60% of max, or
 *               latency > 80% of max)
 *   - pass:    SLA passes comfortably
 *
 * Score (0..1-ish, higher is better; invalid/fail clamp to 0):
 *   0.20 × (budgetSlack / startBudget)
 *   0.40 × (availability - sla.avail) / (1 - sla.avail)
 *   0.20 × (1 - avgLatency / sla.maxAvgLatency)
 *   0.20 × (revenue / expectedBaselineRevenue)
 */
export function scoreResult(inp: ScoringInputs): ScoringOutput {
  if (inp.topologyErrors.length > 0) {
    return { verdict: "invalid", slaPass: false, score: 0 };
  }

  const slaAvailPass = inp.availability >= inp.sla.availability;
  const slaLatPass = inp.avgLatencySeconds <= inp.sla.maxAvgLatencySeconds;
  const slaDropPass = inp.dropRate <= inp.sla.maxDropRate;
  const slaPass = slaAvailPass && slaLatPass && slaDropPass;

  if (!slaPass) {
    return { verdict: "fail", slaPass: false, score: 0 };
  }

  // Compute score first; verdict classification below.
  const budgetSlack = inp.startBudget - inp.totalCost;
  const budgetTerm = inp.startBudget > 0 ? budgetSlack / inp.startBudget : 0;
  const availMargin = 1 - inp.sla.availability;
  const availTerm = availMargin > 0
    ? (inp.availability - inp.sla.availability) / availMargin
    : 0;
  const latTerm = inp.sla.maxAvgLatencySeconds > 0
    ? 1 - inp.avgLatencySeconds / inp.sla.maxAvgLatencySeconds
    : 0;
  const revTerm = inp.expectedBaselineRevenue > 0
    ? inp.revenue / inp.expectedBaselineRevenue
    : 0;

  const score =
    0.20 * clamp01(budgetTerm) +
    0.40 * clamp01(availTerm) +
    0.20 * clamp01(latTerm) +
    0.20 * Math.max(0, revTerm);

  const marginalByDrop = inp.dropRate > 0.6 * inp.sla.maxDropRate;
  const marginalByLat = inp.avgLatencySeconds > 0.8 * inp.sla.maxAvgLatencySeconds;
  const verdict: Verdict = marginalByDrop || marginalByLat ? "marginal" : "pass";

  return { verdict, slaPass: true, score };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

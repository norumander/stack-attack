export interface SLAResult {
  readonly availability: { readonly target: number; readonly actual: number; readonly passed: boolean };
  readonly latency: { readonly target: number; readonly actual: number; readonly passed: boolean };
  readonly budget: { readonly target: number; readonly actual: number; readonly passed: boolean };
  readonly allPassed: boolean;
}

export interface OutcomeReport {
  readonly verdict: "win" | "lose" | "neutral";
  readonly score: {
    readonly cost: number;
    readonly performance: number;
    readonly reliability: number;
    readonly composite: number;
  };
  readonly slaResults?: SLAResult;
  readonly notes: readonly string[];
}

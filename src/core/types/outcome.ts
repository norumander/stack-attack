export interface OutcomeReport {
  readonly verdict: "win" | "lose" | "neutral";
  readonly score: {
    readonly cost: number;
    readonly performance: number;
    readonly reliability: number;
    readonly composite: number;
  };
  readonly notes: readonly string[];
}

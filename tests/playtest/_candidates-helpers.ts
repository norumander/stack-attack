import type { PlaytestResult } from "../../src/playtest/run";

/** Header block + ranked ASCII table for candidate sweeps. */
export function printRankedTable(opts: {
  title: string;
  cumulativeBudget: number;
  trafficSummary: string;
  durationSeconds: number;
  slaLine: string;
  results: PlaytestResult[];
  intendedLabel: string;
}): void {
  const ranked = [...opts.results].sort((a, b) => b.score - a.score);

  /* eslint-disable no-console */
  console.log(`\n═══ ${opts.title} ═══`);
  console.log(
    `cumulative granted budget: $${opts.cumulativeBudget}   traffic: ${opts.trafficSummary}   duration: ${opts.durationSeconds}s`,
  );
  console.log(opts.slaLine);

  const rows = ranked.map((r) => {
    const slackNum = opts.cumulativeBudget - r.totalCost;
    const overBudget = r.totalCost > opts.cumulativeBudget;
    const slack = `${slackNum >= 0 ? "+" : ""}${slackNum}${overBudget ? " !" : ""}`;
    const star = r.architecture === opts.intendedLabel ? " ★" : "";
    return {
      architecture: r.architecture,
      cost: String(r.totalCost),
      slack,
      avail: r.metrics.availability.toFixed(2),
      drop: r.metrics.dropRate.toFixed(2),
      avgLat: `${r.metrics.avgLatencySeconds.toFixed(2)}s`,
      rev: `$${Math.round(r.metrics.revenue)}`,
      score: r.score.toFixed(3),
      verdict: `${r.verdict}${star}`,
    };
  });

  const headers = [
    "architecture",
    "cost",
    "slack",
    "avail",
    "drop",
    "avgLat",
    "rev",
    "score",
    "verdict",
  ] as const;
  const widths: Record<string, number> = {};
  for (const h of headers) {
    widths[h] = h.length;
  }
  for (const row of rows) {
    for (const h of headers) {
      const cell = (row as Record<string, string>)[h] ?? "";
      widths[h] = Math.max(widths[h] ?? 0, cell.length);
    }
  }
  const w = (h: string): number => widths[h] ?? 0;
  const pad = (s: string, width: number): string => s + " ".repeat(Math.max(0, width - s.length));
  const sep = "┼" + headers.map((h) => "─".repeat(w(h) + 2)).join("┼") + "┼";
  const top = "┌" + headers.map((h) => "─".repeat(w(h) + 2)).join("┬") + "┐";
  const bot = "└" + headers.map((h) => "─".repeat(w(h) + 2)).join("┴") + "┘";
  const headerLine =
    "│ " + headers.map((h) => pad(h, w(h))).join(" │ ") + " │";

  console.log(top);
  console.log(headerLine);
  console.log(sep.replace(/^┼/, "├").replace(/┼$/, "┤"));
  for (const row of rows) {
    console.log(
      "│ " +
        headers
          .map((h) => pad((row as Record<string, string>)[h] ?? "", w(h)))
          .join(" │ ") +
        " │",
    );
  }
  console.log(bot);
  /* eslint-enable no-console */
}

export function slaLine(sla: { availability: number; maxAvgLatencySeconds: number; maxDropRate: number }): string {
  return `SLA: avail >= ${sla.availability}, avgLat <= ${sla.maxAvgLatencySeconds}s, dropRate <= ${sla.maxDropRate}`;
}

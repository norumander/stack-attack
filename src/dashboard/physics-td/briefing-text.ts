export interface BriefingDisplay {
  readonly title: string;
  readonly narrative?: string;
  readonly load: { readonly dots: number; readonly label: string };
  readonly traffic: string;
  readonly objective: string;
  readonly reward: string;
}

export function computeLoad(intensity: number): { dots: number; label: string } {
  if (intensity <= 15) return { dots: 1, label: "LIGHT" };
  if (intensity <= 50) return { dots: 2, label: "STEADY" };
  if (intensity <= 150) return { dots: 3, label: "HEAVY" };
  if (intensity <= 500) return { dots: 4, label: "PEAK" };
  return { dots: 5, label: "EXTREME" };
}

export function describeTraffic(
  composition: ReadonlyMap<string, number>,
): string {
  const types = new Set(composition.keys());
  if (types.size === 1 && types.has("api_read")) {
    return "A handful of readers";
  }
  if (types.has("stream")) return "Viewers tuning in";
  if (types.has("batch")) return "Background jobs and reads";
  if (types.has("auth_required")) return "Sign-ins and reads";
  if (types.has("static_asset")) return "Readers and asset traffic";
  if (types.has("api_write") && types.has("api_read") && types.size === 2) {
    return "Readers and contributors";
  }
  return "Mixed traffic";
}

export function describeReward(
  revenue: ReadonlyMap<string, number>,
): string {
  const values = Array.from(revenue.values());
  if (values.length === 0) return "No reward";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return `$${min} per user served`;
  return `$${min}–$${max} per user served`;
}


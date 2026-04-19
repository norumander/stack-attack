import { supabase } from "./supabase-client";
import { getUser } from "./auth-state";
import type { LeaderboardEntry } from "./database.types";

export interface LeaderboardRow extends LeaderboardEntry {
  display_name: string;
  avatar_key: string;
}

export async function submitLeaderboardEntry(entry: {
  waveId: number;
  compositeScore: number;
  availability: number;
  avgLatency: number;
  finalBudget: number;
  viabilityRemaining: number;
}): Promise<void> {
  const user = getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from("leaderboard_entries")
    .select("composite_score")
    .eq("user_id", user.id)
    .eq("wave_id", entry.waveId)
    .single();

  if (existing && existing.composite_score >= entry.compositeScore) return;

  const { error } = await supabase.from("leaderboard_entries").upsert(
    {
      user_id: user.id,
      wave_id: entry.waveId,
      composite_score: entry.compositeScore,
      availability: entry.availability,
      avg_latency: entry.avgLatency,
      final_budget: entry.finalBudget,
      viability_remaining: entry.viabilityRemaining,
    },
    { onConflict: "user_id,wave_id" },
  );

  if (error) console.warn("[leaderboard] submit error:", error.message);
}

export async function fetchWaveLeaderboard(
  waveId: number,
  limit = 50,
): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase
    .from("leaderboard_entries")
    .select("*, profiles(display_name, avatar_key)")
    .eq("wave_id", waveId)
    .order("composite_score", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row: any) => ({
    ...row,
    display_name: row.profiles?.display_name ?? "Unknown",
    avatar_key: row.profiles?.avatar_key ?? "server",
  }));
}

export async function fetchCampaignLeaderboard(
  limit = 50,
): Promise<
  Array<{
    user_id: string;
    display_name: string;
    avatar_key: string;
    total_score: number;
    waves_completed: number;
  }>
> {
  const { data, error } = await supabase
    .from("leaderboard_entries")
    .select("user_id, wave_id, composite_score, profiles(display_name, avatar_key)");

  if (error || !data) return [];

  const byUser = new Map<
    string,
    { total: number; waves: Set<number>; displayName: string; avatarKey: string }
  >();

  for (const row of data as any[]) {
    const uid = row.user_id;
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        total: 0,
        waves: new Set(),
        displayName: row.profiles?.display_name ?? "Unknown",
        avatarKey: row.profiles?.avatar_key ?? "server",
      });
    }
    const entry = byUser.get(uid)!;
    entry.total += row.composite_score;
    entry.waves.add(row.wave_id);
  }

  return [...byUser.entries()]
    .map(([userId, { total, waves, displayName, avatarKey }]) => ({
      user_id: userId,
      display_name: displayName,
      avatar_key: avatarKey,
      total_score: Math.round(total * 100) / 100,
      waves_completed: waves.size,
    }))
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, limit);
}

import { supabase } from "./supabase-client";
import { getUser } from "./auth-state";

export interface ProgressData {
  currentWaveIndex: number;
  budget: number;
  viability: number;
  completedWaves: number[];
  actionLog: unknown[];
}

/** Save (upsert) the player's progress. Fire-and-forget, non-blocking. */
export async function saveProgress(data: ProgressData): Promise<void> {
  const user = getUser();
  if (!user) return;

  const { error } = await supabase.from("game_progress").upsert(
    {
      user_id: user.id,
      current_wave_index: data.currentWaveIndex,
      budget: data.budget,
      viability: data.viability,
      completed_waves: data.completedWaves,
      action_log: data.actionLog,
    },
    { onConflict: "user_id" },
  );

  if (error) console.warn("[progress] save error:", error.message);
}

/** Load the player's saved progress, or null if none exists. */
export async function loadProgress(): Promise<ProgressData | null> {
  const user = getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("game_progress")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return null;

  return {
    currentWaveIndex: data.current_wave_index,
    budget: data.budget,
    viability: data.viability,
    completedWaves: data.completed_waves,
    actionLog: data.action_log as unknown[],
  };
}

/** Clear the player's saved progress (on campaign reset). */
export async function clearProgress(): Promise<void> {
  const user = getUser();
  if (!user) return;

  const { error } = await supabase
    .from("game_progress")
    .delete()
    .eq("user_id", user.id);

  if (error) console.warn("[progress] clear error:", error.message);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedSave(data: ProgressData, delayMs = 2000): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveProgress(data);
  }, delayMs);
}
